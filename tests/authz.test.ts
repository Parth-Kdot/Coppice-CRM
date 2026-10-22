import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canCreateWorkspace } from "@/lib/auth";
import { AuthzError, checkMembership, checkOwner } from "@/lib/authz";
import { prisma } from "@/lib/db";

// Two workspaces: "a" has an owner and an officer, "b" has its own owner.
async function seed() {
  const user = (id: string) => ({ id, name: id, email: `${id}@example.com`, emailVerified: true });
  await prisma.user.createMany({ data: [user("ownerA"), user("officerA"), user("ownerB")] });
  const now = new Date();
  await prisma.workspace.createMany({
    data: [
      { id: "a", name: "Org A", slug: "a", createdAt: now },
      { id: "b", name: "Org B", slug: "b", createdAt: now },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: "m1", workspaceId: "a", userId: "ownerA", role: "owner", createdAt: now },
      { id: "m2", workspaceId: "a", userId: "officerA", role: "member", createdAt: now },
      { id: "m3", workspaceId: "b", userId: "ownerB", role: "owner", createdAt: now },
    ],
  });
}

beforeEach(async () => {
  // Deleting workspaces and users cascades to memberships, invitations and sessions.
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
  await seed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkMembership", () => {
  it("returns the role for a member", async () => {
    await expect(checkMembership("officerA", "a")).resolves.toMatchObject({ role: "member" });
    await expect(checkMembership("ownerA", "a")).resolves.toMatchObject({ role: "owner" });
  });

  it("refuses a member of workspace A using workspace B's id", async () => {
    await expect(checkMembership("ownerA", "b")).rejects.toThrow(AuthzError);
    await expect(checkMembership("officerA", "b")).rejects.toThrow(AuthzError);
  });

  it("gives the same error for a workspace that doesn't exist", async () => {
    const missing = checkMembership("ownerA", "nope").catch((e: Error) => e.message);
    const forbidden = checkMembership("ownerA", "b").catch((e: Error) => e.message);
    expect(await missing).toBe(await forbidden);
  });
});

describe("checkOwner", () => {
  it("lets the owner through", async () => {
    await expect(checkOwner("ownerA", "a")).resolves.toMatchObject({ role: "owner" });
  });

  it("refuses an officer", async () => {
    await expect(checkOwner("officerA", "a")).rejects.toThrow("Only the workspace owner");
  });

  it("refuses the owner of a different workspace", async () => {
    await expect(checkOwner("ownerB", "a")).rejects.toThrow(AuthzError);
  });
});

describe("canCreateWorkspace (Option B allowlist)", () => {
  it("allows only listed emails, ignoring case and spaces", () => {
    process.env.WORKSPACE_CREATOR_EMAILS = " Chair@Example.com , admin@example.com";
    expect(canCreateWorkspace("chair@example.com")).toBe(true);
    expect(canCreateWorkspace("ADMIN@example.com")).toBe(true);
    expect(canCreateWorkspace("officer@example.com")).toBe(false);
  });

  it("allows nobody when the list is empty", () => {
    process.env.WORKSPACE_CREATOR_EMAILS = "";
    expect(canCreateWorkspace("chair@example.com")).toBe(false);
  });
});
