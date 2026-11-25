import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbNow, dbToday } from "@/lib/claims";
import { localMidnight } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { buildFactTable } from "@/lib/scorecard/facts";
import * as stats from "@/lib/stats";
import { countFacts, isQuiet, readWeeklyCounts, trendText, verdictFacts, weeklyLines, type WeeklyCounts } from "@/lib/weekly-brief/facts";
import { weekRanges } from "@/lib/weekly-brief/week";
import { resetAndSeed } from "./helpers/seed";
import { seedStatsFixture } from "./helpers/stats-fixture";
import { seedWeeklyFixture, WEEKLY_FIXTURE_COUNTS, WEEKLY_OFFICER, WEEKLY_OTHER_ORG, WEEKLY_OWNER } from "./helpers/weekly-brief";

// The Monday brief's counts against the real database (the fixture in tests/helpers/weekly-brief.ts
// says how each number comes about), the facts built from them, and the plain lines.

let weekStart: string;

beforeEach(async () => {
  await resetAndSeed();
  ({ weekStart } = await seedWeeklyFixture());
});

afterAll(async () => {
  await prisma.$disconnect();
});

const counts = async (tenant = WEEKLY_OWNER) => {
  const now = await dbNow();
  const today = await dbToday();
  return readWeeklyCounts(tenant, weekStart, weekRanges(weekStart), { now, todayStart: localMidnight(today) });
};

describe("readWeeklyCounts", () => {
  it("counts each number of the fixture", async () => {
    expect(await counts()).toEqual({ weekStart, ...WEEKLY_FIXTURE_COUNTS });
  });

  it("is the same for an officer: the brief is the workspace's", async () => {
    expect(await counts(WEEKLY_OFFICER)).toEqual({ weekStart, ...WEEKLY_FIXTURE_COUNTS });
  });

  it("counts outreach exactly at last Monday 00:00 and not exactly at this Monday 00:00", async () => {
    await withTenant(WEEKLY_OWNER, (tx) => tx.outreach.deleteMany({ where: { id: "w-s1" } }));
    expect((await counts()).last.outreach).toBe(4);
    await withTenant(WEEKLY_OWNER, (tx) => tx.outreach.deleteMany({ where: { id: "w-s6" } }));
    expect((await counts()).last.outreach).toBe(4);
  });

  it("leaves archived companies out of the open counts and out of last week's added", async () => {
    await withTenant(WEEKLY_OWNER, (tx) => tx.company.updateMany({ where: { id: { in: ["w-o5", "w-c4"] } }, data: { archivedAt: new Date(Date.parse("2026-01-01")) } }));
    const c = await counts();
    expect(c.now.overdue).toBe(0);
    expect(c.now.open).toBe(4);
    expect(c.now.freshLeads).toBe(1);
    expect(c.last.added).toBe(3);
  });

  it("never counts Committed or Declined as overdue or due", async () => {
    // w-o1 (Committed) and w-o2 (Declined) get past and this-week follow-ups: nothing changes.
    await withTenant(WEEKLY_OWNER, (tx) => tx.company.updateMany({ where: { id: { in: ["w-o1", "w-o2"] } }, data: { nextFollowUpAt: localMidnight(weekStart) } }));
    const c = await counts();
    expect(c.now.overdue).toBe(WEEKLY_FIXTURE_COUNTS.now.overdue);
    expect(c.now.dueThisWeek).toBe(WEEKLY_FIXTURE_COUNTS.now.dueThisWeek);
  });

  it("counts Replied then Committed in one week once as an answer and once as a commit", async () => {
    const c = await counts();
    expect(c.last.answers).toBe(2);
    expect(c.last.committed).toBe(1);
  });

  it("counts Contacted to Declined as an answer and a decline, Not contacted to Declined and In conversation to Declined as declines only", async () => {
    const only = async (keep: string) => {
      await withTenant(WEEKLY_OWNER, (tx) => tx.stageChange.deleteMany({ where: { workspaceId: "a", id: { not: keep } } }));
      const c = await counts();
      return { answers: c.last.answers, declined: c.last.declined };
    };
    expect(await only("w-m3")).toEqual({ answers: 1, declined: 1 });
    await resetAndSeed();
    await seedWeeklyFixture();
    expect(await only("w-m4")).toEqual({ answers: 0, declined: 1 });
    await resetAndSeed();
    await seedWeeklyFixture();
    expect(await only("w-m5")).toEqual({ answers: 0, declined: 1 });
  });

  it("never counts workspace b's rows for a, nor a's for b", async () => {
    const b = await counts(WEEKLY_OTHER_ORG);
    expect(b.last).toEqual({ outreach: 1, companies: 1, members: 1, answers: 1, committed: 0, declined: 0, added: 1 });
    expect(b.now).toEqual({ overdue: 0, dueThisWeek: 0, claimsEnding: 0, liveClaims: 0, freshLeads: 0, open: 1 });
  });
});

describe("the facts and the lines", () => {
  const fixture = (): WeeklyCounts => ({ weekStart: "2026-11-23", ...WEEKLY_FIXTURE_COUNTS });

  it("writes the trend in code's words, up, down and the same", () => {
    expect(trendText(5, 2)).toBe("3 more than the week before");
    expect(trendText(2, 5)).toBe("3 fewer than the week before");
    expect(trendText(4, 4)).toBe("the same as the week before");
  });

  it("builds every key with text code wrote", () => {
    const facts = countFacts(fixture());
    expect(facts.map((f) => f.key)).toEqual([
      "week.start",
      "week.end",
      "last.outreach",
      "last.companies",
      "last.members",
      "prev.outreach",
      "trend.outreach",
      "last.answers",
      "last.committed",
      "last.declined",
      "last.added",
      "now.overdue",
      "now.dueThisWeek",
      "now.claimsEnding",
      "now.liveClaims",
      "now.freshLeads",
      "now.open",
    ]);
    const text = Object.fromEntries(facts.map((f) => [f.key, f.text]));
    expect(text["week.start"]).toBe("Nov 23");
    expect(text["week.end"]).toBe("Nov 29");
    expect(text["trend.outreach"]).toBe("3 more than the week before");
    expect(text["last.declined"]).toBe("3");
  });

  it("writes the plain lines from the counts alone", () => {
    expect(weeklyLines(fixture())).toEqual([
      "Last week 2 members logged 5 outreach entries to 4 companies, 3 more than the week before.",
      "2 companies answered, 1 committed and 3 declined. 4 companies were added.",
      "This week: 1 follow-up is overdue, 1 is due by Sunday, and 1 claim ends by Sunday.",
      "6 companies are open, 2 held by a claim and 2 fresh leads waiting.",
    ]);
  });

  it("calls a week quiet only when nothing happened and nothing is coming", () => {
    const quiet: WeeklyCounts = {
      weekStart: "2026-11-23",
      last: { outreach: 0, companies: 0, members: 0, answers: 0, committed: 0, declined: 0, added: 0 },
      prev: { outreach: 4 },
      now: { overdue: 0, dueThisWeek: 0, claimsEnding: 0, liveClaims: 3, freshLeads: 7, open: 12 },
    };
    expect(isQuiet(quiet)).toBe(true);
    expect(isQuiet(fixture())).toBe(false);
    for (const change of [{ last: { ...quiet.last, outreach: 1 } }, { now: { ...quiet.now, overdue: 1 } }, { now: { ...quiet.now, claimsEnding: 1 } }, { last: { ...quiet.last, added: 1 } }]) {
      expect(isQuiet({ ...quiet, ...change })).toBe(false);
    }
    expect(weeklyLines(quiet)[0]).toBe("Last week nobody logged outreach.");
  });

  it("builds the lines without reading the stats page", async () => {
    const spy = vi.spyOn(stats, "workspaceStats");
    weeklyLines(await counts());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("verdictFacts", () => {
  it("keeps the stats page's verdict and sample rule, with the names of only the templates it names", async () => {
    await resetAndSeed();
    await seedStatsFixture();
    const table = buildFactTable(await stats.workspaceStats(WEEKLY_OWNER, "none"));
    const verdict = await verdictFacts(WEEKLY_OWNER);
    const byKey = (t: typeof table) => Object.fromEntries(t.facts.map((f) => [f.key, f]));
    for (const key of ["verdict.best", "verdict.worst", "verdict.rated", "rule.minSends", "rule.maturityDays"]) expect(byKey(verdict)[key]).toEqual(byKey(table)[key]);
    // The fixture's verdict among templates in use names Alumni angle best and nothing worst (Cold intro is retired).
    const named = [byKey(table)["verdict.best"].text, byKey(table)["verdict.worst"].text];
    expect(Object.values(verdict.names).every((name) => named.includes(name))).toBe(true);
    expect(Object.keys(verdict.names).length).toBeLessThanOrEqual(2);
    for (const key of Object.keys(verdict.names)) expect(byKey(verdict)[`${key}.name`]).toEqual(byKey(table)[`${key}.name`]);
    // No other template fact goes with it.
    expect(verdict.facts.filter((f) => /^t\d+\.(?!name$)/.test(f.key))).toEqual([]);
  });
});
