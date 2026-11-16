import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCalendar, approveRest, buildCodeCards, reopenForNextYear, saveRecontactDates, startHandoff } from "@/app/(app)/[workspaceId]/capsule/actions";
import { FOLLOW_UP_RANGE_MESSAGE, claimCompany, dbToday } from "@/lib/claims";
import { addDays, dayString } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import * as capsule from "@/lib/capsule";
import { NO_CARD, NO_HANDOFF } from "@/lib/capsule/shared";
import { form } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";
import { inYear, lastYear, OFFICER, OTHER_OWNER, OWNER, seedHandoff } from "./helpers/capsule";

vi.mock("next/headers", () => import("./helpers/next-request"));
// A spy, so a test can check which pages the actions refresh.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

// The two clicks of the re-contact calendar that change a company: Apply (setFollowUp, one company
// after another, with every refusal reported) and Reopen for next year (changeStage, one company).
// Against the real database as app_user. The handoff is built from code-only cards, so no model is
// involved; the fixture is dated in last year's board year (tests/helpers/capsule.ts).

let year: number;
let today: string;

const ok = <T>(result: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
const call = <R>(user: string, action: (prev: null, data: FormData) => Promise<R>, fields: Record<string, string> = {}, workspaceId = "a") =>
  asUser(user, () => action(null, form({ workspaceId, ...fields })));

// An approved handoff of the fixture: Atlas (Committed), Cedar and Birch (In conversation), Delta
// (Replied), Echo (Contacted), Fjord (Declined), all with code-only cards.
async function approvedHandoff() {
  const started = ok(await call("ownerA", startHandoff, { boardYearStart: String(year) }));
  ok(await call("ownerA", buildCodeCards, { reportId: started.reportId }));
  ok(await call("ownerA", approveRest, { reportId: started.reportId }));
  return started.reportId;
}
const dates = (reportId: string, entries: { companyId: string; date: string | null }[]) =>
  call("ownerA", saveRecontactDates, { reportId, dates: JSON.stringify(entries) });
const company = (id: string) => withTenant(OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id }, select: { stage: true, nextFollowUpAt: true, claimedById: true, updatedAt: true } }));
const companies = () => withTenant(OWNER, (tx) => tx.company.findMany({ orderBy: { id: "asc" } }));
const counts = () => withTenant(OWNER, async (tx) => ({ outreach: await tx.outreach.count(), contacts: await tx.contact.count(), changes: await tx.stageChange.count() }));
const cardOf = (reportId: string, companyId: string) =>
  withTenant(OWNER, (tx) => tx.relationshipCard.findFirstOrThrow({ where: { reportId, companyId } }));

beforeEach(async () => {
  await resetAndSeed();
  revalidatePath.mockClear();
  year = await lastYear();
  today = await dbToday();
  await seedHandoff(year);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Apply: each saved date goes through setFollowUp", () => {
  it("sets the dates on the companies and reports what was set", async () => {
    const reportId = await approvedHandoff();
    const cedar = addDays(today, 30);
    const echo = addDays(today, 90);
    ok(await dates(reportId, [{ companyId: "co-cedar", date: cedar }, { companyId: "co-echo", date: echo }]));
    const before = await counts();

    const result = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(result.set).toEqual([
      { companyId: "co-cedar", name: "Cedar", date: cedar },
      { companyId: "co-echo", name: "Echo", date: echo },
    ]);
    expect(result.set.map((s) => s.companyId)).not.toContain("co-birch");
    // The stored time is midnight in West Lafayette on that day.
    expect(dayString((await company("co-cedar")).nextFollowUpAt as Date)).toBe(cedar);
    expect(dayString((await company("co-echo")).nextFollowUpAt as Date)).toBe(echo);
    // Birch, Delta and Atlas have a proposed date or none; none of the others was touched.
    expect(await counts()).toEqual(before);
  });

  it("applies in bulk and again: the same dates are simply set again", async () => {
    const reportId = await approvedHandoff();
    const entries = ["co-cedar", "co-birch", "co-delta", "co-echo"].map((companyId, i) => ({ companyId, date: addDays(today, 10 + i) }));
    ok(await dates(reportId, entries));
    const first = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(first.set).toHaveLength(4);
    const second = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(second.set).toEqual(first.set);
    expect(second.refused).toEqual([]);
  });

  it("reports a company held by someone else as refused, with the holder's name, and sets the others", async () => {
    const reportId = await approvedHandoff();
    ok(await claimCompany(OFFICER, "co-cedar"));
    ok(await dates(reportId, [{ companyId: "co-cedar", date: addDays(today, 20) }, { companyId: "co-echo", date: addDays(today, 21) }]));
    const result = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(result.set.map((s) => s.companyId)).toEqual(["co-echo"]);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]).toMatchObject({ companyId: "co-cedar", name: "Cedar" });
    expect(result.refused[0].reason).toMatch(/holds this company until/);
    // Cedar keeps the follow-up it had; the claim is untouched.
    expect((await company("co-cedar")).nextFollowUpAt).toBeNull();
    expect((await company("co-cedar")).claimedById).toBe("officerA");
  });

  it("leaves a Declined company alone with its reason and skips a Committed one quietly, counting it as closed", async () => {
    const reportId = await approvedHandoff();
    // Atlas (Committed) holds a date from the handoff: its bullets are none, so give it one by hand.
    await withTenant(OWNER, (tx) => tx.relationshipCard.updateMany({ where: { reportId, companyId: { in: ["co-atlas", "co-fjord"] } }, data: { recontactOn: addDays(today, 40) } }));
    const before = { atlas: await company("co-atlas"), fjord: await company("co-fjord") };
    const result = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(result.set).toEqual([]);
    expect(result.skippedClosed).toBe(1);
    expect(result.refused.map((r) => [r.companyId, r.reason])).toEqual([["co-fjord", "This company declined, so it is left alone."]]);
    expect(await company("co-atlas")).toEqual(before.atlas);
    expect(await company("co-fjord")).toEqual(before.fjord);
  });

  it("refuses a date that has passed since it was saved, with the follow-up range message", async () => {
    const reportId = await approvedHandoff();
    await withTenant(OWNER, (tx) => tx.relationshipCard.updateMany({ where: { reportId, companyId: "co-echo" }, data: { recontactOn: addDays(today, -3) } }));
    const result = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(result.refused).toEqual([{ companyId: "co-echo", name: "Echo", reason: FOLLOW_UP_RANGE_MESSAGE }]);
    expect((await company("co-echo")).nextFollowUpAt).toBeNull();
  });

  it("counts cards with no date as blank and does nothing for them", async () => {
    const reportId = await approvedHandoff();
    const before = await companies();
    const result = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(result.set).toEqual([]);
    expect(result.blank).toBeGreaterThan(0);
    expect(await companies()).toEqual(before);
  });

  it("skips a hidden card and a card that was never approved", async () => {
    const started = ok(await call("ownerA", startHandoff, { boardYearStart: String(year) }));
    ok(await call("ownerA", buildCodeCards, { reportId: started.reportId }));
    const cedar = await cardOf(started.reportId, "co-cedar");
    const echo = await cardOf(started.reportId, "co-echo");
    await withTenant(OWNER, async (tx) => {
      await tx.relationshipCard.updateMany({ where: { id: { in: [cedar.id, echo.id] } }, data: { approvedAt: new Date(), approvedById: "ownerA", recontactOn: addDays(today, 15) } });
      await tx.archiveRedaction.create({ data: { workspaceId: "a", cardId: cedar.id, bulletIndex: null, hiddenById: "ownerA" } });
      await tx.relationshipCard.updateMany({ where: { id: echo.id }, data: { approvedAt: null } });
    });
    const result = ok(await call("ownerA", applyCalendar, { reportId: started.reportId }));
    expect(result).toEqual({ set: [], refused: [], blank: 0, skippedClosed: 0 });
  });

  it("works on a published handoff too: it is the companies' dates, not the report's", async () => {
    const reportId = await approvedHandoff();
    ok(await dates(reportId, [{ companyId: "co-echo", date: addDays(today, 12) }]));
    await withTenant(OWNER, (tx) => tx.handoffReport.update({ where: { id: reportId }, data: { status: "PUBLISHED", publishedAt: new Date() } }));
    expect(ok(await call("ownerA", applyCalendar, { reportId })).set.map((s) => s.companyId)).toEqual(["co-echo"]);
  });

  it("refreshes the capsule, the queue and the board only when something was set", async () => {
    const reportId = await approvedHandoff();
    revalidatePath.mockClear();
    ok(await call("ownerA", applyCalendar, { reportId }));
    expect(revalidatePath).not.toHaveBeenCalled();
    ok(await dates(reportId, [{ companyId: "co-echo", date: addDays(today, 12) }]));
    revalidatePath.mockClear();
    ok(await call("ownerA", applyCalendar, { reportId }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/a/capsule", "/a", "/a/board"]);
  });

  it("refuses an officer and writes nothing", async () => {
    const reportId = await approvedHandoff();
    ok(await dates(reportId, [{ companyId: "co-echo", date: addDays(today, 12) }]));
    const before = await companies();
    expect(await call("officerA", applyCalendar, { reportId })).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await capsule.applyCalendar(OFFICER, reportId)).toMatchObject({ ok: false });
    expect(await companies()).toEqual(before);
  });

  it("refuses another workspace's handoff, whoever asks", async () => {
    await withTenant(OTHER_OWNER, async (tx) => {
      await tx.company.create({ data: { id: "co-b", workspaceId: "b", name: "Bee", nameKey: "bee" } });
      await tx.outreach.create({ data: { id: "o-b", workspaceId: "b", companyId: "co-b", senderId: "ownerB", sentAt: inYear(year, 10, 1), note: "Bee note" } });
    });
    const b = ok(await call("ownerB", startHandoff, { boardYearStart: String(year) }, "b"));
    ok(await call("ownerB", buildCodeCards, { reportId: b.reportId }, "b"));
    ok(await call("ownerB", approveRest, { reportId: b.reportId }, "b"));
    await withTenant(OTHER_OWNER, (tx) => tx.relationshipCard.updateMany({ data: { recontactOn: addDays(today, 9) } }));
    expect(await call("ownerA", applyCalendar, { reportId: b.reportId })).toEqual({ ok: false, error: NO_HANDOFF });
    expect(await call("ownerB", applyCalendar, { reportId: (await approvedHandoff()) }, "b")).toEqual({ ok: false, error: NO_HANDOFF });
    const bee = await withTenant(OTHER_OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id: "co-b" } }));
    expect(bee.nextFollowUpAt).toBeNull();
  });

  it("checks its input", async () => {
    expect(await call("ownerA", applyCalendar, { reportId: "" })).toMatchObject({ ok: false });
    expect(await call("ownerA", applyCalendar, { reportId: "nope" })).toEqual({ ok: false, error: NO_HANDOFF });
  });
});

describe("Reopen for next year: one Committed company, through changeStage", () => {
  it("moves a Committed company back to Contacted and records the move", async () => {
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    const before = await counts();
    const result = ok(await call("ownerA", reopenForNextYear, { cardId: atlas.id }));
    expect(result).toEqual({ companyId: "co-atlas", name: "Atlas" });
    expect((await company("co-atlas")).stage).toBe("CONTACTED");
    expect(await counts()).toEqual({ ...before, changes: before.changes + 1 });
    const change = await withTenant(OWNER, (tx) => tx.stageChange.findFirstOrThrow({ where: { companyId: "co-atlas", toStage: "CONTACTED" }, orderBy: { changedAt: "desc" } }));
    expect(change).toMatchObject({ fromStage: "COMMITTED", toStage: "CONTACTED", changedById: "ownerA", via: "APP" });
  });

  it("lets Apply set the date once the company is reopened", async () => {
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    const date = addDays(today, 60);
    await withTenant(OWNER, (tx) => tx.relationshipCard.update({ where: { id: atlas.id }, data: { recontactOn: date } }));
    const closed = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(closed.skippedClosed).toBe(1);
    expect(closed.refused.map((r) => r.companyId)).not.toContain("co-atlas");
    expect(closed.set.map((s) => s.companyId)).not.toContain("co-atlas");
    ok(await call("ownerA", reopenForNextYear, { cardId: atlas.id }));
    const rows = ok(await capsule.loadCalendar(OWNER, reportId));
    expect(rows.find((r) => r.companyId === "co-atlas")).toMatchObject({ closed: null, date, followUp: null });
    const applied = ok(await call("ownerA", applyCalendar, { reportId }));
    expect(applied.set.map((s) => s.companyId)).toContain("co-atlas");
    expect(dayString((await company("co-atlas")).nextFollowUpAt as Date)).toBe(date);
    expect(ok(await capsule.loadCalendar(OWNER, reportId)).find((r) => r.companyId === "co-atlas")?.followUp).toBe(date);
  });

  it("refuses a company that is not Committed, and changes nothing", async () => {
    const reportId = await approvedHandoff();
    for (const [companyId, name] of [["co-cedar", "Cedar"], ["co-fjord", "Fjord"], ["co-echo", "Echo"]]) {
      const card = await cardOf(reportId, companyId);
      const before = await company(companyId);
      expect(await call("ownerA", reopenForNextYear, { cardId: card.id })).toEqual({ ok: false, error: `${name} is not Committed, so there is nothing to reopen.` });
      expect(await company(companyId)).toEqual(before);
    }
  });

  it("refuses twice in a row: the second click finds it already reopened", async () => {
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    ok(await call("ownerA", reopenForNextYear, { cardId: atlas.id }));
    expect(await call("ownerA", reopenForNextYear, { cardId: atlas.id })).toMatchObject({ ok: false });
    expect(await withTenant(OWNER, (tx) => tx.stageChange.count({ where: { companyId: "co-atlas", toStage: "CONTACTED" } }))).toBe(1);
  });

  it("takes a card that is approved: an unapproved card is not found", async () => {
    const started = ok(await call("ownerA", startHandoff, { boardYearStart: String(year) }));
    ok(await call("ownerA", buildCodeCards, { reportId: started.reportId }));
    const atlas = await cardOf(started.reportId, "co-atlas");
    expect(await call("ownerA", reopenForNextYear, { cardId: atlas.id })).toEqual({ ok: false, error: NO_CARD });
    expect((await company("co-atlas")).stage).toBe("COMMITTED");
  });

  it("refuses an officer", async () => {
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    expect(await call("officerA", reopenForNextYear, { cardId: atlas.id })).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await capsule.reopenForNextYear(OFFICER, atlas.id)).toMatchObject({ ok: false });
    expect((await company("co-atlas")).stage).toBe("COMMITTED");
  });

  it("refuses another workspace's card, from either side", async () => {
    await withTenant(OTHER_OWNER, async (tx) => {
      await tx.company.create({ data: { id: "co-b", workspaceId: "b", name: "Bee", nameKey: "bee", stage: "COMMITTED" } });
      await tx.outreach.create({ data: { id: "o-b", workspaceId: "b", companyId: "co-b", senderId: "ownerB", sentAt: inYear(year, 10, 1), note: "Bee note" } });
    });
    const b = ok(await call("ownerB", startHandoff, { boardYearStart: String(year) }, "b"));
    ok(await call("ownerB", buildCodeCards, { reportId: b.reportId }, "b"));
    ok(await call("ownerB", approveRest, { reportId: b.reportId }, "b"));
    const bCard = await withTenant(OTHER_OWNER, (tx) => tx.relationshipCard.findFirstOrThrow());
    expect(await call("ownerA", reopenForNextYear, { cardId: bCard.id })).toEqual({ ok: false, error: NO_CARD });
    expect(await capsule.reopenForNextYear(OWNER, bCard.id)).toEqual({ ok: false, error: NO_CARD });
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    expect(await call("ownerB", reopenForNextYear, { cardId: atlas.id }, "b")).toEqual({ ok: false, error: NO_CARD });
    expect((await withTenant(OTHER_OWNER, (tx) => tx.company.findUniqueOrThrow({ where: { id: "co-b" } }))).stage).toBe("COMMITTED");
    expect((await company("co-atlas")).stage).toBe("COMMITTED");
  });

  it("refreshes the capsule, the queue, the board and the company page when it works", async () => {
    const reportId = await approvedHandoff();
    const atlas = await cardOf(reportId, "co-atlas");
    revalidatePath.mockClear();
    ok(await call("ownerA", reopenForNextYear, { cardId: atlas.id }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/a/capsule", "/a", "/a/board", "/a/companies/co-atlas"]);
  });
});
