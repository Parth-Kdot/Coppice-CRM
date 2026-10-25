import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { unarchiveCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import type { Stage } from "@/generated/prisma/enums";
import { COLUMN_SIZE, getBoard, SHOW_ALL_LIMIT, type Board } from "@/lib/board";
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
const NONE: BoardFilters = { q: "", industry: "", show: [], all: null, archived: false };

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
    boardFiltersSchema.parse({ q: null, industry: null, show: null, all: null, archived: null, ...fields });

  it("reads a full board URL and writes it back the same", () => {
    const filters = parse({ q: " acme ", industry: "Tech", show: "COMMITTED,DECLINED", all: "CONTACTED", archived: "1" });
    expect(filters).toEqual({ q: "acme", industry: "Tech", show: ["COMMITTED", "DECLINED"], all: "CONTACTED", archived: true });
    expect(boardQuery(filters)).toBe("?q=acme&industry=Tech&show=COMMITTED%2CDECLINED&all=CONTACTED&archived=1");
  });

  it("drops anything malformed instead of failing, and an empty board URL has no query", () => {
    const filters = parse({ q: "x".repeat(101), industry: "y".repeat(81), show: "COMMITTED,WON", all: "WON", archived: "yes" });
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
