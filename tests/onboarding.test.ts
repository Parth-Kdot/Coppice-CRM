import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { loadTourCompany, saveTourProgress } from "@/app/(app)/[workspaceId]/onboarding-actions";
import { claimCompany, dbNow } from "@/lib/claims";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { advance, basicsDoneElsewhere, complete, dismissAi, getProgress, setBasicsHidden, tourCompany } from "@/lib/onboarding";
import { redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

// Onboarding progress against the real database as app_user: row-level security (a person's row
// is theirs alone, owners included), the forward-only step, finishing once, and the server action.
vi.mock("next/headers", () => import("./helpers/next-request"));

const OWNER_A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const OWNER_B: Tenant = { userId: "ownerB", workspaceId: "b" };
// Signed in, but not a member of workspace "a".
const STRANGER_IN_A: Tenant = { userId: "ownerB", workspaceId: "a" };

const rowsSeenBy = (tenant: Tenant) =>
  withTenant(tenant, (tx) => tx.onboardingProgress.findMany({ select: { userId: true, workspaceId: true }, orderBy: { userId: "asc" } }));

// The seed marks everyone done; these tests start from "never started".
async function clearOwnRows(...tenants: Tenant[]) {
  for (const tenant of tenants) await withTenant(tenant, (tx) => tx.onboardingProgress.deleteMany({}));
}

beforeEach(async () => {
  await resetAndSeed();
  await clearOwnRows(OWNER_A, OFFICER_A, OWNER_B);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("row-level security", () => {
  beforeEach(async () => {
    await advance(OWNER_A, "basics", 2);
    await advance(OFFICER_A, "basics", 4);
    await advance(OWNER_B, "basics", 1);
  });

  it("each person sees only their own row, even an owner in the same workspace", async () => {
    expect(await rowsSeenBy(OWNER_A)).toEqual([{ userId: "ownerA", workspaceId: "a" }]);
    expect(await rowsSeenBy(OFFICER_A)).toEqual([{ userId: "officerA", workspaceId: "a" }]);
    expect(await rowsSeenBy(OWNER_B)).toEqual([{ userId: "ownerB", workspaceId: "b" }]);
  });

  it("an owner can't change, delete or forge an officer's row", async () => {
    const where = { workspaceId: "a", userId: "officerA" };
    expect((await withTenant(OWNER_A, (tx) => tx.onboardingProgress.updateMany({ where, data: { basicsStep: 0 } }))).count).toBe(0);
    expect((await withTenant(OWNER_A, (tx) => tx.onboardingProgress.deleteMany({ where }))).count).toBe(0);
    await expect(withTenant(OWNER_A, (tx) => tx.onboardingProgress.create({ data: { workspaceId: "a", userId: "officerA" } }))).rejects.toThrow(
      /row-level security|Unique constraint/,
    );
    expect((await getProgress(OFFICER_A))?.basicsStep).toBe(4);
  });

  it("an officer can't make a row for someone else, even a brand new one", async () => {
    await clearOwnRows(OWNER_A);
    await expect(withTenant(OFFICER_A, (tx) => tx.onboardingProgress.create({ data: { workspaceId: "a", userId: "ownerA" } }))).rejects.toThrow(
      /row-level security/,
    );
    expect(await getProgress(OWNER_A)).toBeNull();
  });

  it("no reads or writes across workspaces", async () => {
    // ownerA working in "a" can't see or write "b"'s rows.
    expect(await withTenant(OWNER_A, (tx) => tx.onboardingProgress.count({ where: { workspaceId: "b" } }))).toBe(0);
    await expect(withTenant(OWNER_A, (tx) => tx.onboardingProgress.create({ data: { workspaceId: "b", userId: "ownerA" } }))).rejects.toThrow(
      /row-level security/,
    );
    expect((await withTenant(OWNER_A, (tx) => tx.onboardingProgress.updateMany({ where: { workspaceId: "b" }, data: { aiStep: 3 } }))).count).toBe(0);
    expect((await getProgress(OWNER_B))?.aiStep).toBe(0);
  });

  it("a non-member sees nothing and can't write their own row into the workspace", async () => {
    expect(await rowsSeenBy(STRANGER_IN_A)).toEqual([]);
    await expect(withTenant(STRANGER_IN_A, (tx) => tx.onboardingProgress.create({ data: { workspaceId: "a", userId: "ownerB" } }))).rejects.toThrow(
      /row-level security/,
    );
    await expect(advance(STRANGER_IN_A, "basics", 3)).rejects.toThrow(/row-level security/);
  });

  it("outside withTenant the table looks empty and refuses writes", async () => {
    expect(await prisma.onboardingProgress.count()).toBe(0);
    await expect(prisma.onboardingProgress.create({ data: { workspaceId: "a", userId: "ownerA" } })).rejects.toThrow(/row-level security/);
  });

  it("a removed member's row stays, so rejoining doesn't repeat the basics", async () => {
    await complete(OFFICER_A, "basics", "member");
    await prisma.membership.delete({ where: { id: "m-officerA" } });
    await prisma.membership.create({ data: { id: "m-officerA-2", workspaceId: "a", userId: "officerA", role: "member", createdAt: new Date() } });
    expect((await getProgress(OFFICER_A))?.basicsDoneAt).toBeInstanceOf(Date);
  });

  it("deleting the workspace or the person removes their rows", async () => {
    await prisma.user.delete({ where: { id: "officerA" } });
    await prisma.workspace.delete({ where: { id: "b" } });
    expect(await rowsSeenBy(OWNER_A)).toEqual([{ userId: "ownerA", workspaceId: "a" }]);
  });
});

describe("progress", () => {
  it("no row means the basics have not started", async () => {
    expect(await getProgress(OFFICER_A)).toBeNull();
  });

  it("the first save creates the row; saving the same step again changes nothing", async () => {
    await advance(OFFICER_A, "basics", 3);
    await advance(OFFICER_A, "basics", 3);
    expect(await withTenant(OFFICER_A, (tx) => tx.onboardingProgress.count())).toBe(1);
    expect(await getProgress(OFFICER_A)).toMatchObject({ basicsStep: 3, basicsDoneAt: null, aiStep: 0 });
  });

  test.each([
    [[2, 5, 3], 5],
    [[6, 1], 6],
    [[0, 0], 0],
    [[4, 99], 20],
  ])("steps %o end at %i: a step never goes back", async (sequence, expected) => {
    for (const step of sequence) await advance(OFFICER_A, "basics", step);
    expect((await getProgress(OFFICER_A))?.basicsStep).toBe(expected);
  });

  it("the basics and the AI tour keep separate places", async () => {
    await advance(OFFICER_A, "basics", 6);
    await advance(OFFICER_A, "ai", 2);
    expect(await getProgress(OFFICER_A)).toMatchObject({ basicsStep: 6, aiStep: 2 });
  });

  it("two first saves at once leave one row", async () => {
    await Promise.all([advance(OFFICER_A, "basics", 1), advance(OFFICER_A, "basics", 2), advance(OFFICER_A, "ai", 1)]);
    expect(await withTenant(OFFICER_A, (tx) => tx.onboardingProgress.count())).toBe(1);
    expect(await getProgress(OFFICER_A)).toMatchObject({ basicsStep: 2, aiStep: 1 });
  });

  it("finishing is recorded once, with the role it was finished as", async () => {
    await complete(OFFICER_A, "basics", "member");
    const first = await getProgress(OFFICER_A);
    expect(first).toMatchObject({ basicsRole: "member" });
    expect(first?.basicsDoneAt).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 15));
    // Made owner and shown the invite card: the role moves on, the finish time does not.
    await complete(OFFICER_A, "basics", "owner");
    const second = await getProgress(OFFICER_A);
    expect(second?.basicsDoneAt?.getTime()).toBe(first?.basicsDoneAt?.getTime());
    expect(second?.basicsRole).toBe("owner");
  });

  it("the AI tour: done once, and 'Later' once", async () => {
    await dismissAi(OFFICER_A);
    const dismissed = (await getProgress(OFFICER_A))?.aiDismissedAt;
    expect(dismissed).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 15));
    await dismissAi(OFFICER_A);
    await complete(OFFICER_A, "ai", "member");
    const done = (await getProgress(OFFICER_A))?.aiDoneAt;
    await complete(OFFICER_A, "ai", "member");
    const after = await getProgress(OFFICER_A);
    expect(after?.aiDismissedAt?.getTime()).toBe(dismissed?.getTime());
    expect(after?.aiDoneAt?.getTime()).toBe(done?.getTime());
    expect(after?.basicsDoneAt).toBeNull();
  });

  it("the database refuses a step out of range or an unknown role", async () => {
    await advance(OFFICER_A, "basics", 1);
    const where = { workspaceId: "a", userId: "officerA" };
    await expect(withTenant(OFFICER_A, (tx) => tx.onboardingProgress.updateMany({ where, data: { basicsStep: 21 } }))).rejects.toThrow(/check constraint/);
    await expect(withTenant(OFFICER_A, (tx) => tx.onboardingProgress.updateMany({ where, data: { basicsRole: "admin" } }))).rejects.toThrow(/check constraint/);
  });
});

describe("the basics taken in another workspace", () => {
  it("finds the role they were finished as, owner first, and only the person's own rows", async () => {
    await prisma.membership.create({ data: { id: "m-officerA-b", workspaceId: "b", userId: "officerA", role: "member", createdAt: new Date() } });
    expect(await basicsDoneElsewhere("officerA", ["b"])).toBeNull();
    await complete({ userId: "officerA", workspaceId: "b" }, "basics", "member");
    expect(await basicsDoneElsewhere("officerA", ["b"])).toBe("member");
    await complete(OFFICER_A, "basics", "owner");
    expect(await basicsDoneElsewhere("officerA", ["b", "a"])).toBe("owner");
    // Someone else's finished basics never count for you.
    await complete(OWNER_B, "basics", "owner");
    expect(await basicsDoneElsewhere("ownerA", ["b"])).toBeNull();
  });

  it("hiding and resuming write only the person's own row", async () => {
    await setBasicsHidden(OFFICER_A, true);
    expect((await getProgress(OFFICER_A))?.basicsHiddenAt).toBeInstanceOf(Date);
    expect(await getProgress(OWNER_A)).toBeNull();
    await setBasicsHidden(OFFICER_A, false);
    expect((await getProgress(OFFICER_A))?.basicsHiddenAt).toBeNull();
  });
});

describe("tourCompany", () => {
  const make = (tenant: Tenant, id: string, name: string, extra: object = {}) =>
    withTenant(tenant, (tx) => tx.company.create({ data: { id, workspaceId: tenant.workspaceId, name, nameKey: name.toLowerCase(), ...extra } }));

  it("prefers a company you hold, then an open one nobody else holds, never another workspace's", async () => {
    expect(await tourCompany(OFFICER_A, await dbNow())).toBeNull();
    await make(OWNER_B, "co-b", "Elsewhere");
    expect(await tourCompany(OFFICER_A, await dbNow())).toBeNull();
    await make(OWNER_A, "co-done", "Signed", { stage: "COMMITTED" });
    await make(OWNER_A, "co-held", "Held by owner");
    await make(OWNER_A, "co-free", "Free");
    await make(OWNER_A, "co-mine", "Mine");
    expect((await claimCompany(OWNER_A, "co-held")).ok).toBe(true);
    expect(await tourCompany(OFFICER_A, await dbNow())).toBe("co-free");
    expect((await claimCompany(OFFICER_A, "co-mine")).ok).toBe(true);
    expect(await tourCompany(OFFICER_A, await dbNow())).toBe("co-mine");
  });
});

describe("saveTourProgress / loadTourCompany (server actions)", () => {
  const OK = { ok: true, data: undefined };

  it("saves a step, then finishes the basics with the server's idea of the role", async () => {
    expect(await asUser("officerA", () => saveTourProgress({ workspaceId: "a", tour: "basics", step: 3, event: "step" }))).toEqual(OK);
    expect((await getProgress(OFFICER_A))?.basicsStep).toBe(3);
    expect(await asUser("officerA", () => saveTourProgress({ workspaceId: "a", tour: "basics", step: 7, event: "done" }))).toEqual(OK);
    expect(await getProgress(OFFICER_A)).toMatchObject({ basicsStep: 7, basicsRole: "member" });
    expect((await getProgress(OFFICER_A))?.basicsDoneAt).toBeInstanceOf(Date);
  });

  it("'hide' is remembered for the basics until 'show'", async () => {
    expect(await asUser("officerA", () => saveTourProgress({ workspaceId: "a", tour: "basics", step: 2, event: "hide" }))).toEqual(OK);
    expect((await getProgress(OFFICER_A))?.basicsHiddenAt).toBeInstanceOf(Date);
    expect(await asUser("officerA", () => saveTourProgress({ workspaceId: "a", tour: "basics", step: 2, event: "show" }))).toEqual(OK);
    expect((await getProgress(OFFICER_A))?.basicsHiddenAt).toBeNull();
  });

  it("'later' puts the AI tour off", async () => {
    expect(await asUser("ownerA", () => saveTourProgress({ workspaceId: "a", tour: "ai", step: 0, event: "later" }))).toEqual(OK);
    expect((await getProgress(OWNER_A))?.aiDismissedAt).toBeInstanceOf(Date);
  });

  it("refuses a non-member, and writes nothing", async () => {
    expect(await asUser("ownerB", () => saveTourProgress({ workspaceId: "a", tour: "basics", step: 2, event: "step" }))).toEqual({
      ok: false,
      error: "Workspace not found.",
    });
    expect(await asUser("ownerB", () => loadTourCompany("a"))).toEqual({ ok: false, error: "Workspace not found." });
    expect(await rowsSeenBy(OWNER_B)).toEqual([]);
  });

  it("sends a signed-out caller to sign in", async () => {
    await expect(signedOut(() => saveTourProgress({ workspaceId: "a", tour: "basics", step: 1, event: "step" }))).rejects.toEqual(redirectTo("/signin"));
  });

  test.each([
    ["a step past the end", { workspaceId: "a", tour: "basics", step: 21, event: "step" }],
    ["a negative step", { workspaceId: "a", tour: "basics", step: -1, event: "step" }],
    ["a fractional step", { workspaceId: "a", tour: "basics", step: 1.5, event: "step" }],
    ["NaN", { workspaceId: "a", tour: "basics", step: Number.NaN, event: "step" }],
    ["a step as text", { workspaceId: "a", tour: "basics", step: "3", event: "step" }],
    ["an unknown tour", { workspaceId: "a", tour: "billing", step: 1, event: "step" }],
    ["an unknown event", { workspaceId: "a", tour: "basics", step: 1, event: "reset" }],
    ["'later' on the basics", { workspaceId: "a", tour: "basics", step: 1, event: "later" }],
    ["'hide' on the AI tour", { workspaceId: "a", tour: "ai", step: 1, event: "hide" }],
    ["no workspace", { workspaceId: "", tour: "basics", step: 1, event: "step" }],
  ])("refuses bad input: %s", async (_, input) => {
    const result = await asUser("officerA", () => saveTourProgress(input as Parameters<typeof saveTourProgress>[0]));
    expect(result).toEqual({ ok: false, error: "Could not save your place in the tour." });
    expect(await getProgress(OFFICER_A)).toBeNull();
  });

  it("loadTourCompany answers members with a company page or null", async () => {
    expect(await asUser("officerA", () => loadTourCompany("a"))).toEqual({ ok: true, data: { companyId: null } });
    await withTenant(OWNER_A, (tx) => tx.company.create({ data: { id: "co-1", workspaceId: "a", name: "Acme", nameKey: "acme" } }));
    expect(await asUser("officerA", () => loadTourCompany("a"))).toEqual({ ok: true, data: { companyId: "co-1" } });
  });
});
