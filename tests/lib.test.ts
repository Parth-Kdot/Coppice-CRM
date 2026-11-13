import { APIError } from "better-auth";
import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { failure, LAST_OWNER_MESSAGE } from "@/lib/action-failure";
import { AuthzError, requireMembershipOr404, requireUser, roleLabel } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toRole } from "@/lib/roles";
import { notFoundError, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("failure()", () => {
  it("passes our own permission errors through", () => {
    expect(failure(new AuthzError("Only the workspace owner can do that."))).toEqual({
      ok: false,
      error: "Only the workspace owner can do that.",
    });
  });

  it("rewords Better Auth's 'organization' as 'workspace'", () => {
    const error = new APIError("BAD_REQUEST", { message: "Organization not found in this organization" });
    expect(failure(error)).toEqual({ ok: false, error: "Workspace not found in this workspace" });
  });

  it("turns the last-owner database error into a readable message", () => {
    const error = new Error(`Database error. Code: P0001. Message: ${LAST_OWNER_MESSAGE}`);
    expect(failure(error)).toEqual({ ok: false, error: LAST_OWNER_MESSAGE });
  });

  test.for([
    ["an unexpected error", new Error("connection refused")],
    ["something that isn't an Error", "boom"],
  ] as const)("rethrows %s so real bugs aren't hidden", ([, thrown]) => {
    expect(() => failure(thrown)).toThrow();
  });
});

describe("requireUser", () => {
  it("returns the signed-in user", async () => {
    expect((await asUser("officerA", requireUser)).id).toBe("officerA");
  });

  it("sends a signed-out visitor to /signin", async () => {
    await expect(signedOut(requireUser)).rejects.toEqual(redirectTo("/signin"));
  });
});

describe("requireMembershipOr404 (used by workspace pages)", () => {
  it("returns the membership for a member", async () => {
    expect(await asUser("officerA", () => requireMembershipOr404("a"))).toMatchObject({ role: "member" });
  });

  test.for(["b", "does-not-exist"])("shows a 404 for workspace %s, so ids can't be probed", async (id) => {
    await expect(asUser("officerA", () => requireMembershipOr404(id))).rejects.toEqual(notFoundError);
  });

  it("sends a signed-out visitor to /signin instead of a 404", async () => {
    await expect(signedOut(() => requireMembershipOr404("a"))).rejects.toEqual(redirectTo("/signin"));
  });
});

it("roleLabel shows owner as Owner and member as Officer", () => {
  expect([roleLabel("owner"), roleLabel("member")]).toEqual(["Owner", "Officer"]);
});

test.for([
  ["owner", "owner"],
  ["member", "member"],
  ["member,owner", "member"],
  ["owner,member", "member"],
  ["Owner", "member"],
  ["", "member"],
] as const)("toRole reads the stored role %j as %s: only the exact word owner is an owner", ([raw, role]) => {
  expect(toRole(raw)).toBe(role);
});

describe("startup checks fail fast with a clear message", () => {
  test.for(["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])(
    "lib/auth.ts refuses to load without %s",
    async (name) => {
      const saved = process.env[name];
      delete process.env[name];
      vi.resetModules();
      try {
        await expect(import("@/lib/auth")).rejects.toThrow(`${name} is not set`);
      } finally {
        process.env[name] = saved;
        vi.resetModules();
      }
    },
  );

  it("lib/db.ts refuses to start without DATABASE_URL", async () => {
    const saved = process.env.DATABASE_URL;
    const cached = (globalThis as { prisma?: unknown }).prisma;
    delete process.env.DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.resetModules();
    try {
      await expect(import("@/lib/db")).rejects.toThrow("DATABASE_URL is not set");
    } finally {
      process.env.DATABASE_URL = saved;
      (globalThis as { prisma?: unknown }).prisma = cached;
      vi.resetModules();
    }
  });
});
