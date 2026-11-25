import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Stage } from "@/generated/prisma/enums";
import { yearWindow } from "@/lib/capsule/year";
import { historyProof, ruleSupport } from "@/lib/claim-rules";
import { claimSupport, historyLines, summarize, type ClaimSupport } from "@/lib/claim-support";
import { dbToday } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { DAY_MS } from "@/lib/dates";
import { boardYearOf } from "@/lib/smart-import/dates";
import { resetAndSeed } from "./helpers/seed";

// What the Claim Checker may use besides verified facts (lib/claim-support.ts): accepted research
// brief items and the company's logged history. The pure parts run on fixed dates; the reads run
// against the real database, with rows dated from the database's own board year.

const OWNER_A = { userId: "ownerA", workspaceId: "a", role: "owner" } as const;
const OWNER_B = { userId: "ownerB", workspaceId: "b", role: "owner" } as const;

const at = (iso: string) => new Date(iso);
const move = (fromStage: Stage, toStage: Stage, iso: string) => ({ fromStage, toStage, changedAt: at(iso) });
const sent = (iso: string, gotReply = false) => ({ sentAt: at(iso), gotReply });
// Board year 2026-27 is "this" year in the pure tests.
const proof = (outreach: ReturnType<typeof sent>[], moves: ReturnType<typeof move>[]) => historyProof(summarize(outreach, moves, 2026));

describe("historyProof", () => {
  test.for([
    ["Committed two board years ago", [], [move("CONTACTED", "COMMITTED", "2024-10-01T15:00:00Z")], { sponsored: "2024-25", replied: null }],
    ["Committed this board year", [], [move("CONTACTED", "COMMITTED", "2026-09-01T15:00:00Z")], { sponsored: "2026-27", replied: null }],
    [
      "Committed, then moved out within 7 days",
      [],
      [move("CONTACTED", "COMMITTED", "2025-10-01T15:00:00Z"), move("COMMITTED", "CONTACTED", "2025-10-07T15:00:00Z")],
      { sponsored: null, replied: null },
    ],
    [
      "Committed, then reopened after 20 days",
      [],
      [move("CONTACTED", "COMMITTED", "2025-10-01T15:00:00Z"), move("COMMITTED", "CONTACTED", "2025-10-21T15:00:00Z")],
      { sponsored: "2025-26", replied: null },
    ],
    ["a reply only this board year", [sent("2026-09-01T15:00:00Z", true)], [move("CONTACTED", "REPLIED", "2026-09-03T15:00:00Z")], { sponsored: null, replied: null }],
    ["a move to Replied last board year", [], [move("CONTACTED", "REPLIED", "2025-11-03T15:00:00Z")], { sponsored: null, replied: "2025-26" }],
    ["a reply marked on outreach last board year", [sent("2025-11-01T15:00:00Z", true)], [], { sponsored: null, replied: "2025-26" }],
    ["a move to Declined alone", [], [move("CONTACTED", "DECLINED", "2025-11-03T15:00:00Z")], { sponsored: null, replied: null }],
  ] as const)("%s", ([, outreach, moves, expected]) => {
    expect(proof([...outreach], [...moves])).toEqual(expected);
  });

  it("a reply followed by a decline is no proof, and a later lasting Committed restores both", () => {
    const reply = [sent("2025-11-01T15:00:00Z", true)];
    const declined = [move("CONTACTED", "REPLIED", "2025-11-03T15:00:00Z"), move("REPLIED", "DECLINED", "2025-12-01T15:00:00Z")];
    expect(proof(reply, declined)).toEqual({ sponsored: null, replied: null });
    const committed = [...declined, move("DECLINED", "CONTACTED", "2026-08-01T15:00:00Z"), move("CONTACTED", "COMMITTED", "2026-09-01T15:00:00Z")];
    expect(proof(reply, committed)).toEqual({ sponsored: "2026-27", replied: "2025-26" });
  });

  it("a Committed click undone at once does not cancel a decline", () => {
    const moves = [
      move("CONTACTED", "REPLIED", "2025-11-03T15:00:00Z"),
      move("REPLIED", "DECLINED", "2025-12-01T15:00:00Z"),
      move("DECLINED", "COMMITTED", "2026-08-01T15:00:00Z"),
      move("COMMITTED", "DECLINED", "2026-08-01T15:05:00Z"),
    ];
    expect(proof([], moves)).toEqual({ sponsored: null, replied: null });
  });
});

describe("historyLines", () => {
  it("writes each board year newest first, with months in West Lafayette's calendar", () => {
    const s = summarize(
      [sent("2024-09-01T15:00:00Z"), sent("2024-10-01T15:00:00Z", true), sent("2026-09-01T15:00:00Z")],
      [
        move("CONTACTED", "REPLIED", "2024-10-02T15:00:00Z"),
        move("REPLIED", "COMMITTED", "2025-04-10T15:00:00Z"),
        // 02:00 UTC on July 1 is still June 30 in West Lafayette, so this is 2024-25, in June.
        move("COMMITTED", "DECLINED", "2025-07-01T02:00:00Z"),
      ],
      2026,
    );
    expect(historyLines(s)).toEqual([
      "This board year (2026-27): 1 outreach entry, no reply yet.",
      "2024-25: 2 outreach entries, 1 reply; moved to Committed in April 2025, moved to Declined in June 2025.",
    ]);
  });

  it("keeps at most 6 years, skips empty ones, and says when nothing is logged", () => {
    const outreach = Array.from({ length: 9 }, (_, i) => sent(`${2018 + i}-09-01T15:00:00Z`));
    const lines = historyLines(summarize(outreach, [], 2026));
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("This board year (2026-27): 1 outreach entry, no reply yet.");
    expect(lines[5]).toBe("2021-22: 1 outreach entry, no reply.");
    expect(historyLines(summarize([], [], 2026))).toEqual(["(nothing logged)"]);
  });

  it("never names the stage the company is in now", () => {
    const lines = historyLines(summarize([], [move("CONTACTED", "IN_CONVERSATION", "2025-11-01T15:00:00Z")], 2026)).join(" ");
    expect(lines).toBe("2025-26: 0 outreach entries, 1 reply.");
    expect(lines).not.toMatch(/conversation|now|stage/i);
  });
});

describe("ruleSupport", () => {
  const support = (items: ClaimSupport["items"], committed: string[]): ClaimSupport => ({
    items,
    ...summarize([], committed.map((iso) => move("CONTACTED", "COMMITTED", iso)), 2026),
  });

  it("takes a Committed year from West Lafayette's calendar, not UTC", () => {
    expect(ruleSupport(support([], ["2026-01-01T03:00:00Z"])).historyYears).toEqual(["2025"]);
  });

  it("turns accepted items into numbers with their words, and their pages into sites", () => {
    const item = {
      label: "Giving portal",
      title: "Community Fund",
      detail: "Takes requests twice a year.",
      deadline: "March 1",
      quote: "The Community Fund gives up to $5,000 to local groups.",
      url: "https://sites.google.com/acme-giving/apply",
    };
    expect(ruleSupport(support([item], []))).toEqual({
      brief: [
        { number: "5000", words: ["community", "fund", "giving", "portal"] },
        { number: "1", words: ["community", "fund", "giving", "portal"] },
      ],
      historyYears: [],
      sites: ["sites.google.com/acme-giving"],
      history: { sponsored: null, replied: null },
    });
  });
});

describe("claimSupport, against the database", () => {
  let companyId: string;
  let thisYear: number;
  let today: string;
  // A moment in a board year, some days after it starts.
  const inYear = (start: number, days = 30) => new Date(yearWindow(start).from.getTime() + days * DAY_MS);

  beforeEach(async () => {
    await resetAndSeed();
    today = await dbToday();
    thisYear = boardYearOf(today);
    const created = await createCompany(OWNER_A, { name: "Globex", website: "globex.com" });
    if (created.status !== "saved") throw new Error("flagged");
    companyId = created.companyId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function brief(member: { workspaceId: string; userId: string }, company: string, opts: { createdAt: Date; status?: "READY" | "FAILED"; accepted: string[]; ids: string[]; finalUrl?: string | null }) {
    return withTenant(member, async (tx) => {
      const row = await tx.companyBrief.create({
        data: {
          workspaceId: member.workspaceId,
          companyId: company,
          createdById: member.userId,
          status: opts.status ?? "READY",
          createdAt: opts.createdAt,
          accepted: opts.accepted,
          brief: {
            items: opts.ids.map((id) => ({ id, door: "GIVING", title: `Fund ${id}`, detail: "Takes requests.", deadline: null, page: 1, quote: `Fund ${id} gives $500.` })),
          },
        },
        select: { id: true },
      });
      const finalUrl = opts.finalUrl === undefined ? "https://globex.com/giving" : opts.finalUrl;
      await tx.companyBriefPage.create({
        data: { workspaceId: member.workspaceId, briefId: row.id, position: 1, url: "https://globex.com/giving", finalUrl, inboxes: ["giving@globex.com"] },
      });
    });
  }

  it("returns only accepted items of READY briefs from this or last board year, newest first, at most 12", async () => {
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 2), accepted: ["i1"], ids: ["i1"] });
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 1), status: "FAILED", accepted: ["i1"], ids: ["i1"] });
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 1, 10), accepted: ["i1", "i2"], ids: ["i1", "i2", "i3"] });
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 1, 20), accepted: ["i1"], ids: ["i1"], finalUrl: null });
    for (let n = 0; n < 6; n += 1) await brief(OWNER_A, companyId, { createdAt: inYear(thisYear, n), accepted: ["i1", "i2"], ids: ["i1", "i2"] });
    const support = await claimSupport(OWNER_A, companyId, today);
    expect(support.items).toHaveLength(12);
    // The newest briefs fill the 12 first: last year's i1 and i2 don't make it.
    expect(support.items.every((item) => item.url === "https://globex.com/giving")).toBe(true);
    expect(support.items.map((i) => i.title)).toEqual(Array.from({ length: 6 }, () => ["Fund i1", "Fund i2"]).flat());
    expect(JSON.stringify(support)).not.toContain("giving@globex.com");
  });

  it("drops an unaccepted item and one whose page has no final address", async () => {
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 1, 10), accepted: ["i1"], ids: ["i1", "i2"] });
    await brief(OWNER_A, companyId, { createdAt: inYear(thisYear - 1, 20), accepted: ["i1"], ids: ["i1"], finalUrl: null });
    const support = await claimSupport(OWNER_A, companyId, today);
    expect(support.items).toEqual([
      { label: "Giving portal", title: "Fund i1", detail: "Takes requests.", deadline: null, quote: "Fund i1 gives $500.", url: "https://globex.com/giving" },
    ]);
  });

  it("reads the logged history by board year", async () => {
    await withTenant(OWNER_A, async (tx) => {
      await tx.outreach.create({ data: { workspaceId: "a", companyId, senderId: "ownerA", sentAt: inYear(thisYear - 1), gotReply: true, note: "Spoke with Hank" } });
      await tx.stageChange.create({ data: { workspaceId: "a", companyId, changedById: "ownerA", fromStage: "REPLIED", toStage: "COMMITTED", changedAt: inYear(thisYear - 1, 40) } });
    });
    const support = await claimSupport(OWNER_A, companyId, today);
    expect(historyProof(support)).toEqual({ sponsored: `${thisYear - 1}-${String(thisYear % 100).padStart(2, "0")}`, replied: `${thisYear - 1}-${String(thisYear % 100).padStart(2, "0")}` });
    expect(support.lastOutcome).toBe("COMMITTED");
    expect(JSON.stringify(support)).not.toContain("Hank");
  });

  it("a reply last board year followed by a decline gives no reply proof", async () => {
    await withTenant(OWNER_A, async (tx) => {
      await tx.outreach.create({ data: { workspaceId: "a", companyId, senderId: "ownerA", sentAt: inYear(thisYear - 1), gotReply: true } });
      await tx.stageChange.create({ data: { workspaceId: "a", companyId, changedById: "ownerA", fromStage: "REPLIED", toStage: "DECLINED", changedAt: inYear(thisYear - 1, 40) } });
    });
    expect(historyProof(await claimSupport(OWNER_A, companyId, today))).toEqual({ sponsored: null, replied: null });
  });

  it("never reads another workspace's rows", async () => {
    const theirs = await createCompany(OWNER_B, { name: "Initech", website: "initech.com" });
    if (theirs.status !== "saved") throw new Error("flagged");
    await brief(OWNER_B, theirs.companyId, { createdAt: inYear(thisYear), accepted: ["i1"], ids: ["i1"] });
    await withTenant(OWNER_B, async (tx) => {
      await tx.outreach.create({ data: { workspaceId: "b", companyId: theirs.companyId, senderId: "ownerB", sentAt: inYear(thisYear - 1), gotReply: true } });
      await tx.stageChange.create({ data: { workspaceId: "b", companyId: theirs.companyId, changedById: "ownerB", fromStage: "CONTACTED", toStage: "COMMITTED", changedAt: inYear(thisYear - 1) } });
    });
    // Workspace a asking about workspace b's company gets nothing back.
    expect(await claimSupport(OWNER_A, theirs.companyId, today)).toEqual({ items: [], years: [], currentYear: thisYear, lastOutcome: null });
    // And workspace a's own company shows none of b's rows.
    expect(await claimSupport(OWNER_A, companyId, today)).toEqual({ items: [], years: [], currentYear: thisYear, lastOutcome: null });
    // While b sees its own.
    const own = await claimSupport(OWNER_B, theirs.companyId, today);
    expect(own.items).toHaveLength(1);
    expect(own.lastOutcome).toBe("COMMITTED");
  });
});
