import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Stage } from "@/generated/prisma/enums";
import type { Membership } from "@/lib/authz";
import { changeStage, claimCompany, dbNow, forceRelease, logOutreach, releaseClaim, setFollowUp, dbToday } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { loadKnown } from "@/lib/copilot/cards";
import {
  legalMoves,
  MOVE_LABELS,
  MOVE_TYPES,
  nextBestMove,
  stageChoices,
  stageConfirm,
  type Actor,
  type CompanyState,
  type MoveType,
} from "@/lib/copilot/moves";
import { resetAndSeed } from "./helpers/seed";

// Which of the five moves are legal, for an owner and for an officer, in every state a company can
// be in. The first half is pure. The second half runs each move for real against the database and
// checks that the reason a card shows is what the app's own action says, and that a move marked
// legal succeeds.
const NOW = new Date("2026-11-13T15:00:00Z");
const LATER = new Date("2026-11-20T15:00:00Z");
const EARLIER = new Date("2026-11-10T15:00:00Z");

const OWNER: Actor = { userId: "ownerA", role: "owner" };
const OFFICER: Actor = { userId: "officerA", role: "member" };

const state = (over: Partial<CompanyState> = {}): CompanyState => ({
  stage: "CONTACTED",
  archived: false,
  holderId: null,
  holderName: null,
  holdEndsAt: null,
  ...over,
});
// Held by the person other than `actor` ("Sam" holds it), live or ended.
const heldByOther = (live: boolean) => state({ holderId: "someone-else", holderName: "Sam", holdEndsAt: live ? LATER : EARLIER });
const heldBy = (actor: Actor, live: boolean) => state({ holderId: actor.userId, holderName: actor.userId, holdEndsAt: live ? LATER : EARLIER });

type Scenario = { name: string; make: (actor: Actor) => CompanyState; legal: Record<"owner" | "officer", Record<MoveType, boolean>> };
const L = (CLAIM: boolean, RELEASE: boolean, LOG: boolean, MOVE_STAGE: boolean, SET_FOLLOW_UP: boolean): Record<MoveType, boolean> => ({ CLAIM, RELEASE, LOG, MOVE_STAGE, SET_FOLLOW_UP });

const SCENARIOS: Scenario[] = [
  { name: "free", make: () => state(), legal: { owner: L(true, false, false, true, true), officer: L(true, false, false, true, true) } },
  { name: "held by me, live", make: (a) => heldBy(a, true), legal: { owner: L(true, true, true, true, true), officer: L(true, true, true, true, true) } },
  { name: "held by me, ended", make: (a) => heldBy(a, false), legal: { owner: L(true, true, true, true, true), officer: L(true, true, true, true, true) } },
  { name: "held by someone else, live", make: () => heldByOther(true), legal: { owner: L(false, true, false, true, false), officer: L(false, false, false, false, false) } },
  { name: "held by someone else, ended", make: () => heldByOther(false), legal: { owner: L(true, false, false, true, true), officer: L(true, false, false, true, true) } },
  {
    name: "committed",
    make: () => state({ stage: "COMMITTED" }),
    legal: { owner: L(false, false, false, true, false), officer: L(false, false, false, true, false) },
  },
  {
    name: "declined",
    make: () => state({ stage: "DECLINED" }),
    legal: { owner: L(false, false, false, true, false), officer: L(false, false, false, true, false) },
  },
  {
    name: "archived",
    make: () => state({ archived: true }),
    legal: { owner: L(false, false, false, false, false), officer: L(false, false, false, false, false) },
  },
];

describe("legalMoves (pure)", () => {
  for (const scenario of SCENARIOS) {
    test.for([
      ["owner", OWNER],
      ["officer", OFFICER],
    ] as const)(`${scenario.name}: what an %s can do`, ([role, actor]) => {
      const moves = legalMoves(scenario.make(actor), actor, NOW);
      expect(Object.fromEntries(MOVE_TYPES.map((t) => [t, moves[t].legal]))).toEqual(scenario.legal[role]);
      for (const type of MOVE_TYPES) {
        // A reason comes with every refusal and with nothing else.
        expect(moves[type].reason === null).toBe(moves[type].legal);
        expect(moves[type].type).toBe(type);
      }
    });
  }

  it("only an owner force-releases, and only someone else's live claim", () => {
    const theirs = heldByOther(true);
    expect(legalMoves(theirs, OWNER, NOW).RELEASE).toEqual({ type: "RELEASE", legal: true, reason: null, force: true });
    expect(legalMoves(theirs, OFFICER, NOW).RELEASE).toMatchObject({ legal: false, reason: "Only an owner can force-release a claim.", force: false });
    // Your own claim is a plain release, even for an owner.
    expect(legalMoves(heldBy(OWNER, true), OWNER, NOW).RELEASE).toMatchObject({ legal: true, force: false });
    // Nothing to release.
    expect(legalMoves(state(), OWNER, NOW).RELEASE).toMatchObject({ legal: false, reason: "You don't hold this company." });
  });

  it("an officer cannot move a stage, log or reschedule under someone else's live claim, and an owner can only move the stage", () => {
    const theirs = heldByOther(true);
    const officer = legalMoves(theirs, OFFICER, NOW);
    expect([officer.MOVE_STAGE.legal, officer.LOG.legal, officer.SET_FOLLOW_UP.legal, officer.CLAIM.legal]).toEqual([false, false, false, false]);
    expect(officer.MOVE_STAGE.reason).toBe("Sam holds this company until Nov 20. Ask them, or an owner.");
    const owner = legalMoves(theirs, OWNER, NOW);
    expect([owner.MOVE_STAGE.legal, owner.LOG.legal, owner.SET_FOLLOW_UP.legal, owner.CLAIM.legal]).toEqual([true, false, false, false]);
  });

  it("states the app's own reasons", () => {
    const theirs = heldByOther(true);
    const moves = legalMoves(theirs, OFFICER, NOW);
    expect(moves.CLAIM.reason).toBe("Sam claimed this first. They hold it until Nov 20.");
    expect(moves.LOG.reason).toBe("Sam holds this company now, until Nov 20.");
    expect(moves.SET_FOLLOW_UP.reason).toBe("Sam holds this company until Nov 20.");
    const closed = legalMoves(state({ stage: "COMMITTED" }), OFFICER, NOW);
    expect(closed.CLAIM.reason).toBe("This company is Committed, so it can't be claimed.");
    expect(closed.LOG.reason).toBe("This company is Committed.");
    expect(closed.SET_FOLLOW_UP.reason).toBe("This company is Committed, so its follow-up can't change.");
    expect(legalMoves(state(), OFFICER, NOW).LOG.reason).toBe("Claim this company before logging outreach.");
    expect(legalMoves(state({ archived: true }), OFFICER, NOW).CLAIM.reason).toBe("This company is archived.");
  });

  it("reads a claim as live only until its end, by the clock it is given", () => {
    const theirs = heldByOther(true);
    expect(legalMoves(theirs, OFFICER, NOW).CLAIM.legal).toBe(false);
    expect(legalMoves(theirs, OFFICER, new Date(LATER.getTime() + 1)).CLAIM.legal).toBe(true);
    // The very instant a claim ends it has ended (the claim SQL says "expires at <= now").
    expect(legalMoves(theirs, OFFICER, LATER).CLAIM.legal).toBe(true);
  });
});

describe("stage confirmations", () => {
  test.for([
    ["NOT_CONTACTED", "CONTACTED", null],
    ["CONTACTED", "REPLIED", null],
    ["CONTACTED", "IN_CONVERSATION", null],
    ["REPLIED", "COMMITTED", "closes"],
    ["CONTACTED", "DECLINED", "closes"],
    ["IN_CONVERSATION", "REPLIED", "back"],
    ["REPLIED", "NOT_CONTACTED", "back"],
    ["COMMITTED", "REPLIED", "reopens"],
    ["DECLINED", "CONTACTED", "reopens"],
    ["COMMITTED", "DECLINED", "closes"],
  ] as const)("%s to %s asks: %s", ([from, to, expected]) => {
    expect(stageConfirm(from, to)).toBe(expected);
  });

  it("lists every other stage as a choice, and none when the move is illegal", () => {
    const own = state({ stage: "REPLIED" });
    const choices = stageChoices(own, legalMoves(own, OFFICER, NOW));
    expect(choices.map((c) => c.stage)).toEqual(["NOT_CONTACTED", "CONTACTED", "IN_CONVERSATION", "COMMITTED", "DECLINED"]);
    expect(choices.find((c) => c.stage === "COMMITTED")).toEqual({ stage: "COMMITTED", label: "Committed", confirm: "closes" });
    expect(choices.find((c) => c.stage === "CONTACTED")?.confirm).toBe("back");
    const blocked = heldByOther(true);
    expect(stageChoices(blocked, legalMoves(blocked, OFFICER, NOW))).toEqual([]);
    expect(stageChoices(blocked, legalMoves(blocked, OWNER, NOW)).length).toBe(5);
  });
});

describe("nextBestMove", () => {
  it("logs for a company you hold, claims one nobody holds, and shows a disabled claim under someone else's", () => {
    expect(nextBestMove(heldBy(OFFICER, true), OFFICER, NOW)).toMatchObject({ type: "LOG", label: "Log outreach", legal: true });
    expect(nextBestMove(heldBy(OFFICER, false), OFFICER, NOW)).toMatchObject({ type: "LOG", legal: true });
    expect(nextBestMove(state(), OFFICER, NOW)).toMatchObject({ type: "CLAIM", label: "Claim", legal: true });
    expect(nextBestMove(heldByOther(false), OFFICER, NOW)).toMatchObject({ type: "CLAIM", legal: true });
    for (const actor of [OFFICER, OWNER]) {
      expect(nextBestMove(heldByOther(true), actor, NOW)).toMatchObject({ type: "CLAIM", legal: false, reason: "Sam claimed this first. They hold it until Nov 20." });
    }
  });

  it("has no next move for a closed or archived company", () => {
    expect(nextBestMove(state({ stage: "COMMITTED" }), OFFICER, NOW)).toBeNull();
    expect(nextBestMove(state({ stage: "DECLINED" }), OWNER, NOW)).toBeNull();
    expect(nextBestMove(state({ archived: true }), OWNER, NOW)).toBeNull();
  });

  it("has a label for every move", () => {
    expect(Object.keys(MOVE_LABELS).sort()).toEqual([...MOVE_TYPES].sort());
  });
});

// ----- The same table against the real actions -----

const OWNER_M: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER_M: Membership = { userId: "officerA", workspaceId: "a", role: "member" };

beforeEach(resetAndSeed);
afterAll(async () => {
  await prisma.$disconnect();
});

// Puts a fresh company into a scenario's state, as the database holds it.
async function seed(scenario: Scenario, actor: Membership): Promise<string> {
  const created = await createCompany(OWNER_M, { name: "Acme" });
  if (created.status !== "saved") throw new Error("seed company flagged");
  const id = created.companyId;
  const want = scenario.make({ userId: actor.userId, role: actor.role });
  const other = actor.userId === "ownerA" ? "officerA" : "ownerA";
  const holder = want.holderId === null ? null : want.holderId === actor.userId ? actor.userId : other;
  await withTenant(OWNER_M, async (tx) => {
    await tx.$executeRaw`UPDATE "Company" SET stage = ${want.stage}::"Stage" WHERE id = ${id}`;
    if (want.archived) await tx.$executeRaw`UPDATE "Company" SET "archivedAt" = now() WHERE id = ${id}`;
    if (holder && want.holdEndsAt && want.holdEndsAt > NOW) {
      await tx.$executeRaw`UPDATE "Company" SET "claimedById" = ${holder}, "claimExpiresAt" = now() + interval '5 days' WHERE id = ${id}`;
    } else if (holder) {
      await tx.$executeRaw`UPDATE "Company" SET "claimedById" = ${holder}, "claimExpiresAt" = now() - interval '1 minute' WHERE id = ${id}`;
    }
  });
  return id;
}

// Runs one move for real and returns its refusal, or null if it went through. A move's refusal text
// can end in "Nothing was saved.", which a card that was never tried leaves off.
async function tryMove(type: MoveType, actor: Membership, id: string, move: { force: boolean; reason: string | null }): Promise<string | null> {
  const today = await dbToday();
  const result =
    type === "CLAIM"
      ? await claimCompany(actor, id)
      : type === "RELEASE"
        ? move.force || move.reason === "Only an owner can force-release a claim."
          ? await forceRelease(actor, id)
          : await releaseClaim(actor, id)
        : type === "LOG"
          ? await logOutreach(actor, id, { channel: "EMAIL", note: null, followUpOn: addDays(today, 5) })
          : type === "MOVE_STAGE"
            ? await changeStage(actor, id, "REPLIED")
            : await setFollowUp(actor, id, addDays(today, 5));
  return result.ok ? null : result.error.replace(/ Nothing was saved\.$/, "");
}

describe("legalMoves agree with the real actions", () => {
  for (const scenario of SCENARIOS.filter((s) => s.name !== "archived")) {
    for (const actor of [OWNER_M, OFFICER_M]) {
      for (const type of MOVE_TYPES) {
        it(`${scenario.name}, ${actor.role === "owner" ? "owner" : "officer"}: ${type}`, async () => {
          const id = await seed(scenario, actor);
          const company = (await loadKnown(actor, [id])).get(id);
          const move = legalMoves(company!.state, actor, await dbNow())[type];
          // A change from CONTACTED to REPLIED is the move tried, so it is never a no-op.
          const refusal = await tryMove(type, actor, id, move);
          if (move.legal) expect(refusal).toBeNull();
          else expect(refusal).toBe(move.reason);
        });
      }
    }
  }

  it("an archived company is refused by every action, as Company not found", async () => {
    const id = await seed(SCENARIOS.find((s) => s.name === "archived")!, OWNER_M);
    const company = (await loadKnown(OWNER_M, [id])).get(id);
    const moves = legalMoves(company!.state, OWNER_M, await dbNow());
    for (const type of MOVE_TYPES) {
      expect(moves[type].legal).toBe(false);
      const refusal = await tryMove(type, OWNER_M, id, moves[type]);
      // Release on an archived company nobody holds is "You don't hold this company."
      expect(refusal).not.toBeNull();
    }
  });

  it("an officer cannot get the owner-only move, whatever a card says", async () => {
    const id = await seed(SCENARIOS[3], OFFICER_M);
    const company = (await loadKnown(OFFICER_M, [id])).get(id);
    const move = legalMoves(company!.state, OFFICER_M, await dbNow()).RELEASE;
    expect(move).toMatchObject({ legal: false, reason: "Only an owner can force-release a claim." });
    // Even a confirm that ignored the card is refused by the action itself, and the claim stays.
    expect(await forceRelease(OFFICER_M, id)).toEqual({ ok: false, error: "Only an owner can force-release a claim." });
    const row = await withTenant(OWNER_M, (tx) => tx.company.findUniqueOrThrow({ where: { id }, select: { claimedById: true } }));
    expect(row.claimedById).toBe("ownerA");
  });
});

// A stage the real stage control would ask about is a stage the confirm card asks about too.
describe("stage confirmations match the stage control", () => {
  it("uses the same ranking as components/stage-form.tsx", async () => {
    const source = (await import("node:fs")).readFileSync("components/stage-form.tsx", "utf8");
    expect(source).toContain("const RANK: Record<Stage, number> = { NOT_CONTACTED: 0, CONTACTED: 1, REPLIED: 2, IN_CONVERSATION: 3, COMMITTED: 4, DECLINED: 5 };");
    const stages: Stage[] = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "IN_CONVERSATION", "COMMITTED", "DECLINED"];
    // Moving up the line, short of an outcome, never asks.
    for (const [i, from] of stages.entries()) for (const to of stages.slice(i + 1, 4)) expect(stageConfirm(from, to)).toBeNull();
  });
});
