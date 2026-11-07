import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { moveStage, unarchiveCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import type { Stage } from "@/generated/prisma/enums";
import {
  ARCHIVED_PAGE,
  COLUMN_CAP,
  COLUMN_SIZE,
  getBoard,
  NO_PAGING,
  parseBoardPaging,
  pagingParams,
  SHOW_ALL_LIMIT,
  withPaging,
  type Board,
  type BoardPaging,
} from "@/lib/board";
import { countPossibleDuplicates, listPossibleDuplicatePairs, markSeparate } from "@/lib/companies";
import { day, when } from "@/lib/dates";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { nameKey } from "@/lib/duplicates";
import { STAGES } from "@/lib/stages";
import { boardFiltersSchema, boardQuery, type BoardFilters } from "@/lib/validation";
import { form } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Real database as app_user, so row-level security applies to every board read.
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };
const NONE: BoardFilters = { q: "", industry: "", show: [], all: null, archived: false, dupes: false };

type Seed = { name: string; stage?: Stage; industry?: string; followUp?: string | null; archived?: boolean };

// Straight inserts (as app_user, inside the tenant), so hundreds of rows take one statement.
async function seed(tenant: Tenant, rows: Seed[]) {
  const ids = rows.map((_, i) => `${tenant.workspaceId}-${String(i).padStart(5, "0")}`);
  await withTenant(tenant, (tx) =>
    tx.company.createMany({
      data: rows.map((r, i) => ({
        id: ids[i],
        workspaceId: tenant.workspaceId,
        name: r.name,
        nameKey: nameKey(r.name),
        stage: r.stage ?? "NOT_CONTACTED",
        industry: r.industry ?? null,
        nextFollowUpAt: r.followUp ? new Date(r.followUp) : null,
        archivedAt: r.archived ? new Date() : null,
      })),
    }),
  );
  return ids;
}

const column = (board: Board, stage: Stage) => board.columns.find((c) => c.stage === stage)!;
const names = (board: Board, stage: Stage) => column(board, stage).cards.map((c) => c.name);
const counts = (board: Board) => Object.fromEntries(board.columns.map((c) => [c.stage, c.count]));

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getBoard", () => {
  it("counts every stage, and shows an empty board for a new workspace", async () => {
    expect(counts(await getBoard(A, NONE))).toEqual(Object.fromEntries(STAGES.map((s) => [s, 0])));
    await seed(A, [
      { name: "One" },
      { name: "Two", stage: "CONTACTED" },
      { name: "Three", stage: "CONTACTED" },
      { name: "Four", stage: "COMMITTED" },
      { name: "Gone", archived: true },
    ]);
    const board = await getBoard(A, NONE);
    expect(counts(board)).toMatchObject({ NOT_CONTACTED: 1, CONTACTED: 2, COMMITTED: 1, DECLINED: 0 });
    expect(board.archivedCount).toBe(1);
    expect(board.archived).toBeNull();
  });

  it("sorts by follow-up date, companies without one last, then by name", async () => {
    await seed(A, [
      { name: "No date B" },
      { name: "Later", followUp: "2026-11-20T12:00:00Z" },
      { name: "No date A" },
      { name: "Sooner", followUp: "2026-11-01T12:00:00Z" },
      { name: "Also sooner", followUp: "2026-11-01T12:00:00Z" },
    ]);
    expect(names(await getBoard(A, NONE), "NOT_CONTACTED")).toEqual(["Also sooner", "Sooner", "Later", "No date A", "No date B"]);
  });

  it("shows 50 cards per column with a 'show all', and all of them when asked", async () => {
    await seed(A, Array.from({ length: 60 }, (_, i) => ({ name: `Company ${String(i).padStart(2, "0")}` })));
    const first = column(await getBoard(A, NONE), "NOT_CONTACTED");
    expect(first).toMatchObject({ count: 60, open: true, hasMore: true });
    expect(first.cards).toHaveLength(COLUMN_SIZE);
    const all = column(await getBoard(A, { ...NONE, all: "NOT_CONTACTED" }), "NOT_CONTACTED");
    expect(all).toMatchObject({ count: 60, hasMore: false });
    expect(all.cards).toHaveLength(60);
  });

  it("keeps Committed and Declined collapsed (counted, no cards) until opened", async () => {
    await seed(A, [{ name: "Won", stage: "COMMITTED" }, { name: "Lost", stage: "DECLINED" }]);
    const closed = await getBoard(A, NONE);
    expect(column(closed, "COMMITTED")).toMatchObject({ count: 1, open: false, cards: [] });
    const opened = await getBoard(A, { ...NONE, show: ["COMMITTED"] });
    expect(names(opened, "COMMITTED")).toEqual(["Won"]);
    expect(column(opened, "DECLINED")).toMatchObject({ open: false, cards: [] });
  });

  it("searches names ignoring case, and filters by industry", async () => {
    await seed(A, [
      { name: "Acme Corp", industry: "Tech" },
      { name: "ACME Labs", industry: "Biotech" },
      { name: "Globex", industry: "Tech" },
      { name: "Old Acme", industry: "Tech", archived: true },
    ]);
    const search = await getBoard(A, { ...NONE, q: "acme" });
    // Names sort the way people expect, ignoring case (en_US collation, here and on Supabase).
    expect(names(search, "NOT_CONTACTED")).toEqual(["Acme Corp", "ACME Labs"]);
    expect(search.archivedCount).toBe(1);
    expect(names(await getBoard(A, { ...NONE, industry: "Tech" }), "NOT_CONTACTED")).toEqual(["Acme Corp", "Globex"]);
    expect(names(await getBoard(A, { ...NONE, q: "acme", industry: "Tech" }), "NOT_CONTACTED")).toEqual(["Acme Corp"]);
  });

  test.for([
    ["100%", ["100% Corp"]],
    ["a_b", ["A_B Inc"]],
    ["\\", ["Back\\slash"]],
  ] as const)("treats %j in a search as plain text, not a wildcard", async ([q, expected]) => {
    await seed(A, [{ name: "100% Corp" }, { name: "100X Corp" }, { name: "A_B Inc" }, { name: "AxB Inc" }, { name: "Back\\slash" }]);
    expect(names(await getBoard(A, { ...NONE, q }), "NOT_CONTACTED")).toEqual(expected);
  });

  it("lists archived companies, newest first, only when that section is open", async () => {
    await seed(A, [{ name: "Active" }, { name: "Old one", archived: true }]);
    const board = await getBoard(A, { ...NONE, archived: true });
    expect(board.archived).toEqual([{ id: expect.any(String), name: "Old one", industry: null }]);
    expect(names(board, "NOT_CONTACTED")).toEqual(["Active"]);
  });

  it("never shows another workspace's companies", async () => {
    await seed(B, [{ name: "B's company" }, { name: "B's old one", archived: true }]);
    const board = await getBoard(A, { ...NONE, archived: true });
    expect(counts(board).NOT_CONTACTED).toBe(0);
    expect(board.archivedCount).toBe(0);
    expect(board.archived).toBeNull();
  });

  it("loads a 2,000-company workspace quickly, with the right numbers", async () => {
    const rows: Seed[] = Array.from({ length: SHOW_ALL_LIMIT }, (_, i) => ({
      name: `Company ${i}`,
      stage: STAGES[i % STAGES.length],
      industry: ["Tech", "Finance", "Energy", "Biotech"][i % 4],
      followUp: i % 3 === 0 ? null : new Date(Date.UTC(2026, 10, 1 + (i % 28))).toISOString(),
      archived: i % 50 === 0,
    }));
    await seed(A, rows);
    await getBoard(A, NONE); // warm up the connection

    const started = performance.now();
    const board = await getBoard(A, { ...NONE, show: ["COMMITTED", "DECLINED"] });
    const elapsed = performance.now() - started;

    const total = board.columns.reduce((sum, c) => sum + c.count, 0);
    expect(total + board.archivedCount).toBe(SHOW_ALL_LIMIT);
    expect(board.archivedCount).toBe(40);
    for (const c of board.columns) expect(c.cards).toHaveLength(Math.min(c.count, COLUMN_SIZE));
    // Generous on purpose so CI doesn't flake; locally it takes a small fraction of this.
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("board URL filters", () => {
  const parse = (fields: Record<string, string | null>) =>
    boardFiltersSchema.parse({ q: null, industry: null, show: null, all: null, archived: null, dupes: null, ...fields });

  it("reads a full board URL and writes it back the same", () => {
    const filters = parse({ q: " acme ", industry: "Tech", show: "COMMITTED,DECLINED", all: "CONTACTED", archived: "1", dupes: "1" });
    expect(filters).toEqual({ q: "acme", industry: "Tech", show: ["COMMITTED", "DECLINED"], all: "CONTACTED", archived: true, dupes: true });
    expect(boardQuery(filters)).toBe("?q=acme&industry=Tech&show=COMMITTED%2CDECLINED&all=CONTACTED&archived=1&dupes=1");
  });

  it("drops anything malformed instead of failing, and an empty board URL has no query", () => {
    const filters = parse({ q: "x".repeat(101), industry: "y".repeat(81), show: "COMMITTED,WON", all: "WON", archived: "yes", dupes: "yes" });
    expect(filters).toEqual(NONE);
    expect(parse({})).toEqual(NONE);
    expect(boardQuery(NONE)).toBe("");
  });
});

describe("unarchiving from the board", () => {
  it("stays on the board (no redirect) when asked to", async () => {
    const [id] = await seed(A, [{ name: "Old one", archived: true }]);
    const result = await asUser("officerA", () => unarchiveCompany(null, form({ workspaceId: "a", companyId: id, stay: "board" })));
    expect(result).toEqual({ ok: true, data: undefined });
    expect((await getBoard(A, NONE)).archivedCount).toBe(0);
  });

  it("refuses an unknown 'stay' value", async () => {
    const [id] = await seed(A, [{ name: "Old one", archived: true }]);
    const result = await asUser("officerA", () => unarchiveCompany(null, form({ workspaceId: "a", companyId: id, stay: "elsewhere" })));
    expect(result).toEqual({ ok: false, error: "Company not found." });
  });
});

describe("dates are shown in Purdue's time zone", () => {
  it("formats a day and a moment in Indiana time, not the server's", () => {
    // 3 am UTC on Oct 25 is still the evening of Oct 24 in West Lafayette (UTC-4 in October).
    expect(day(new Date("2026-10-25T03:00:00Z"))).toBe("Oct 24");
    expect(when(new Date("2026-10-25T05:15:00Z"))).toBe("Oct 25, 2026, 1:15 AM");
  });
});

// ----- Paging, the just-moved slip, and the look-alike count (de-bloat pass, P3) -----

const page = (changes: Partial<BoardPaging>): BoardPaging => ({ ...NO_PAGING, ...changes });
const many = (n: number, extra: Partial<Seed> = {}): Seed[] =>
  Array.from({ length: n }, (_, i) => ({ name: `Company ${String(i).padStart(3, "0")}`, followUp: "2026-11-01T12:00:00Z", ...extra }));

describe("a slip just moved (?moved=)", () => {
  it("is shown at the top of its new column even when it sorts past the first 50", async () => {
    // 149 replied companies with a follow-up date; the moved one has none, so it sorts last.
    const ids = await seed(A, [...many(149, { stage: "REPLIED" }), { name: "Copperleaf Energy", stage: "REPLIED" }]);
    const moved = ids[149];
    const plain = column(await getBoard(A, NONE), "REPLIED");
    expect(plain.cards.map((c) => c.id)).not.toContain(moved);

    const board = await getBoard(A, NONE, page({ moved }));
    const replied = column(board, "REPLIED");
    expect(replied.cards[0]).toMatchObject({ id: moved, name: "Copperleaf Energy" });
    expect(replied.pinned).toBe(moved);
    expect(replied.cards).toHaveLength(COLUMN_SIZE + 1);
    // The count is the real number of companies, not one more.
    expect(replied.count).toBe(150);
    expect(column(board, "NOT_CONTACTED").pinned).toBeNull();
  });

  it("is left where it is when it is already on the page, and ignored when the search hides it", async () => {
    const ids = await seed(A, [{ name: "Alpha", stage: "CONTACTED" }, { name: "Beta", stage: "CONTACTED" }]);
    const shown = column(await getBoard(A, NONE, page({ moved: ids[1] })), "CONTACTED");
    expect(shown.cards.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
    expect(shown.pinned).toBeNull();
    const searched = column(await getBoard(A, { ...NONE, q: "alpha" }, page({ moved: ids[1] })), "CONTACTED");
    expect(searched.cards.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("never pins another workspace's company", async () => {
    const [theirs] = await seed(B, [{ name: "B's company" }]);
    const board = await getBoard(A, NONE, page({ moved: theirs }));
    expect(board.columns.every((c) => c.pinned === null && c.cards.length === 0)).toBe(true);
  });
});

describe("column paging: Show 50 more, up to 200", () => {
  it("shows 50 more per step and stops at the cap", async () => {
    await seed(A, many(260));
    const at = async (n: number) => column(await getBoard(A, NONE, page({ more: { NOT_CONTACTED: n } })), "NOT_CONTACTED");
    expect((await at(100)).cards).toHaveLength(100);
    expect((await at(100)).hasMore).toBe(true);
    expect((await at(200)).cards).toHaveLength(COLUMN_CAP);
    // Asking past the cap (a hand-edited URL) still stops there.
    expect((await at(5000)).cards).toHaveLength(COLUMN_CAP);
    // Other columns are not affected.
    expect(column(await getBoard(A, NONE, page({ more: { NOT_CONTACTED: 200 } })), "CONTACTED").cards).toHaveLength(0);
  });

  it("an old ?all=<stage> link opens that column to the cap, no further", async () => {
    await seed(A, many(260));
    const all = column(await getBoard(A, { ...NONE, all: "NOT_CONTACTED" }), "NOT_CONTACTED");
    expect(all.cards).toHaveLength(COLUMN_CAP);
    expect(all.hasMore).toBe(true);
  });

  test.each([
    [{ more: "CONTACTED:100,REPLIED:150" }, { CONTACTED: 100, REPLIED: 150 }],
    [{ more: "CONTACTED:120" }, { CONTACTED: 100 }],
    [{ more: "CONTACTED:9999" }, { CONTACTED: 200 }],
    [{ more: "CONTACTED:50,WON:100,REPLIED:-50,REPLIED:abc" }, {}],
    [{ more: null }, {}],
  ])("reads more=%j as %j, dropping anything malformed", (raw, expected) => {
    expect(parseBoardPaging(raw).more).toEqual(expected);
  });

  it("reads and writes the rest of the paging, and keeps the filters' query", () => {
    const paging = parseBoardPaging({ more: "REPLIED:100", moved: "abc-123", aupto: "150", aq: "  acme " });
    expect(paging).toEqual({ more: { REPLIED: 100 }, moved: "abc-123", archivedUpto: 150, archivedQ: "acme" });
    expect(pagingParams(paging)).toEqual([
      ["more", "REPLIED:100"],
      ["moved", "abc-123"],
      ["aupto", "150"],
      ["aq", "acme"],
    ]);
    expect(withPaging("?q=x", paging)).toBe("?q=x&more=REPLIED%3A100&moved=abc-123&aupto=150&aq=acme");
    expect(withPaging("", NO_PAGING)).toBe("");
    expect(parseBoardPaging({ moved: "x'; drop", aupto: "7" })).toMatchObject({ moved: null, archivedUpto: ARCHIVED_PAGE });
  });

  it("pages and filters the archived sheet on its own", async () => {
    await seed(A, [...many(70, { archived: true }), { name: "Acme Old", archived: true }, { name: "Active one" }]);
    const first = await getBoard(A, { ...NONE, archived: true });
    expect(first.archivedCount).toBe(71);
    expect(first.archived).toHaveLength(ARCHIVED_PAGE);
    expect((await getBoard(A, { ...NONE, archived: true }, page({ archivedUpto: 100 }))).archived).toHaveLength(71);
    const filtered = await getBoard(A, { ...NONE, archived: true }, page({ archivedQ: "acme" }));
    expect(filtered.archived?.map((c) => c.name)).toEqual(["Acme Old"]);
    expect(filtered.archivedMatching).toBe(1);
    expect(filtered.archivedCount).toBe(71);
  });

  it("counts the whole workspace, ignoring the search, for the toolbar's controls", async () => {
    await seed(A, [{ name: "Acme" }, { name: "Globex" }, { name: "Gone", archived: true }]);
    expect((await getBoard(A, NONE)).workspaceTotal).toBe(2);
    expect((await getBoard(A, { ...NONE, q: "acme" })).workspaceTotal).toBe(2);
  });
});

describe("countPossibleDuplicates, the badge on the board's More menu", () => {
  async function plant(rows: { id: string; nameKey: string; domainKey?: string | null }[], tenant: Tenant = A) {
    await withTenant(tenant, (tx) =>
      tx.company.createMany({
        data: rows.map((r, i) => ({
          id: r.id,
          workspaceId: tenant.workspaceId,
          name: r.id,
          nameKey: r.nameKey,
          domainKey: r.domainKey ?? null,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        })),
      }),
    );
  }

  it("is 0 with no look-alikes", async () => {
    await plant([{ id: "c1", nameKey: "one" }, { id: "c2", nameKey: "two", domainKey: "two.com" }]);
    expect(await countPossibleDuplicates(A)).toBe(0);
  });

  it("equals the length of the pair list for small data: overlaps, decisions and archived companies included", async () => {
    await plant([
      // c1 and c2 share both name and website: one pair, not two.
      { id: "c1", nameKey: "acme", domainKey: "acme.com" },
      { id: "c2", nameKey: "acme", domainKey: "acme.com" },
      // c3 shares the website only, c4 the name only.
      { id: "c3", nameKey: "acme labs", domainKey: "acme.com" },
      { id: "c4", nameKey: "acme" },
      { id: "c5", nameKey: "globex" },
      { id: "c6", nameKey: "globex" },
      { id: "c7", nameKey: "solo" },
    ]);
    const listed = async () => (await listPossibleDuplicatePairs(A)).length;
    // Name "acme": c1-c2, c1-c4, c2-c4. Website: c1-c2 (again), c1-c3, c2-c3. Globex: c5-c6.
    expect(await listed()).toBe(6);
    expect(await countPossibleDuplicates(A)).toBe(6);
    await markSeparate(A, "c5", "c6");
    await markSeparate(A, "c1", "c3");
    expect(await listed()).toBe(4);
    expect(await countPossibleDuplicates(A)).toBe(4);
    await withTenant(A, (tx) => tx.company.update({ where: { id: "c4" }, data: { archivedAt: new Date() } }));
    expect(await listed()).toBe(2);
    expect(await countPossibleDuplicates(A)).toBe(2);
  });

  it("stops at 51 for a big group, so the badge reads 50+", async () => {
    // 40 companies on one website: 780 pairs.
    await plant(Array.from({ length: 40 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, nameKey: `n${i}`, domainKey: "linkedin.com" })));
    expect(await countPossibleDuplicates(A)).toBe(51);
    expect(await listPossibleDuplicatePairs(A)).toHaveLength(50);
  });

  it("counts a big group exactly once most of its pairs are decided", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `s${String(i).padStart(2, "0")}`);
    await plant(ids.map((id) => ({ id, nameKey: id, domainKey: "shared.com" })));
    // Mark every pair separate except the three with s00.
    const data: { workspaceId: string; companyAId: string; companyBId: string; decidedById: string }[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) if (!(i === 0 && j <= 3)) data.push({ workspaceId: "a", companyAId: ids[i], companyBId: ids[j], decidedById: "ownerA" });
    await withTenant(A, (tx) => tx.companyPairDecision.createMany({ data }));
    expect(await listPossibleDuplicatePairs(A)).toHaveLength(3);
    expect(await countPossibleDuplicates(A)).toBe(3);
  });

  it("never counts another workspace's companies", async () => {
    await plant([{ id: "b1", nameKey: "same" }, { id: "b2", nameKey: "same" }], B);
    expect(await countPossibleDuplicates(A)).toBe(0);
    expect(await countPossibleDuplicates(B)).toBe(1);
  });
});

describe("moving a slip someone else holds", () => {
  it("is still refused for an officer on the server, whatever the board shows", async () => {
    const [id] = await seed(A, [{ name: "Held", stage: "CONTACTED" }]);
    await withTenant(A, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimedById" = 'ownerA', "claimExpiresAt" = now() + interval '1 day' WHERE id = ${id}`);
    const result = await asUser("officerA", () => moveStage(null, form({ workspaceId: "a", companyId: id, stage: "REPLIED" })));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("holds this company") });
    expect(names(await getBoard(A, NONE), "CONTACTED")).toEqual(["Held"]);
    // The owner may.
    expect(await asUser("ownerA", () => moveStage(null, form({ workspaceId: "a", companyId: id, stage: "REPLIED" })))).toMatchObject({ ok: true });
  });
});
