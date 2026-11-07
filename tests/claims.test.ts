import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import {
  claimCompany as claimAction,
  forceRelease as forceReleaseAction,
  logOutreach as logOutreachAction,
  releaseClaim as releaseAction,
} from "@/app/(app)/[workspaceId]/companies/actions";
import { leaveWorkspace, removeMember } from "@/app/(app)/[workspaceId]/settings/actions";
import type { Membership } from "@/lib/authz";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/channels";
import {
  changeStage,
  claimCompany,
  claimState,
  claimView,
  dbNow,
  dbToday,
  forceRelease,
  logOutreach,
  releaseClaim,
  releaseClaimsOf,
  type OutreachInput,
} from "@/lib/claims";
import { archiveCompany, createCompany, resolveAsDuplicate, unarchiveCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { form, redirectTo } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Real database as app_user, never mocks (project convention for lib/claims.ts). Workspace "a"
// has an owner and an officer; "b" has its own owner. Claim window: the default 14 days.
const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };
const DAY = 24 * 60 * 60 * 1000;

async function company(name = "Acme") {
  const result = await createCompany(OWNER, { name });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
}

const row = (id: string) =>
  withTenant(OWNER, (tx) =>
    tx.company.findUniqueOrThrow({
      where: { id },
      select: { stage: true, claimedById: true, claimExpiresAt: true, lastContactedAt: true, nextFollowUpAt: true, archivedAt: true },
    }),
  );
const outreachCount = () => withTenant(OWNER, (tx) => tx.outreach.count());
const historyOf = (companyId: string) =>
  withTenant(OWNER, (tx) => tx.stageChange.findMany({ where: { companyId }, select: { fromStage: true, toStage: true, changedById: true } }));

// Tests may set claim fields directly (raw SQL is allowed in tests); the app never does.
const expireClaim = (id: string) =>
  withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() - interval '1 minute' WHERE id = ${id}`);
const setStage = (id: string, stage: string) =>
  withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET stage = ${stage}::"Stage" WHERE id = ${id}`);

const outreach = async (days = 7, extra: Partial<OutreachInput> = {}): Promise<OutreachInput> => ({
  channel: "EMAIL",
  note: "Sent the sponsorship packet",
  followUpOn: addDays(await dbToday(), days),
  ...extra,
});

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("claimCompany", () => {
  it("claims a free company for the workspace's claim window, timed by the database clock", async () => {
    const id = await company();
    const result = await claimCompany(OFFICER, id);
    expect(result.ok).toBe(true);
    const now = await dbNow();
    const { claimedById, claimExpiresAt } = await row(id);
    expect(claimedById).toBe("officerA");
    // 14 days, give or take the few milliseconds between the claim and reading the clock.
    expect(Math.abs(claimExpiresAt!.getTime() - (now.getTime() + 14 * DAY))).toBeLessThan(5000);
  });

  it("uses the workspace's own claim window", async () => {
    await prisma.workspace.update({ where: { id: "a" }, data: { claimWindowDays: 3 } });
    const id = await company();
    const result = await claimCompany(OFFICER, id);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.claimExpiresAt.getTime() - (await dbNow()).getTime()).toBeGreaterThan(3 * DAY - 5000);
    expect(result.data.claimExpiresAt.getTime() - (await dbNow()).getTime()).toBeLessThan(3 * DAY + 5000);
  });

  it("renews when the holder claims again", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() + interval '1 day' WHERE id = ${id}`);
    expect((await claimCompany(OFFICER, id)).ok).toBe(true);
    expect((await row(id)).claimExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
  });

  it("refuses while someone else holds it, saying who and until when", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    expect(await claimCompany(OFFICER, id)).toEqual({ ok: false, error: expect.stringMatching(/^ownerA claimed this first\. They hold it until /) });
    // The short date used everywhere ("Nov 21"), no clock time.
    expect(await claimCompany(OFFICER, id)).toEqual({ ok: false, error: expect.stringMatching(/until [A-Z][a-z]{2} \d{1,2}\.$/) });
    expect((await row(id)).claimedById).toBe("ownerA");
  });

  it("lets someone else take an expired claim", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    await expireClaim(id);
    expect((await claimCompany(OFFICER, id)).ok).toBe(true);
    expect((await row(id)).claimedById).toBe("officerA");
  });

  test.for(["COMMITTED", "DECLINED"])("refuses a %s company", async (stage) => {
    const id = await company();
    await setStage(id, stage);
    expect(await claimCompany(OFFICER, id)).toEqual({ ok: false, error: expect.stringContaining("so it can't be claimed") });
  });

  it("refuses an archived company and one that doesn't exist", async () => {
    const id = await company();
    await archiveCompany(OWNER, id);
    expect(await claimCompany(OFFICER, id)).toEqual({ ok: false, error: "Company not found." });
    expect(await claimCompany(OFFICER, "missing")).toEqual({ ok: false, error: "Company not found." });
  });

  it("two people claiming at the same moment: exactly one wins, 50 times out of 50", async () => {
    for (let round = 0; round < 50; round++) {
      const id = await company(`Race ${round}`);
      const results = await Promise.all([claimCompany(OWNER, id), claimCompany(OFFICER, id)]);
      const winners = results.filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      const winner = results[0].ok ? "ownerA" : "officerA";
      expect((await row(id)).claimedById).toBe(winner);
    }
  });
});

describe("releasing claims", () => {
  it("lets the holder release, and nobody else", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    expect(await releaseClaim(OWNER, id)).toEqual({ ok: false, error: "You don't hold this company." });
    expect(await releaseClaim(OFFICER, id)).toEqual({ ok: true, data: undefined });
    expect(await row(id)).toMatchObject({ claimedById: null, claimExpiresAt: null });
  });

  it("force release: an officer can't, an owner can", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    expect(await forceRelease(OFFICER, id)).toEqual({ ok: false, error: "Only an owner can force-release a claim." });
    expect((await row(id)).claimedById).toBe("officerA");
    expect(await forceRelease(OWNER, id)).toEqual({ ok: true, data: undefined });
    expect((await row(id)).claimedById).toBeNull();
    expect(await forceRelease(OWNER, id)).toEqual({ ok: false, error: "Nobody holds this company." });
  });

  it("releases every claim one person holds in the workspace, and only theirs", async () => {
    const [x, y, z] = [await company("X"), await company("Y"), await company("Z")];
    await claimCompany(OFFICER, x);
    await claimCompany(OFFICER, y);
    await claimCompany(OWNER, z);
    expect(await releaseClaimsOf(OWNER, "officerA")).toBe(2);
    expect((await row(x)).claimedById).toBeNull();
    expect((await row(y)).claimedById).toBeNull();
    expect((await row(z)).claimedById).toBe("ownerA");
  });
});

describe("logOutreach", () => {
  it("records the outreach, sets the dates, renews the claim, and moves Not contacted to Contacted", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() + interval '1 day' WHERE id = ${id}`);
    const input = await outreach(7);

    const result = await logOutreach(OFFICER, id, input);
    expect(result).toEqual({ ok: true, data: { outreachId: expect.any(String) } });

    const after = await row(id);
    expect(after.stage).toBe("CONTACTED");
    expect(after.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    expect(Math.abs(after.lastContactedAt!.getTime() - (await dbNow()).getTime())).toBeLessThan(5000);
    // Midnight in West Lafayette on the chosen day.
    const [{ local }] = await withTenant(OWNER, (tx) =>
      tx.$queryRaw<{ local: string }[]>`
        SELECT to_char("nextFollowUpAt" AT TIME ZONE 'America/Indiana/Indianapolis', 'YYYY-MM-DD HH24:MI') AS local
        FROM "Company" WHERE id = ${id}`,
    );
    expect(local).toBe(`${input.followUpOn} 00:00`);
    expect(await withTenant(OWNER, (tx) => tx.outreach.findMany({ select: { senderId: true, channel: true, note: true } }))).toEqual([
      { senderId: "officerA", channel: "EMAIL", note: "Sent the sponsorship packet" },
    ]);
    expect(await historyOf(id)).toEqual([{ fromStage: "NOT_CONTACTED", toStage: "CONTACTED", changedById: "officerA" }]);
  });

  it("leaves a later stage alone and adds no history for it", async () => {
    const id = await company();
    await setStage(id, "REPLIED");
    await claimCompany(OFFICER, id);
    expect((await logOutreach(OFFICER, id, await outreach(3, { channel: "LINKEDIN", note: null }))).ok).toBe(true);
    expect((await row(id)).stage).toBe("REPLIED");
    expect(await historyOf(id)).toEqual([]);
  });

  test.for([
    [0, true],
    [365, true],
    [-1, false],
    [366, false],
  ] as const)("a follow-up %i days from today is allowed: %s", async ([days, allowed]) => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const result = await logOutreach(OFFICER, id, await outreach(days));
    expect(result.ok).toBe(allowed);
    expect(await outreachCount()).toBe(allowed ? 1 : 0);
  });

  it("an expired claim taken by someone else: the old holder's log is refused and writes nothing", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await expireClaim(id);
    await claimCompany(OWNER, id);
    const before = await row(id);

    const result = await logOutreach(OFFICER, id, await outreach());
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^ownerA holds this company now, until .*Nothing was saved\.$/) });
    expect(await row(id)).toEqual(before);
    expect(await outreachCount()).toBe(0);
    expect(await historyOf(id)).toEqual([]);
  });

  // Changed by the de-bloat pass: the page now offers the log form on your own
  // expired claim, and saving claims it again, so the log is no longer refused.
  it("your own expired claim that nobody took since: logging renews it", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await expireClaim(id);
    expect(await logOutreach(OFFICER, id, await outreach())).toEqual({ ok: true, data: { outreachId: expect.any(String) } });
    const after = await row(id);
    expect(after.claimedById).toBe("officerA");
    expect(after.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    expect(await outreachCount()).toBe(1);
  });

  it("refuses without a claim, on a closed company, and on one that doesn't exist", async () => {
    const id = await company();
    expect(await logOutreach(OFFICER, id, await outreach())).toEqual({ ok: false, error: expect.stringContaining("Claim this company before") });
    await claimCompany(OFFICER, id);
    await setStage(id, "DECLINED");
    expect(await logOutreach(OFFICER, id, await outreach())).toEqual({ ok: false, error: "This company is Declined. Nothing was saved." });
    expect(await logOutreach(OFFICER, "missing", await outreach())).toEqual({ ok: false, error: "Company not found." });
    expect(await outreachCount()).toBe(0);
  });

  it("two logs racing a takeover: the holder's log and a new claim never both win on an expired claim", async () => {
    for (let round = 0; round < 20; round++) {
      const id = await company(`Takeover ${round}`);
      await claimCompany(OFFICER, id);
      await expireClaim(id);
      const before = await outreachCount();
      const [logged, claimed] = await Promise.all([logOutreach(OFFICER, id, await outreach()), claimCompany(OWNER, id)]);
      // Logging renews your own expired claim, so whichever reaches the row first wins,
      // and never both: a won log keeps the company for the officer, a won claim writes no outreach.
      expect(logged.ok !== claimed.ok).toBe(true);
      expect((await row(id)).claimedById).toBe(logged.ok ? "officerA" : "ownerA");
      expect(await outreachCount()).toBe(before + (logged.ok ? 1 : 0));
    }
  });

  it("the same entry twice (one clientKey) logs once, at the same moment or one after the other", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const input = await outreach(7, { clientKey: "6f1c1f1e-8a6f-4d8e-9f39-0c8a4b2d7e11" });
    const [a, b] = await Promise.all([logOutreach(OFFICER, id, input), logOutreach(OFFICER, id, input)]);
    expect(a).toEqual({ ok: true, data: { outreachId: expect.any(String) } });
    expect(b).toEqual(a);
    expect(await outreachCount()).toBe(1);
    // A retry later: still the same row, nothing new.
    expect(await logOutreach(OFFICER, id, input)).toEqual(a);
    expect(await outreachCount()).toBe(1);
    expect(await historyOf(id)).toHaveLength(1);
    // A new key is a new entry.
    expect((await logOutreach(OFFICER, id, { ...input, clientKey: "0b7d2c1a-3e4f-4a5b-8c6d-7e8f9a0b1c2d" })).ok).toBe(true);
    expect(await outreachCount()).toBe(2);
  });

  it("a key already used on another company is refused, not credited to it", async () => {
    const one = await company("One");
    const two = await company("Two");
    await claimCompany(OFFICER, one);
    await claimCompany(OFFICER, two);
    const input = await outreach(7, { clientKey: "6f1c1f1e-8a6f-4d8e-9f39-0c8a4b2d7e11" });
    expect((await logOutreach(OFFICER, one, input)).ok).toBe(true);
    expect(await logOutreach(OFFICER, two, input)).toEqual({ ok: false, error: "Company not found." });
    expect(await outreachCount()).toBe(1);
  });
});

describe("a live claim protects the company from others", () => {
  it("stage moves: blocked for another officer, allowed for the holder and for an owner", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    expect(await changeStage(OFFICER, id, "REPLIED")).toEqual({ ok: false, error: expect.stringMatching(/^ownerA holds this company until .*Ask them, or an owner\.$/) });
    expect((await row(id)).stage).toBe("NOT_CONTACTED");
    expect((await changeStage(OWNER, id, "REPLIED")).ok).toBe(true);

    await forceRelease(OWNER, id);
    await claimCompany(OFFICER, id);
    expect((await changeStage(OWNER, id, "IN_CONVERSATION")).ok).toBe(true);
    expect((await changeStage(OFFICER, id, "COMMITTED")).ok).toBe(true);
    expect(await row(id)).toMatchObject({ stage: "COMMITTED", claimedById: null, claimExpiresAt: null });
  });

  it("an expired claim protects nothing", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    await expireClaim(id);
    expect((await changeStage(OFFICER, id, "REPLIED")).ok).toBe(true);
  });

  it("archiving: blocked for another officer, allowed for an owner, and the claim is cleared", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    expect(await archiveCompany(OFFICER, id)).toEqual({ ok: false, error: expect.stringContaining("ownerA holds this company") });
    expect((await row(id)).archivedAt).toBeNull();

    await forceRelease(OWNER, id);
    await claimCompany(OFFICER, id);
    expect(await archiveCompany(OWNER, id)).toEqual({ ok: true, data: undefined });
    expect(await row(id)).toMatchObject({ claimedById: null, claimExpiresAt: null });
    await unarchiveCompany(OWNER, id);
    expect(await row(id)).toMatchObject({ archivedAt: null, claimedById: null });
  });

  it("the holder can archive their own company, and archiving twice says not found", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    expect((await archiveCompany(OFFICER, id)).ok).toBe(true);
    expect(await archiveCompany(OFFICER, id)).toEqual({ ok: false, error: "Company not found." });
  });

  it("'same company: archive this one' follows the same rule", async () => {
    const keep = await company("Acme");
    const dupe = await company("Globex");
    await claimCompany(OWNER, dupe);
    expect(await resolveAsDuplicate(OFFICER, keep, dupe)).toEqual({ ok: false, error: expect.stringContaining("ownerA holds this company") });
    expect((await resolveAsDuplicate(OWNER, keep, dupe)).ok).toBe(true);
    expect(await row(dupe)).toMatchObject({ claimedById: null });
    expect((await row(dupe)).archivedAt).not.toBeNull();
  });
});

describe("another workspace can't touch A's claims", () => {
  it("refuses every claim function and changes nothing", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const before = await row(id);
    const asB = { ...OTHER_ORG };
    expect(await claimCompany(asB, id)).toEqual({ ok: false, error: "Company not found." });
    expect((await releaseClaim(asB, id)).ok).toBe(false);
    expect((await forceRelease(asB, id)).ok).toBe(false);
    expect(await releaseClaimsOf(asB, "officerA")).toBe(0);
    expect(await logOutreach(asB, id, await outreach())).toEqual({ ok: false, error: "Company not found." });
    expect(await changeStage(asB, id, "REPLIED")).toEqual({ ok: false, error: "Company not found." });
    expect(await row(id)).toEqual(before);
    expect(await outreachCount()).toBe(0);
  });
});

describe("claim actions", () => {
  const ref = (companyId: string) => ({ workspaceId: "a", companyId });

  it("claims and logs outreach through the form", async () => {
    const id = await company();
    expect(await asUser("officerA", () => claimAction(null, form(ref(id))))).toEqual({ ok: true, data: undefined });
    const fields = { ...ref(id), channel: "IN_PERSON", note: " Met at the career fair ", followUpOn: addDays(await dbToday(), 7) };
    expect(await asUser("officerA", () => logOutreachAction(null, form(fields)))).toEqual({ ok: true, data: undefined });
    expect(await withTenant(OWNER, (tx) => tx.outreach.findFirst({ select: { channel: true, note: true } }))).toEqual({
      channel: "IN_PERSON",
      note: "Met at the career fair",
    });
  });

  test.for([
    [{ channel: "CARRIER_PIGEON" }, "Pick how you reached out."],
    [{ followUpOn: "2026-02-30" }, "Pick a follow-up date."],
    [{ followUpOn: "next week" }, "Pick a follow-up date."],
    [{ note: "x".repeat(2001) }, "Note can be at most 2000 characters."],
  ] as const)("refuses %j", async ([bad, error]) => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const fields = { ...ref(id), channel: "EMAIL", note: "", followUpOn: addDays(await dbToday(), 7), ...bad };
    expect(await asUser("officerA", () => logOutreachAction(null, form(fields)))).toEqual({ ok: false, error });
    expect(await outreachCount()).toBe(0);
  });

  it("releases through the form: Release for the holder, Force release for an owner", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    expect(await asUser("ownerA", () => releaseAction(null, form(ref(id))))).toEqual({ ok: false, error: "You don't hold this company." });
    expect(await asUser("officerA", () => releaseAction(null, form(ref(id))))).toEqual({ ok: true, data: undefined });
    await claimCompany(OFFICER, id);
    expect(await asUser("ownerA", () => forceReleaseAction(null, form(ref(id))))).toEqual({ ok: true, data: undefined });
    expect((await row(id)).claimedById).toBeNull();
    expect(await asUser("ownerA", () => forceReleaseAction(null, form(ref(id))))).toEqual({ ok: false, error: "Nobody holds this company." });
  });

  it("refuses malformed ids and a lost claim through the form", async () => {
    const bad = form({ workspaceId: "a", companyId: "" });
    for (const action of [claimAction, releaseAction, forceReleaseAction]) {
      expect(await asUser("ownerA", () => action(null, bad))).toEqual({ ok: false, error: "Company not found." });
    }
    const id = await company();
    await claimCompany(OWNER, id);
    expect(await asUser("officerA", () => claimAction(null, form(ref(id))))).toEqual({ ok: false, error: expect.stringContaining("claimed this first") });
    expect(await asUser("officerA", () => logOutreachAction(null, form({ ...ref(id), channel: "EMAIL", followUpOn: "2026-12-01" })))).toEqual({
      ok: false,
      error: expect.stringContaining("Nothing was saved."),
    });
  });

  it("force release from an officer is refused before reaching the claim", async () => {
    const id = await company();
    await claimCompany(OWNER, id);
    expect(await asUser("officerA", () => forceReleaseAction(null, form(ref(id))))).toEqual({
      ok: false,
      error: "Only the workspace owner can do that.",
    });
    expect((await row(id)).claimedById).toBe("ownerA");
  });
});

describe("what pages show for a claim", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const claim = (claimedById: string | null, expires: string | null) => ({
    claimedById,
    claimExpiresAt: expires ? new Date(expires) : null,
  });

  test.for([
    [claim(null, null), "free"],
    [claim("officerA", "2026-11-01T00:00:00Z"), "mine"],
    [claim("ownerA", "2026-11-01T00:00:00Z"), "theirs"],
    [claim("ownerA", "2026-10-25T11:59:59Z"), "expired"],
    // Expiring exactly now counts as expired, matching the claim SQL (`<= now()` can be taken).
    [claim("ownerA", "2026-10-25T12:00:00Z"), "expired"],
  ] as const)("%j is %s for officerA", ([c, state]) => {
    expect(claimState(c, now, "officerA")).toBe(state);
  });

  // The company page tells your own expired claim apart, to speak to you about it.
  test.for([
    [claim(null, null), "free"],
    [claim("officerA", "2026-11-01T00:00:00Z"), "mine"],
    [claim("ownerA", "2026-11-01T00:00:00Z"), "theirs"],
    [claim("ownerA", "2026-10-25T11:59:59Z"), "expired"],
    [claim("officerA", "2026-10-25T11:59:59Z"), "expired-mine"],
    [claim("officerA", "2026-10-25T12:00:00Z"), "expired-mine"],
  ] as const)("claimView: %j is %s for officerA", ([c, view]) => {
    expect(claimView(c, now, "officerA")).toBe(view);
  });

  it("dbNow and dbToday read the same database clock", async () => {
    const [now, today] = [await dbNow(), await dbToday()];
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(60_000);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists the outreach channels in form order with their labels", () => {
    expect(CHANNELS.map((c) => CHANNEL_LABELS[c])).toEqual(["Email", "LinkedIn", "In person", "Other"]);
  });

  test.for([
    ["2026-10-25", 7, "2026-11-01"],
    ["2026-12-28", 7, "2027-01-04"],
    ["2026-10-31", 1, "2026-11-01"],
    ["2028-02-28", 1, "2028-02-29"],
  ] as const)("%s plus %i days is %s, daylight saving or not", ([from, days, to]) => {
    expect(addDays(from, days)).toBe(to);
  });
});

describe("people leaving release their claims", () => {
  it("removing a member releases their claims", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const result = await asUser("ownerA", () => removeMember(null, form({ workspaceId: "a", memberId: "m-officerA" })));
    expect(result).toEqual({ ok: true, data: undefined });
    expect((await row(id)).claimedById).toBeNull();
  });

  it("removing someone who isn't in this workspace says so and changes nothing", async () => {
    const result = await asUser("ownerA", () => removeMember(null, form({ workspaceId: "a", memberId: "m-ownerB" })));
    expect(result).toEqual({ ok: false, error: "Member not found." });
    expect(await prisma.membership.count()).toBe(3);
  });

  it("leaving releases your own claims", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await expect(asUser("officerA", () => leaveWorkspace(null, form({ workspaceId: "a" })))).rejects.toEqual(redirectTo("/workspaces"));
    expect((await row(id)).claimedById).toBeNull();
  });
});
