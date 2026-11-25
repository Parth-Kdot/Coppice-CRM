import type { Membership } from "@/lib/authz";
import { dbNow, dbToday } from "@/lib/claims";
import { localMidnight } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import type { ScorecardReply } from "@/lib/validation";
import type { WeeklyCounts } from "@/lib/weekly-brief/facts";
import { WEEKLY_PROMPT_EXAMPLES } from "@/lib/weekly-brief/prompt";
import { weekRanges, weekStartOf } from "@/lib/weekly-brief/week";

// The Monday brief's fixture, shared by its own tests and by the eval suite f6:weekly-brief. Every
// row is dated from the database clock relative to this week's Monday, so the counts below hold on
// any day of the week. Seed it after resetAndSeed() (workspaces "a" and "b").
//
// Workspace "a". Companies:
//   w-o1..w-o6  old (created 30 days before last week).
//   w-c1..w-c4  added last week; w-arch added last week and archived.
// Outreach last week: w-o1 by ownerA at exactly last Monday 00:00 (counts), w-o1 by officerA, w-o2 by
//   ownerA, w-o3 by officerA, w-c1 by officerA: 5 entries, 4 companies, 2 members. w-o2 by ownerA at
//   exactly this Monday 00:00 does NOT count. The week before last: 2 entries.
// Stage moves last week: w-o1 Contacted to Replied, then Replied to Committed (one answer, one
//   commit); w-o2 Contacted to Declined (an answer and a decline); w-o3 Not contacted to Declined
//   (a decline only); w-o4 In conversation to Declined (a decline, not a new answer); w-o5 Not
//   contacted to Contacted (nothing). Answers 2, committed 1, declined 3.
// Now: w-o5 overdue (follow-up yesterday); w-o1 is Committed with a past follow-up (never
//   overdue); w-o6 due this week (later today); w-c2 due after Sunday. Claims: w-c1 held by officerA
//   until a minute before next Monday (ends this week), w-c2 held by ownerA into next week, w-c3's
//   claim by officerA ran out yesterday. Fresh leads: w-c3, w-c4. Open: w-o5, w-o6, w-c1..w-c4.
// Workspace "b" has outreach, a move and a new company last week, which never count for "a".

export const WEEKLY_OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
export const WEEKLY_OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
export const WEEKLY_OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What readWeeklyCounts gives for workspace "a" after seedWeeklyFixture (weekStart filled in by the test).
export const WEEKLY_FIXTURE_COUNTS: Omit<WeeklyCounts, "weekStart"> = {
  last: { outreach: 5, companies: 4, members: 2, answers: 2, committed: 1, declined: 3, added: 4 },
  prev: { outreach: 2 },
  now: { overdue: 1, dueThisWeek: 1, claimsEnding: 1, liveClaims: 2, freshLeads: 2, open: 6 },
};

export async function seedWeeklyFixture(): Promise<{ weekStart: string; now: Date }> {
  const now = await dbNow();
  const today = await dbToday();
  const weekStart = weekStartOf(today);
  const { prevStart, lastStart, thisStart, nextStart } = weekRanges(weekStart);
  const todayStart = localMidnight(today);
  const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
  const old = at(lastStart, -30 * DAY);
  // Later today, but never past now's own day end or into next week.
  const laterToday = new Date(Math.min(todayStart.getTime() + 23 * HOUR, nextStart.getTime() - HOUR));

  await withTenant(WEEKLY_OWNER, async (tx) => {
    const company = (id: string, extra: object = {}) => ({ id, workspaceId: "a", name: id, nameKey: id, createdAt: old, ...extra });
    await tx.company.createMany({
      data: [
        company("w-o1", { stage: "COMMITTED", nextFollowUpAt: at(todayStart, -3 * DAY) }),
        company("w-o2", { stage: "DECLINED" }),
        company("w-o3", { stage: "DECLINED" }),
        company("w-o4", { stage: "DECLINED" }),
        company("w-o5", { stage: "CONTACTED", nextFollowUpAt: at(todayStart, -DAY) }),
        company("w-o6", { stage: "CONTACTED", nextFollowUpAt: laterToday }),
        company("w-c1", { createdAt: at(lastStart, HOUR), claimedById: "officerA", claimExpiresAt: at(nextStart, -60_000) }),
        company("w-c2", { createdAt: at(lastStart, 2 * HOUR), nextFollowUpAt: at(nextStart, DAY), claimedById: "ownerA", claimExpiresAt: at(nextStart, 3 * DAY) }),
        company("w-c3", { createdAt: at(lastStart, 3 * HOUR), claimedById: "officerA", claimExpiresAt: at(now, -DAY) }),
        company("w-c4", { createdAt: at(lastStart, 4 * HOUR) }),
        company("w-arch", { createdAt: at(lastStart, 5 * HOUR), archivedAt: at(lastStart, 6 * HOUR) }),
      ],
    });
    const sent = (id: string, companyId: string, senderId: string, sentAt: Date) => ({ id, workspaceId: "a", companyId, senderId, sentAt });
    await tx.outreach.createMany({
      data: [
        sent("w-s1", "w-o1", "ownerA", lastStart),
        sent("w-s2", "w-o1", "officerA", at(lastStart, DAY)),
        sent("w-s3", "w-o2", "ownerA", at(lastStart, 2 * DAY)),
        sent("w-s4", "w-o3", "officerA", at(lastStart, 3 * DAY)),
        sent("w-s5", "w-c1", "officerA", at(lastStart, 4 * DAY)),
        sent("w-s6", "w-o2", "ownerA", thisStart),
        sent("w-p1", "w-o5", "ownerA", at(prevStart, DAY)),
        sent("w-p2", "w-o6", "officerA", at(prevStart, 2 * DAY)),
      ],
    });
    const moved = (id: string, companyId: string, fromStage: string, toStage: string, changedAt: Date) => ({
      id,
      workspaceId: "a",
      companyId,
      changedById: "ownerA",
      fromStage: fromStage as "CONTACTED",
      toStage: toStage as "CONTACTED",
      changedAt,
    });
    await tx.stageChange.createMany({
      data: [
        moved("w-m1", "w-o1", "CONTACTED", "REPLIED", at(lastStart, DAY)),
        moved("w-m2", "w-o1", "REPLIED", "COMMITTED", at(lastStart, 2 * DAY)),
        moved("w-m3", "w-o2", "CONTACTED", "DECLINED", at(lastStart, 2 * DAY)),
        moved("w-m4", "w-o3", "NOT_CONTACTED", "DECLINED", at(lastStart, 3 * DAY)),
        moved("w-m5", "w-o4", "IN_CONVERSATION", "DECLINED", at(lastStart, 3 * DAY)),
        moved("w-m6", "w-o5", "NOT_CONTACTED", "CONTACTED", at(lastStart, 4 * DAY)),
      ],
    });
  });

  await withTenant(WEEKLY_OTHER_ORG, async (tx) => {
    await tx.company.create({ data: { id: "wb-1", workspaceId: "b", name: "wb-1", nameKey: "wb-1", stage: "REPLIED", createdAt: at(lastStart, HOUR) } });
    await tx.outreach.create({ data: { id: "wb-s1", workspaceId: "b", companyId: "wb-1", senderId: "ownerB", sentAt: at(lastStart, DAY) } });
    await tx.stageChange.create({
      data: { id: "wb-m1", workspaceId: "b", companyId: "wb-1", changedById: "ownerB", fromStage: "CONTACTED", toStage: "REPLIED", changedAt: at(lastStart, DAY) },
    });
  });

  return { weekStart, now };
}

// Turns AI on for workspace "a" (it is off by default).
export const aiOn = (workspaceId = "a") => prisma.workspace.update({ where: { id: workspaceId }, data: { aiEnabled: true } });

// A reply built from the prompt's own example sentences: it passes every check. A sentence that
// follows another starts with a space inside its first words.
type Example = (typeof WEEKLY_PROMPT_EXAMPLES)[keyof typeof WEEKLY_PROMPT_EXAMPLES];
const after = (example: Example) => example.map((s, i) => (i === 0 && s.text !== null ? { text: ` ${s.text}`, fact: null } : s));
export const WEEKLY_GOOD_REPLY: ScorecardReply = {
  paragraphs: [
    { segments: [...WEEKLY_PROMPT_EXAMPLES.lastWeek, ...after(WEEKLY_PROMPT_EXAMPLES.answers)] },
    { segments: [...WEEKLY_PROMPT_EXAMPLES.coming, ...after(WEEKLY_PROMPT_EXAMPLES.claims)] },
  ],
};
// A digit in the model's own words: the whole reply is refused.
export const WEEKLY_DIGIT_REPLY: ScorecardReply = {
  paragraphs: [{ segments: [{ text: "Last week the team logged 5 entries: ", fact: null }, { text: null, fact: "last.outreach" }, { text: null, fact: "last.answers" }, { text: ".", fact: null }] }],
};
// A fact key the table does not hold: refused.
export const WEEKLY_UNKNOWN_KEY_REPLY: ScorecardReply = {
  paragraphs: [{ segments: [{ text: "Last week: ", fact: null }, { text: null, fact: "last.outreach" }, { text: " and ", fact: null }, { text: null, fact: "last.revenue" }, { text: ".", fact: null }] }],
};
// An email address: refused.
export const WEEKLY_CONTACT_REPLY: ScorecardReply = {
  paragraphs: [{ segments: [{ text: "Write to dana@example.com about ", fact: null }, { text: null, fact: "last.outreach" }, { text: " and ", fact: null }, { text: null, fact: "last.answers" }, { text: ".", fact: null }] }],
};
// The good reply plus a ranking sentence, which is left out on its own.
export const WEEKLY_RANKING_REPLY: ScorecardReply = {
  paragraphs: [
    ...WEEKLY_GOOD_REPLY.paragraphs,
    { segments: [{ text: "That is more than ever, so ", fact: null }, { text: null, fact: "now.open" }, { text: " companies look better.", fact: null }] },
  ],
};
