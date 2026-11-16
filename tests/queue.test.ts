import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import type { Stage } from "@/generated/prisma/enums";
import { overdueText } from "@/components/ledger/overdue";
import { dbNow } from "@/lib/claims";
import { DAY_MS, daysBetween } from "@/lib/dates";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { nameKey } from "@/lib/duplicates";
import { loadFreshLeads } from "@/app/(app)/[workspaceId]/queue-actions";
import { clampUpto, FRESH_CAP, FRESH_PAGE, getFreshLeads, getQueue, getQueueHome, NOTE_CHARS, QUEUE_CAP, QUEUE_SIZE, type Queue } from "@/lib/queue";
import { queueFiltersSchema, queueQuery, type QueueFilters } from "@/lib/validation";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

// loadFreshLeads is a real server action; only Next.js's request APIs are swapped.
vi.mock("next/headers", () => import("./helpers/next-request"));

// Real database as app_user, so row-level security applies to every queue read.
const OWNER: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER: Tenant = { userId: "officerA", workspaceId: "a" };
const OTHER_ORG: Tenant = { userId: "ownerB", workspaceId: "b" };
const NONE: QueueFilters = { mine: false, never: false, all: null };

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
  const at = (days: number | null | undefined) => (days === null || days === undefined ? null : new Date(now + days * DAY_MS));
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
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: "First email", sentAt: new Date(now - 3 * DAY_MS) },
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: "Followed up", sentAt: new Date(now - 2 * DAY_MS) },
          { workspaceId: "a", companyId: acme, senderId: "ownerA", note: null, sentAt: new Date(now - DAY_MS) },
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
    expect(overdueText(daysBetween(new Date(due), new Date(now)))).toBe(label);
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

// ----- The home screen's groups -----

// Counts every query a withTenant transaction runs (the set_config line included), so the queue's
// round trips can be pinned. Calls straight through to the real database.
function countQueries() {
  let count = 0;
  const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
  const counted = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, key) {
        const value = Reflect.get(obj, key);
        if (typeof value === "function")
          return (...args: unknown[]) => {
            count++;
            return value.apply(obj, args);
          };
        if (value && typeof value === "object" && typeof key === "string" && !key.startsWith("_")) return counted(value);
        return value;
      },
    });
  const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((run: (tx: object) => Promise<unknown>, options: unknown) =>
    original((tx: object) => run(counted(tx)), options)) as never);
  return { count: () => count, restore: () => spy.mockRestore() };
}

const home = async (tenant: Tenant, upto?: number) => getQueueHome(tenant, { upto, now: await dbNow() });

describe("home groups: yours, up for grabs, held by others, fresh leads", () => {
  it("splits due companies by who holds them; an expired claim (anyone's) is up for grabs", async () => {
    await seed(OWNER, [
      { name: "Mine", followUpDays: -2, holder: "officerA" },
      { name: "Mine, expired", followUpDays: -2, holder: "officerA", claimDays: -1 },
      { name: "Owner's", followUpDays: -2, holder: "ownerA" },
      { name: "Owner's, expired", followUpDays: -2, holder: "ownerA", claimDays: -1 },
      { name: "Free", followUpDays: -1 },
      { name: "Not due, mine", followUpDays: 3, holder: "officerA" },
      { name: "Fresh, mine", stage: "NOT_CONTACTED", holder: "officerA" },
      { name: "Fresh, owner's", stage: "NOT_CONTACTED", holder: "ownerA" },
      { name: "Fresh", stage: "NOT_CONTACTED" },
      { name: "Won", followUpDays: -2, stage: "COMMITTED", holder: "officerA" },
      { name: "Gone", followUpDays: -2, archived: true },
    ]);
    const officer = await home(OFFICER);
    expect(names(officer.yours.rows)).toEqual(["Mine"]);
    expect(names(officer.grabs.rows)).toEqual(["Mine, expired", "Owner's, expired", "Free"]);
    expect(names(officer.heldByOthers.rows)).toEqual(["Owner's"]);
    expect([officer.yours.count, officer.grabs.count, officer.heldByOthers.count]).toEqual([1, 3, 1]);
    // Fresh leads count yours and free ones, never someone else's.
    expect(officer.freshCount).toBe(2);
    // Held, open, and not due (no date counts): "Not due, mine" and "Fresh, mine".
    expect(officer.yoursNotDue).toBe(2);

    // The same data from the owner's side: the groups follow the viewer, the total does not.
    const owner = await home(OWNER);
    expect(names(owner.yours.rows)).toEqual(["Owner's"]);
    expect(names(owner.heldByOthers.rows)).toEqual(["Mine"]);
    expect(owner.yours.count + owner.grabs.count + owner.heldByOthers.count).toBe(5);
    expect(owner.freshCount).toBe(2);
  });

  it("with no claims at all, everything due is up for grabs and the other groups are empty", async () => {
    await seed(OWNER, [
      { name: "Late", followUpDays: -3 },
      { name: "Today", followUpDays: -0.01 },
    ]);
    const queue = await home(OFFICER);
    expect(queue).toMatchObject({ yours: { rows: [], count: 0 }, heldByOthers: { rows: [], count: 0 }, freshCount: 0, yoursNotDue: 0 });
    expect(names(queue.grabs.rows)).toEqual(["Late", "Today"]);
  });

  it("loads 50 per group by default and pages by 50 up to 200, never more", async () => {
    await seed(OWNER, Array.from({ length: 230 }, (_, i) => ({ name: `Late ${String(i).padStart(3, "0")}`, followUpDays: -1 - i / 1000 })));
    const first = await home(OWNER);
    expect(first.grabs.rows).toHaveLength(50);
    expect(first.grabs.count).toBe(230);
    expect((await home(OWNER, 100)).grabs.rows).toHaveLength(100);
    expect((await home(OWNER, 200)).grabs.rows).toHaveLength(QUEUE_CAP);
    expect((await home(OWNER, 5000)).grabs.rows).toHaveLength(QUEUE_CAP);
    expect([clampUpto(undefined), clampUpto(null), clampUpto(0), clampUpto(75), clampUpto(150), clampUpto(9999)]).toEqual([50, 50, 50, 100, 150, 200]);
  });

  test.each([
    ["100", 100],
    ["200", 200],
    ["50", 50],
    ["75", undefined],
    ["250", undefined],
    ["0", undefined],
    ["1e2", undefined],
    ["abc", undefined],
    [null, undefined],
  ])("?upto=%s reads as %s", (upto, expected) => {
    expect(queueFiltersSchema.parse({ mine: null, never: null, all: null, upto }).upto).toBe(expected);
  });

  it("writes upto back into the address", () => {
    expect(queueQuery({ ...NONE, upto: 150 })).toBe("?upto=150");
  });

  it("reads each row's latest note through one row per company, trimmed for the one-line view", async () => {
    const [acme] = await seed(OWNER, [{ name: "Acme", followUpDays: -2 }]);
    const now = (await dbNow()).getTime();
    await withTenant(OWNER, (tx) =>
      tx.outreach.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          workspaceId: "a",
          companyId: acme,
          senderId: "ownerA",
          note: i === 59 ? "Newest ".repeat(100) : `Older note ${i}`,
          sentAt: new Date(now - (60 - i) * DAY_MS),
        })),
      }),
    );
    const [row] = (await home(OWNER)).grabs.rows;
    expect(row.lastNote?.startsWith("Newest Newest")).toBe(true);
    expect(row.lastNote?.length).toBeLessThanOrEqual(NOTE_CHARS);
    expect(row.lastNote?.endsWith("…")).toBe(true);
  });

  it("runs a fixed number of queries, one at a time: 6 for a small queue", async () => {
    await seed(OWNER, [
      { name: "Mine", followUpDays: -1, holder: "ownerA" },
      { name: "Free", followUpDays: -1 },
      { name: "Theirs", followUpDays: -1, holder: "officerA" },
    ]);
    const now = await dbNow();
    const small = countQueries();
    try {
      await getQueueHome(OWNER, { now });
      // set_config, then rows for yours, grabs and held by others, the fresh count, the not-due count.
      expect(small.count()).toBe(6);
    } finally {
      small.restore();
    }
  });

  it("asks for a group's count only when its page came back full: 9 queries at most", async () => {
    await seed(OWNER, Array.from({ length: 180 }, (_, i) => ({ name: `Bulk ${i}`, followUpDays: -2, holder: i % 3 === 0 ? "ownerA" : i % 3 === 1 ? "officerA" : undefined })));
    const now = await dbNow();
    const full = countQueries();
    try {
      const queue = await getQueueHome(OWNER, { now });
      // Each full page also asks for its count.
      expect(full.count()).toBe(9);
      expect([queue.yours.count, queue.grabs.count, queue.heldByOthers.count]).toEqual([60, 60, 60]);
    } finally {
      full.restore();
    }
  });
});

describe("fresh leads, loaded when the list is opened", () => {
  it("pages newest first, 20 at a time, never past 100, without leads someone else holds", async () => {
    await seed(OWNER, [
      ...Array.from({ length: 130 }, (_, i) => ({ name: `Lead ${String(i).padStart(3, "0")}`, stage: "NOT_CONTACTED" as const })),
      { name: "Held by owner", stage: "NOT_CONTACTED" as const, holder: "ownerA" },
    ]);
    const first = await getFreshLeads(OFFICER, 0);
    expect(first.rows).toHaveLength(FRESH_PAGE);
    expect(first.more).toBe(true);
    expect(first.rows[0].name).toBe("Lead 129");
    expect(names(first.rows)).not.toContain("Held by owner");
    const last = await getFreshLeads(OFFICER, FRESH_CAP - FRESH_PAGE);
    expect(last.rows).toHaveLength(FRESH_PAGE);
    expect(last.more).toBe(false);
    // An offset past the cap is held at the last page.
    expect(names((await getFreshLeads(OFFICER, 500)).rows)).toEqual(names(last.rows));
  });

  it("the action checks membership first and validates its input", async () => {
    await seed(OWNER, [{ name: "Lead", stage: "NOT_CONTACTED" }]);
    const ok = await asUser("officerA", () => loadFreshLeads("a", 0));
    expect(ok).toMatchObject({ ok: true, data: { more: false, rows: [{ name: "Lead", industry: null, claim: { state: "free" } }] } });
    expect(await asUser("ownerB", () => loadFreshLeads("a", 0))).toEqual({ ok: false, error: "Workspace not found." });
    expect(await asUser("officerA", () => loadFreshLeads("a", 81))).toMatchObject({ ok: false });
    expect(await asUser("officerA", () => loadFreshLeads("a", -1))).toMatchObject({ ok: false });
    expect(await asUser("officerA", () => loadFreshLeads("a", 1.5))).toMatchObject({ ok: false });
  });
});
