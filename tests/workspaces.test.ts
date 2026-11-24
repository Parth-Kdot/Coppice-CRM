import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { acceptInvitation, createWorkspace } from "@/app/(app)/workspaces/actions";
import { prisma } from "@/lib/db";
import { form, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { invite, resetAndSeed, roleOf } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const NOT_OK = { ok: false, error: expect.any(String) };

beforeEach(async () => {
  await resetAndSeed();
  // Someone with no workspace yet, who gets invited in these tests.
  await prisma.user.create({
    data: { id: "newbie", name: "newbie", email: "newbie@example.com", emailVerified: true },
  });
  process.env.WORKSPACE_CREATOR_EMAILS = "ownera@example.com";
});

afterEach(() => {
  delete process.env.WORKSPACE_CREATOR_EMAILS;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createWorkspace (Option B: only listed emails can create)", () => {
  const create = (name: string) => createWorkspace(null, form({ name }));

  it("says how long a name may be, in plain words, when it is too long", async () => {
    expect(await asUser("ownerA", () => create("x".repeat(81)))).toEqual({ ok: false, error: "Keep the name to 80 characters or fewer." });
  });

  it("refuses a name with a NUL character instead of failing in Postgres", async () => {
    expect(await asUser("ownerA", () => create("Robotics\u0000Club"))).toEqual({ ok: false, error: "This text has a character Coppice can't save." });
    expect(await prisma.workspace.count()).toBe(2);
  });

  it("creates the workspace, makes the creator its owner, and opens it", async () => {
    const error = await asUser("ownerA", () => create("  Robotics Club  ")).catch((e) => e);
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: "Robotics Club" } });
    expect(error).toEqual(redirectTo(`/${workspace.id}`));
    expect(workspace.claimWindowDays).toBe(14);
    const membership = await prisma.membership.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    expect(membership).toMatchObject({ userId: "ownerA", role: "owner" });
  });

  it("refuses someone who isn't on the list, in workspace wording", async () => {
    const result = await asUser("officerA", () => create("Sneaky Org"));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("workspace") });
    expect(await prisma.workspace.count({ where: { name: "Sneaky Org" } })).toBe(0);
  });

  it("refuses everyone when the list is empty", async () => {
    process.env.WORKSPACE_CREATOR_EMAILS = "";
    expect(await asUser("ownerA", () => create("Robotics Club"))).toEqual(NOT_OK);
  });

  test.for([
    ["an empty name", ""],
    ["only spaces", "   "],
    ["one character", "X"],
    ["81 characters", "x".repeat(81)],
  ] as const)("rejects %s", async ([, name]) => {
    expect(await asUser("ownerA", () => create(name))).toEqual(NOT_OK);
    expect(await prisma.workspace.count()).toBe(2);
  });

  it("allows two workspaces with the same name (each has its own id)", async () => {
    await asUser("ownerA", () => create("Org A")).catch(() => {});
    expect(await prisma.workspace.count({ where: { name: "Org A" } })).toBe(2);
  });

  it("sends a signed-out visitor to /signin", async () => {
    await expect(signedOut(() => create("Robotics Club"))).rejects.toEqual(redirectTo("/signin"));
  });
});

describe("acceptInvitation", () => {
  const accept = (userId: string, invitationId: string) =>
    asUser(userId, () => acceptInvitation(null, form({ invitationId })));
  const membershipOf = (userId: string) =>
    prisma.membership.findFirst({ where: { workspaceId: "a", userId }, select: { role: true } });

  it("joins the workspace with the invited role and opens it", async () => {
    await invite({ id: "inv", email: "newbie@example.com" });
    await expect(accept("newbie", "inv")).rejects.toEqual(redirectTo("/a"));
    expect(await membershipOf("newbie")).toEqual({ role: "member" });
    expect((await prisma.invitation.findUnique({ where: { id: "inv" } }))?.status).toBe("accepted");
  });

  it("joins as owner when invited as owner", async () => {
    await invite({ id: "inv", email: "newbie@example.com", role: "owner" });
    await expect(accept("newbie", "inv")).rejects.toEqual(redirectTo("/a"));
    expect(await membershipOf("newbie")).toEqual({ role: "owner" });
  });

  it("joining again (double click, or back then Join) just opens the workspace", async () => {
    await invite({ id: "inv", email: "newbie@example.com" });
    await expect(accept("newbie", "inv")).rejects.toEqual(redirectTo("/a"));
    await expect(accept("newbie", "inv")).rejects.toEqual(redirectTo("/a"));
    expect(await prisma.membership.count({ where: { workspaceId: "a", userId: "newbie" } })).toBe(1);
  });

  it("two simultaneous Join clicks still create one membership", async () => {
    await invite({ id: "inv", email: "newbie@example.com" });
    const results = await Promise.allSettled([accept("newbie", "inv"), accept("newbie", "inv")]);
    for (const result of results) expect(result).toMatchObject({ status: "rejected", reason: redirectTo("/a") });
    expect(await prisma.membership.count({ where: { workspaceId: "a", userId: "newbie" } })).toBe(1);
  });

  it("refuses an invitation addressed to someone else", async () => {
    await invite({ id: "inv", email: "someone-else@example.com" });
    expect(await accept("newbie", "inv")).toEqual(NOT_OK);
    expect(await membershipOf("newbie")).toBeNull();
  });

  it("doesn't reveal another person's invitation by redirecting a non-member", async () => {
    await invite({ id: "inv", email: "someone-else@example.com" });
    expect(await accept("ownerB", "inv")).toEqual(NOT_OK);
  });

  test.for([
    ["expired", { expiresAt: new Date(Date.now() - 60_000) }],
    ["cancelled", { status: "canceled" }],
    ["rejected", { status: "rejected" }],
  ] as const)("refuses an invitation that was %s", async ([, fields]) => {
    await invite({ id: "inv", email: "newbie@example.com", ...fields });
    expect(await accept("newbie", "inv")).toEqual(NOT_OK);
    expect(await membershipOf("newbie")).toBeNull();
  });

  it("refuses a user whose email isn't verified", async () => {
    await prisma.user.update({ where: { id: "newbie" }, data: { emailVerified: false } });
    await invite({ id: "inv", email: "newbie@example.com" });
    expect(await accept("newbie", "inv")).toEqual(NOT_OK);
    expect(await membershipOf("newbie")).toBeNull();
  });

  it("returns an error for an invitation that doesn't exist", async () => {
    expect(await accept("newbie", "nope")).toEqual(NOT_OK);
  });

  it("returns an error for an empty invitation id", async () => {
    expect(await accept("newbie", "")).toEqual({ ok: false, error: "Invitation not found." });
  });

  it("sends a signed-out visitor to /signin", async () => {
    await invite({ id: "inv", email: "newbie@example.com" });
    await expect(signedOut(() => acceptInvitation(null, form({ invitationId: "inv" })))).rejects.toEqual(
      redirectTo("/signin"),
    );
    expect(await roleOf("m-officerA")).toBe("member");
  });
});
