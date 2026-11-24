import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { canCreateWorkspace } from "@/lib/auth";
import { AuthzError, REQUEST_PATH_HEADER, checkMembership, checkOwner, requireMembership, requireMembershipOr404, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { safeNextPath } from "@/lib/validation";
import { notFoundError, redirectTo } from "./helpers/form";
import { signedInHeaders } from "./helpers/session";
import { resetAndSeed } from "./helpers/seed";

// next/headers, swapped for one whose request headers each test sets (the page's path included).
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));

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

describe("requireUser and checkMembership, cached per request", () => {
  it("never hands one person's membership to another", async () => {
    const [owner, officer, again] = await Promise.all([checkMembership("ownerA", "a"), checkMembership("officerA", "a"), checkMembership("ownerA", "a")]);
    expect(owner).toEqual({ userId: "ownerA", workspaceId: "a", role: "owner" });
    expect(officer).toEqual({ userId: "officerA", workspaceId: "a", role: "member" });
    expect(again).toEqual(owner);
  });

  it("reads membership afresh on the next request, so a removed member is refused at once", async () => {
    await expect(checkMembership("officerA", "a")).resolves.toMatchObject({ role: "member" });
    await prisma.membership.delete({ where: { id: "m-officerA" } });
    await expect(checkMembership("officerA", "a")).rejects.toThrow(AuthzError);
  });

  it("each request sees its own signed-in user", async () => {
    request.headers = await signedInHeaders("ownerA");
    expect((await requireUser()).id).toBe("ownerA");
    request.headers = await signedInHeaders("officerA");
    expect((await requireUser()).id).toBe("officerA");
    await expect(requireMembership("a")).resolves.toMatchObject({ userId: "officerA", role: "member" });
  });

  it("a non-member still gets the same 404 as a workspace that doesn't exist", async () => {
    request.headers = await signedInHeaders("ownerB");
    await expect(requireMembershipOr404("a")).rejects.toEqual(notFoundError);
    await expect(requireMembershipOr404("nope")).rejects.toEqual(notFoundError);
  });
});

describe("signed out: sent to /signin with the page to come back to", () => {
  const signedOutAt = (path: string | null) => {
    request.headers = new Headers(path === null ? {} : { [REQUEST_PATH_HEADER]: path });
    return requireUser();
  };

  it("carries a page inside the app as ?next=", async () => {
    await expect(signedOutAt("/demo/companies/abc?tab=log")).rejects.toEqual(redirectTo(`/signin?next=${encodeURIComponent("/demo/companies/abc?tab=log")}`));
  });

  test.for([
    ["no path at all", null],
    ["the workspace list (the default anyway)", "/workspaces"],
    ["another site", "https://evil.example/x"],
    ["a protocol-relative address", "//evil.example/x"],
    ["a backslash trick", "/\\evil.example"],
  ] as const)("plain /signin for %s", async ([, path]) => {
    await expect(signedOutAt(path)).rejects.toEqual(redirectTo("/signin"));
  });
});

describe("safeNextPath: only a path on this site", () => {
  test.for([
    ["/demo-riverbend/companies/abc", "/demo-riverbend/companies/abc"],
    ["/demo-riverbend/board?q=acme&show=COMMITTED", "/demo-riverbend/board?q=acme&show=COMMITTED"],
    ["/demo-riverbend/settings#templates", "/demo-riverbend/settings#templates"],
    ["/workspaces", "/workspaces"],
  ] as const)("keeps %j", ([value, expected]) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  test.for([
    ["//evil.example", "//evil.example"],
    ["https://evil.example/", "https://evil.example/"],
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["/\\evil.example", "/\\evil.example"],
    ["\\\\evil.example", "\\\\evil.example"],
    ["a relative path", "workspaces"],
    ["an empty string", ""],
    ["a tab inside", "/\t/evil.example"],
    ["a newline", "/a\nb"],
    ["the sign-in page itself", "/signin?next=/x"],
    ["the auth API", "/api/auth/sign-out"],
    ["the OAuth pages", "/oauth/consent"],
    ["something very long", `/${"a".repeat(600)}`],
  ] as const)("refuses %s", ([, value]) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("refuses anything that isn't a string", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/a"])).toBeNull();
  });
});
