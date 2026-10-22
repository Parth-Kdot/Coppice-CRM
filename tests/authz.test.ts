import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canCreateWorkspace } from "@/lib/auth";
import { AuthzError, checkMembership, checkOwner } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

beforeEach(resetAndSeed);

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

  it("allows nobody when the variable isn't set at all", () => {
    delete process.env.WORKSPACE_CREATOR_EMAILS;
    expect(canCreateWorkspace("chair@example.com")).toBe(false);
  });
});
