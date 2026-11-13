import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadPlaybook, median, yearFigures } from "@/lib/capsule/playbook";
import { loadRecap, loadYearData, recap, type RecapOutreach, type YearData } from "@/lib/capsule/recap";
import { yearWindow } from "@/lib/capsule/year";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { workspaceStats } from "@/lib/stats";
import { resetAndSeed } from "./helpers/seed";
import { inYear, lastYear, OFFICER, OWNER, OTHER_OWNER } from "./helpers/capsule";

// The recap ("Your year in Coppice") and the playbook against the real database as app_user, with a
// fixture whose every number was worked out by hand. Everything is dated inside last year's board
// year, so nothing depends on today, and every send is old enough to count in the stats.
//
// Workspace "a", board year Y (July 1 Y to June 30 Y+1). Outreach, all at 17:00 UTC:
//   g-0..19  "Good", one send each on Sep 1..20. ownerA sent g-0..11, officerA g-12..19.
//            Replies marked on g-0..13 (14).
//   p-0..19  "Poor", one send each on Feb 1..20. ownerA sent p-0..4, officerA p-5..19.
//            Replies marked on p-0 and p-1 (2).
//   atlas    no template, six sends: Sep 5, Sep 20, Oct 5, Oct 20, Nov 5, Nov 20. ownerA sent the
//            1st, 3rd and 5th, officerA the others. The 3rd (Oct 5) is marked as the reply.
//   And before the year, on Sep 1 of Y-1, one send to g-1 (it counts toward touch numbers only).
// Moves (StageChange):
//   g-3    to Replied Sep 4 20:00, three hours after its send.
//   g-5    to Replied Sep 9 17:00, three days after its send.
//   atlas  to Replied Nov 21 17:00 (a day after its last send), to Committed Dec 1 by ownerA and
//          again Dec 15 by officerA.
//   g-0    to Committed Sep 30 by officerA.
//   g-1    to Committed in Aug of Y-1 (last year's board year: not counted).
// Claims: ownerA holds g-0 and g-1 (live) and p-0 (expired); officerA holds atlas (live).
//
// By hand, the team:
//   outreach 20 + 20 + 6 = 46 (the earlier year's send is not in it); companies contacted 20 + 20 + 1 = 41;
//   replies marked 14 + 2 + 1 = 17; companies Committed 2 (atlas twice counts once); the busiest
//   month is September with 20 + 2 = 22 (February has 20); the longest thread is atlas with 6; the
//   fastest reply is g-3 at 3 hours.
//   Best template: Good, 14 of 20 (70%, Wilson 48.1% to 85.5%); Poor is 2 of 20 (10%, 2.8% to 30.1%):
//   the ranges don't overlap, so Good is best and Poor worst.
// You, ownerA: outreach 12 + 5 + 3 = 20; replies on yours 12 + 2 + 1 = 15; Committed 1; holding 2.
// You, officerA: outreach 8 + 15 + 3 = 26; replies 2; Committed 2 (g-0 and atlas); holding 1.
// The playbook: the month with the most replies is September (14 of the 17); the first reply on each
// company came on its 1st touch except atlas, on its 3rd, so the usual is 1st touch, 17 companies;
// days from a company's first send to Replied: g-3 0.1, g-5 3, atlas 77 (Sep 5 to Nov 21), median 3.

let year: number;
const DAY = 24 * 60 * 60 * 1000;
const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${from + i}`);

async function seedYear() {
  await withTenant(OWNER, async (tx) => {
    const company = (id: string, extra: object = {}) => ({ id, workspaceId: "a", name: id, nameKey: id, ...extra });
    await tx.company.createMany({
      data: [
        ...range("g", 0, 19).map((id) => company(id)),
        ...range("p", 0, 19).map((id) => company(id)),
        company("atlas"),
      ],
    });
    await tx.template.createMany({
      data: [
        { id: "t-good", workspaceId: "a", name: "Good", body: "Hi" },
        { id: "t-poor", workspaceId: "a", name: "Poor", body: "Hi" },
      ],
    });
    const send = (id: string, companyId: string, senderId: string, sentAt: Date, extra: object = {}) => ({ id, workspaceId: "a", companyId, senderId, sentAt, ...extra });
    await tx.outreach.createMany({
      data: [
        ...range("g", 0, 19).map((c, i) => send(`o-${c}`, c, i < 12 ? "ownerA" : "officerA", inYear(year, 9, i + 1), { templateId: "t-good", gotReply: i < 14 })),
        ...range("p", 0, 19).map((c, i) => send(`o-${c}`, c, i < 5 ? "ownerA" : "officerA", inYear(year, 2, i + 1), { templateId: "t-poor", gotReply: i < 2 })),
        send("o-at1", "atlas", "ownerA", inYear(year, 9, 5)),
        send("o-at2", "atlas", "officerA", inYear(year, 9, 20)),
        send("o-at3", "atlas", "ownerA", inYear(year, 10, 5), { gotReply: true }),
        send("o-at4", "atlas", "officerA", inYear(year, 10, 20)),
        send("o-at5", "atlas", "ownerA", inYear(year, 11, 5)),
        send("o-at6", "atlas", "officerA", inYear(year, 11, 20)),
        send("o-early", "g-1", "ownerA", inYear(year - 1, 9, 1)),
      ],
    });
    const move = (companyId: string, changedById: string, toStage: "REPLIED" | "COMMITTED", changedAt: Date) => ({
      workspaceId: "a",
      companyId,
      changedById,
      fromStage: toStage === "REPLIED" ? ("CONTACTED" as const) : ("REPLIED" as const),
      toStage,
      changedAt,
    });
    await tx.stageChange.createMany({
      data: [
        move("g-3", "ownerA", "REPLIED", inYear(year, 9, 4, 20)),
        move("g-5", "ownerA", "REPLIED", inYear(year, 9, 9)),
        move("atlas", "ownerA", "REPLIED", inYear(year, 11, 21)),
        move("atlas", "ownerA", "COMMITTED", inYear(year, 12, 1)),
        move("atlas", "officerA", "COMMITTED", inYear(year, 12, 15)),
        move("g-0", "officerA", "COMMITTED", inYear(year, 9, 30)),
        move("g-1", "ownerA", "COMMITTED", inYear(year - 1, 8, 10)),
      ],
    });
    const future = new Date(Date.now() + 5 * DAY);
    await tx.company.updateMany({ where: { id: { in: ["g-0", "g-1"] } }, data: { claimedById: "ownerA", claimExpiresAt: future } });
    await tx.company.updateMany({ where: { id: "p-0" }, data: { claimedById: "ownerA", claimExpiresAt: new Date(Date.now() - DAY) } });
    await tx.company.updateMany({ where: { id: "atlas" }, data: { claimedById: "officerA", claimExpiresAt: future } });
  });
}

beforeEach(async () => {
  await resetAndSeed();
  year = await lastYear();
  await seedYear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the recap, worked out by hand", () => {
  it("counts the team's year", async () => {
    const r = await loadRecap(OWNER, year);
    expect(r.year).toEqual({ start: year, label: yearWindow(year).label });
    expect(r.empty).toBe(false);
    expect(r.team).toMatchObject({
      companiesContacted: 41,
      outreachLogged: 46,
      repliesMarked: 17,
      companiesCommitted: 2,
      busiestMonth: { month: 9, count: 22 },
      longestThread: { companyId: "atlas", name: "atlas", count: 6 },
    });
    expect(r.team.fastestReply).toEqual({
      companyId: "g-3",
      name: "g-3",
      ms: 3 * 60 * 60 * 1000,
      outreachAt: inYear(year, 9, 4).toISOString(),
      repliedAt: inYear(year, 9, 4, 20).toISOString(),
    });
  });

  it("names the best template, because the scorecard rates one", async () => {
    const { team } = await loadRecap(OWNER, year);
    expect(team.bestTemplate).toEqual({ id: "t-good", name: "Good", rate: 0.7, replies: 14, counted: 20 });
  });

  it("counts what you did, for each person looking, and never ranks anyone", async () => {
    expect((await loadRecap(OWNER, year)).you).toEqual({ outreachLogged: 20, repliesOnYours: 15, committed: 1, holding: 2 });
    expect((await loadRecap(OFFICER, year)).you).toEqual({ outreachLogged: 26, repliesOnYours: 2, committed: 2, holding: 1 });
    // The team figures are the same whoever asks, and the result has no list of people.
    expect((await loadRecap(OFFICER, year)).team).toEqual((await loadRecap(OWNER, year)).team);
    expect(Object.keys(await loadRecap(OWNER, year)).sort()).toEqual(["empty", "team", "year", "you"]);
  });

  it("only reads its own workspace", async () => {
    const r = await loadRecap(OTHER_OWNER, year);
    expect(r.empty).toBe(true);
    expect(r.team).toMatchObject({ companiesContacted: 0, outreachLogged: 0, longestThread: null, fastestReply: null });
  });

  it("says there is nothing to look back on in a year with no outreach", async () => {
    const r = await loadRecap(OWNER, year - 3);
    expect(r.empty).toBe(true);
    expect(r.team).toEqual({
      companiesContacted: 0,
      outreachLogged: 0,
      repliesMarked: 0,
      companiesCommitted: 0,
      busiestMonth: null,
      longestThread: null,
      fastestReply: null,
      bestTemplate: null,
    });
  });

  it("is too early to tell on the best template when the scorecard rates none", async () => {
    await withTenant(OWNER, (tx) => tx.outreach.deleteMany({ where: { templateId: "t-poor" } }));
    const r = await loadRecap(OWNER, year);
    expect(r.team.bestTemplate).toBeNull();
    // One rated template alone can't be best: the scorecard needs two.
    expect(r.team.outreachLogged).toBe(26);
  });
});

describe("the recap shows what the stats page shows, from the same functions", () => {
  it("sends, replies and the best template are equal to lib/stats.ts", async () => {
    // The fixture's one send from the year before is out of the year but in the stats' all-time
    // figures, so remove it for a like for like comparison.
    await withTenant(OWNER, (tx) => tx.outreach.deleteMany({ where: { id: "o-early" } }));
    const [stats, r] = [await workspaceStats(OWNER), await loadRecap(OWNER, year)];
    const sent = stats.templates.reduce((sum, t) => sum + t.stat.sent, 0) + stats.noTemplate.stat.sent;
    expect(r.team.outreachLogged).toBe(sent);
    const good = stats.templates.find((t) => t.key === stats.activeVerdict.best);
    expect(good).toBeDefined();
    expect(r.team.bestTemplate).toEqual({ id: good!.key, name: good!.name, rate: good!.stat.rate, replies: good!.stat.replies, counted: good!.stat.counted });
    // Marked replies: the stats count only mature sends, and every send here is mature.
    const replies = stats.templates.reduce((sum, t) => sum + t.stat.replies, 0) + stats.noTemplate.stat.replies;
    expect(r.team.repliesMarked).toBe(replies);
  });

  it("names no template when the stats name none", async () => {
    await withTenant(OWNER, (tx) => tx.outreach.updateMany({ where: { templateId: "t-poor" }, data: { gotReply: true } }));
    const [stats, r] = [await workspaceStats(OWNER), await loadRecap(OWNER, year)];
    expect(stats.activeVerdict.best).toBeNull();
    expect(r.team.bestTemplate).toBeNull();
  });
});

describe("the playbook, worked out by hand", () => {
  it("equals the stats page for templates, touches and authorship", async () => {
    const [stats, book] = [await workspaceStats(OWNER), await loadPlaybook(OWNER, year)];
    expect(book.best).toEqual(stats.templates.find((t) => t.key === stats.activeVerdict.best));
    expect(book.worst).toEqual(stats.templates.find((t) => t.key === stats.activeVerdict.worst));
    expect(book.best?.name).toBe("Good");
    expect(book.worst?.name).toBe("Poor");
    expect(book.rated).toBe(stats.activeVerdict.rated);
    expect(book.rated).toBe(2);
    expect(book.byTouch).toEqual(stats.byTouch);
    expect(book.authorship).toEqual(stats.authorship);
    expect(book.retiredBetter).toEqual(stats.activeVerdict.retiredBetter);
  });

  it("finds the month with the most replies, the usual touches and the usual days to a reply", async () => {
    const book = await loadPlaybook(OWNER, year);
    expect(book.monthWithMostReplies).toEqual({ month: 9, count: 14 });
    expect(book.touchesBeforeReply).toEqual({ median: 1, n: 17 });
    expect(book.daysToReply?.n).toBe(3);
    expect(book.daysToReply?.median).toBe(3);
  });

  it("says too early to tell (no best or worst) with no rated template", async () => {
    await withTenant(OWNER, (tx) => tx.outreach.deleteMany({ where: { templateId: "t-poor" } }));
    const book = await loadPlaybook(OWNER, year);
    expect(book.best).toBeNull();
    expect(book.worst).toBeNull();
    expect(book.rated).toBe(1);
  });

  it("is empty-safe in a year with nothing in it", async () => {
    const book = await loadPlaybook(OWNER, year - 3);
    expect(book.monthWithMostReplies).toBeNull();
    expect(book.touchesBeforeReply).toBeNull();
    expect(book.daysToReply).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The pure functions, on rows made by hand.

const at = (iso: string) => new Date(iso);
const WINDOW = yearWindow(2025);
const row = (id: string, companyId: string, sentAt: string, extra: Partial<RecapOutreach> = {}): RecapOutreach => ({
  id,
  companyId,
  senderId: "me",
  templateId: null,
  channel: "EMAIL",
  sentAt: at(sentAt),
  gotReply: false,
  aiDrafted: false,
  ...extra,
});
const data = (outreach: RecapOutreach[], extra: Partial<YearData> = {}): YearData => ({
  now: at("2026-11-01T12:00:00Z"),
  window: WINDOW,
  outreach,
  changes: [],
  companies: new Map([
    ["c1", "Atlas"],
    ["c2", "Birch"],
  ]),
  templates: [],
  held: 0,
  ...extra,
});

describe("recap(): the rules, on rows made by hand", () => {
  it("breaks a tie for the busiest month toward the earlier month of the board year (July first)", () => {
    // January and November each have two sends: November comes first in a board year.
    const r = recap(
      data([row("1", "c1", "2026-01-10T17:00:00Z"), row("2", "c1", "2026-01-11T17:00:00Z"), row("3", "c2", "2025-11-10T17:00:00Z"), row("4", "c2", "2025-11-11T17:00:00Z")]),
      "me",
    );
    expect(r.team.busiestMonth).toEqual({ month: 11, count: 2 });
    // July is the first month of the year, so it beats June of the next calendar year on a tie.
    const julyJune = recap(data([row("1", "c1", "2025-07-02T17:00:00Z"), row("2", "c2", "2026-06-02T17:00:00Z")]), "me");
    expect(julyJune.team.busiestMonth).toEqual({ month: 7, count: 1 });
  });

  it("counts a send only inside the board year: July 1 in, June 30 in, the day before and after out", () => {
    const r = recap(
      data([
        row("before", "c1", "2025-06-30T12:00:00Z"),
        row("first", "c1", "2025-07-01T12:00:00Z"),
        row("last", "c1", "2026-06-30T12:00:00Z"),
        row("after", "c1", "2026-07-01T12:00:00Z"),
      ]),
      "me",
    );
    expect(r.team.outreachLogged).toBe(2);
    expect(r.team.longestThread).toEqual({ companyId: "c1", name: "Atlas", count: 2 });
  });

  it("breaks a tie for the longest thread on the company's name", () => {
    const r = recap(data([row("1", "c1", "2025-09-01T17:00:00Z"), row("2", "c2", "2025-09-02T17:00:00Z")]), "me");
    expect(r.team.longestThread).toMatchObject({ name: "Atlas", count: 1 });
  });

  it("measures the fastest reply from the latest send at or before the move to Replied, and skips a move with no send before it", () => {
    const r = recap(
      data(
        [row("1", "c1", "2025-09-01T10:00:00Z"), row("2", "c1", "2025-09-05T10:00:00Z"), row("3", "c2", "2025-10-01T10:00:00Z")],
        {
          changes: [
            { companyId: "c1", changedById: "me", toStage: "REPLIED", changedAt: at("2025-09-05T14:00:00Z") },
            { companyId: "c2", changedById: "me", toStage: "REPLIED", changedAt: at("2025-09-30T10:00:00Z") },
          ],
        },
      ),
      "me",
    );
    // c1: four hours after its second send. c2's move came before any send to it, so it is skipped.
    expect(r.team.fastestReply).toMatchObject({ companyId: "c1", ms: 4 * 3_600_000 });
  });

  it("has no fastest reply, and no best template, when there is nothing to base them on", () => {
    const r = recap(data([row("1", "c1", "2025-09-01T17:00:00Z")]), "me");
    expect(r.team.fastestReply).toBeNull();
    expect(r.team.bestTemplate).toBeNull();
    expect(r.empty).toBe(false);
  });

  it("calls a year with no sends empty", () => {
    expect(recap(data([row("1", "c1", "2024-09-01T17:00:00Z")]), "me").empty).toBe(true);
  });
});

describe("yearFigures(): the playbook's rules, on rows made by hand", () => {
  it("takes the middle of an even count, and counts touches across earlier years", () => {
    const outreach = [
      // c1: a send in 2024 and the reply on its second, in this year.
      row("a0", "c1", "2024-09-01T17:00:00Z"),
      row("a1", "c1", "2025-09-01T17:00:00Z", { gotReply: true }),
      // c2: replies on its first.
      row("b1", "c2", "2025-10-01T17:00:00Z", { gotReply: true }),
    ];
    const f = yearFigures(data(outreach));
    expect(f.touchesBeforeReply).toEqual({ median: 1.5, n: 2 });
    expect(f.monthWithMostReplies).toEqual({ month: 9, count: 1 });
  });

  it("measures days from a company's first send, in any year, to its first move to Replied this year", () => {
    const f = yearFigures(
      data([row("a0", "c1", "2025-08-01T12:00:00Z"), row("b0", "c2", "2025-08-10T12:00:00Z")], {
        changes: [
          { companyId: "c1", changedById: "me", toStage: "REPLIED", changedAt: at("2025-08-11T12:00:00Z") },
          { companyId: "c1", changedById: "me", toStage: "REPLIED", changedAt: at("2025-12-11T12:00:00Z") },
          { companyId: "c2", changedById: "me", toStage: "REPLIED", changedAt: at("2025-08-14T12:00:00Z") },
        ],
      }),
    );
    // c1: 10 days (its later move doesn't count), c2: 4 days.
    expect(f.daysToReply).toEqual({ median: 7, n: 2 });
  });

  it("has nothing to say without replies", () => {
    expect(yearFigures(data([row("a", "c1", "2025-09-01T17:00:00Z")]))).toEqual({ monthWithMostReplies: null, touchesBeforeReply: null, daysToReply: null });
  });
});

describe("loadYearData", () => {
  it("reads in a few flat queries and holds only moves into Replied or Committed in the year", async () => {
    const d = await loadYearData(OWNER, year);
    expect(d.changes).toHaveLength(6);
    expect(d.outreach).toHaveLength(47);
    expect(d.templates.map((t) => t.name).sort()).toEqual(["Good", "Poor"]);
    expect(d.now.getTime()).toBeLessThanOrEqual((await dbNow()).getTime());
  });
});

describe("median", () => {
  it.each([
    [[], null],
    [[4], 4],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ])("%j is %s", (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});
