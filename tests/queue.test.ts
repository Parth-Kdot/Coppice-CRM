import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import type { Stage } from "@/generated/prisma/enums";
import { dbNow } from "@/lib/claims";
import { daysBetween, overdueLabel } from "@/lib/dates";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { nameKey } from "@/lib/duplicates";
import { getQueue, QUEUE_SIZE, type Queue } from "@/lib/queue";
import { queueFiltersSchema, queueQuery, type QueueFilters } from "@/lib/validation";
import { resetAndSeed } from "./helpers/seed";

// Real database as app_user, so row-level security applies to every queue read.
const OWNER: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER: Tenant = { userId: "officerA", workspaceId: "a" };
const OTHER_ORG: Tenant = { userId: "ownerB", workspaceId: "b" };
const NONE: QueueFilters = { mine: false, never: false, all: null };
const DAY = 24 * 60 * 60 * 1000;

type Seed = {
  name: string;
  stage?: Stage;
  // Follow-up this many days from the database's now (negative = in the past).
  followUpDays?: number | null;
  archived?: boolean;
  holder?: string;
  // Claim ends this many days from now (negative = expired).
  claimDays?: number;
};

// Straight inserts as app_user inside the tenant. Tests may set claim fields directly; the app
// never does outside lib/claims.ts.
async function seed(tenant: Tenant, rows: Seed[]) {
  const now = (await dbNow()).getTime();
  const at = (days: number | null | undefined) => (days === null || days === undefined ? null : new Date(now + days * DAY));
  const ids = rows.map((_, i) => `${tenant.workspaceId}-q${String(i).padStart(4, "0")}`);
  await withTenant(tenant, (tx) =>
    tx.company.createMany({
      data: rows.map((r, i) => ({
        id: ids[i],
        workspaceId: tenant.workspaceId,
        name: r.name,
        nameKey: nameKey(r.name),
        stage: r.stage ?? "CONTACTED",
        nextFollowUpAt: at(r.followUpDays),
        archivedAt: r.archived ? new Date() : null,
        claimedById: r.holder ?? null,
        claimExpiresAt: r.holder ? at(r.claimDays ?? 5) : null,
        // Spread out creation times so "newest first" is well defined.
        createdAt: new Date(now - (rows.length - i) * 1000),
      })),
    }),
  );
  return ids;
}

const names = (rows: { name: string }[] | null) => rows?.map((r) => r.name) ?? null;
const load = (tenant: Tenant, filters: Partial<QueueFilters> = {}): Promise<Queue> => getQueue(tenant, { ...NONE, ...filters });

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Due", () => {
  it("lists open companies whose follow-up has arrived, most overdue first, and nothing in the future", async () => {
    await seed(OWNER, [
      { name: "A week late", followUpDays: -7 },
      { name: "Just due", followUpDays: -0.01 },
      { name: "Tomorrow", followUpDays: 1 },
      { name: "Next year", followUpDays: 300 },
      { name: "Three days late", followUpDays: -3, stage: "REPLIED" },
      { name: "No date", followUpDays: null },
    ]);
    const queue = await load(OWNER);
    expect(names(queue.due)).toEqual(["A week late", "Three days late", "Just due"]);
    expect(queue.dueCount).toBe(3);
  });

  it("never shows Committed, Declined or archived companies", async () => {
    await seed(OWNER, [
      { name: "Won", followUpDays: -2, stage: "COMMITTED" },
      { name: "Lost", followUpDays: -2, stage: "DECLINED" },
      { name: "Gone", followUpDays: -2, archived: true },
      { name: "Open", followUpDays: -2 },
    ]);
    expect(names((await load(OWNER)).due)).toEqual(["Open"]);
  });

  it("shows 50, and all of them when asked", async () => {
    await seed(OWNER, Array.from({ length: 55 }, (_, i) => ({ name: `Late ${i}`, followUpDays: -1 - i / 100 })));
    const first = await load(OWNER);
    expect(first.due).toHaveLength(QUEUE_SIZE);
    expect(first.dueCount).toBe(55);
    expect((await load(OWNER, { all: "due" })).due).toHaveLength(55);
  });

  it("'only mine' keeps just companies I hold with a live claim", async () => {
    await seed(OWNER, [
      { name: "Mine", followUpDays: -1, holder: "officerA" },
      { name: "Mine, expired", followUpDays: -1, holder: "officerA", claimDays: -1 },
      { name: "Theirs", followUpDays: -1, holder: "ownerA" },
      { name: "Free", followUpDays: -1 },
    ]);
    expect(names((await load(OFFICER)).due)).toEqual(["Free", "Mine", "Mine, expired", "Theirs"]);
    const mine = await load(OFFICER, { mine: true });
    expect(names(mine.due)).toEqual(["Mine"]);
    expect(mine.dueCount).toBe(1);
  });

  it("shows each company's latest note, skipping outreach without one", async () => {
    const [acme] = await seed(OWNER, [
      { name: "Acme", followUpDays: -2 },
      { name: "Globex", followUpDays: -1 },
    ]);
    const now = (await dbNow()).getTime();
    await withTenant(OWNER, (tx) =>
      tx.outreach.createMany({
        data: [
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: "First email", sentAt: new Date(now - 3 * DAY) },
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: "Followed up", sentAt: new Date(now - 2 * DAY) },
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: null, sentAt: new Date(now - DAY) },
        ],
      }),
    );
    const queue = await load(OWNER);
    expect(queue.due.map((r) => [r.name, r.lastNote])).toEqual([
      ["Acme", "Followed up"],
      ["Globex", null],
    ]);
  });
});

describe("Never contacted", () => {
  it("counts fresh leads always, lists them only when opened, newest first, hiding ones someone else holds", async () => {
    await seed(OWNER, [
      { name: "Old lead", stage: "NOT_CONTACTED" },
      { name: "Held by owner", stage: "NOT_CONTACTED", holder: "ownerA" },
      { name: "Owner's claim ran out", stage: "NOT_CONTACTED", holder: "ownerA", claimDays: -1 },
      { name: "Mine", stage: "NOT_CONTACTED", holder: "officerA" },
      { name: "Already contacted", stage: "CONTACTED" },
      { name: "Archived lead", stage: "NOT_CONTACTED", archived: true },
      { name: "New lead", stage: "NOT_CONTACTED" },
    ]);
    const closed = await load(OFFICER);
    expect(closed.never).toBeNull();
    expect(closed.neverCount).toBe(4);
    expect(names((await load(OFFICER, { never: true })).never)).toEqual(["New lead", "Mine", "Owner's claim ran out", "Old lead"]);
    expect(names((await load(OFFICER, { never: true, mine: true })).never)).toEqual(["Mine"]);
  });

  it("shows 50, and all of them when asked", async () => {
    await seed(OWNER, Array.from({ length: 52 }, (_, i) => ({ name: `Lead ${i}`, stage: "NOT_CONTACTED" as const })));
    expect((await load(OWNER, { never: true })).never).toHaveLength(QUEUE_SIZE);
    expect((await load(OWNER, { never: true, all: "never" })).never).toHaveLength(52);
  });

  it("an empty section stays empty even when opened", async () => {
    const queue = await load(OWNER, { never: true });
    expect(queue).toMatchObject({ never: null, neverCount: 0, due: [], dueCount: 0 });
  });
});

it("never shows another workspace's companies", async () => {
  await seed(OTHER_ORG, [
    { name: "B is due", followUpDays: -1 },
    { name: "B lead", stage: "NOT_CONTACTED" },
  ]);
  const queue = await load(OWNER, { never: true });
  expect(queue).toMatchObject({ due: [], dueCount: 0, neverCount: 0 });
});

describe("overdue labels, in West Lafayette calendar days", () => {
  test.for([
    ["2026-10-25T04:00:00Z", "2026-10-25T23:00:00Z", "Due today"],
    ["2026-10-25T04:00:00Z", "2026-10-26T04:30:00Z", "1 day overdue"],
    ["2026-10-20T04:00:00Z", "2026-10-25T16:00:00Z", "5 days overdue"],
    // Across the Nov 1 change to standard time: midnight Nov 1 EDT to just after midnight Nov 2 EST.
    ["2026-11-01T04:00:00Z", "2026-11-02T05:30:00Z", "1 day overdue"],
    // 11 pm on Oct 25 in Indiana is already Oct 26 in UTC; it's still the same local day.
    ["2026-10-25T04:00:00Z", "2026-10-26T03:00:00Z", "Due today"],
  ] as const)("due %s, now %s: %s", ([due, now, label]) => {
    expect(overdueLabel(new Date(due), new Date(now))).toBe(label);
  });

  it("counts days between two moments by local date", () => {
    expect(daysBetween(new Date("2026-12-31T05:00:00Z"), new Date("2027-01-02T05:00:00Z"))).toBe(2);
  });
});

describe("queue URL filters", () => {
  const parse = (fields: Record<string, string | null>) =>
    queueFiltersSchema.parse({ mine: null, never: null, all: null, ...fields });

  it("reads a queue URL and writes it back the same", () => {
    const filters = parse({ mine: "1", never: "1", all: "never" });
    expect(filters).toEqual({ mine: true, never: true, all: "never" });
    expect(queueQuery(filters)).toBe("?mine=1&never=1&all=never");
    expect(queueQuery(NONE)).toBe("");
  });

  it("drops anything malformed", () => {
    expect(parse({ mine: "yes", never: "0", all: "everything" })).toEqual(NONE);
  });
});
