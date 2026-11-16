import { globSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { createWorkspace } from "@/app/(app)/workspaces/actions";
import { inviteMember } from "@/app/(app)/[workspaceId]/settings/actions";
import { prisma, withTenant } from "@/lib/db";
import { form } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Source-code guards: these read the code itself and fail the build if a dangerous pattern
// appears. They turn the raw SQL allowlist and the claim-writing rule into something CI enforces, not something to remember.
const APP_CODE = ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.tsx", "proxy.ts"];
const ALL_CODE = [...APP_CODE, "scripts/**/*.ts"];
const files = (patterns: string[]) => patterns.flatMap((pattern) => globSync(pattern));
const source = (file: string) => readFileSync(file, "utf8");

// Raw SQL may only appear in these places (the raw SQL allowlist). Migrations and tests are allowed too
// but aren't scanned here.
const RAW_SQL_ALLOWED = ["lib/claims.ts", "lib/db.ts", "scripts/local-db.ts"];

describe("source guards", () => {
  it("finds the code to scan (so these tests can't pass by checking nothing)", () => {
    expect(files(APP_CODE).length).toBeGreaterThan(10);
  });

  it("only lib/previous-versions.ts touches previous versions, and only the company page and get_company read them", () => {
    // Comments are removed first, so a sentence that names a function is not a use of it.
    const code = (f: string) => source(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(files(APP_CODE).filter((f) => /\.previousVersion\b/.test(code(f)))).toEqual(["lib/previous-versions.ts"]);
    // Any way of importing the module (the alias or a relative path, resolved from the file), and any
    // mention of the page reader (a renamed import, a function passed by reference), counts.
    const importsPreviousVersions = (f: string) =>
      [...code(f).matchAll(/from\s+["']([^"']+)["']/g)].some(([, spec]) => {
        const target = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? join(dirname(f), spec) : null;
        return target !== null && normalize(target) === "lib/previous-versions";
      });
    expect(files(APP_CODE).filter(importsPreviousVersions).sort()).toEqual(
      ["app/(app)/[workspaceId]/companies/[companyId]/page.tsx", "lib/companies.ts", "lib/mcp/tools/companies.ts", "lib/restore-version.ts"].sort(),
    );
    expect(files(APP_CODE).filter((f) => /\bgetCompanyPage\b/.test(code(f))).sort()).toEqual(
      ["app/(app)/[workspaceId]/companies/[companyId]/page.tsx", "lib/companies.ts", "lib/mcp/tools/companies.ts"].sort(),
    );
    // get_company also returns previous versions, so nothing outside the MCP server may import its tools.
    expect(files(APP_CODE).filter((f) => !f.startsWith("lib/mcp/") && /from\s+["'][^"']*mcp\/tools(\/[^"']*)?["']/.test(code(f)))).toEqual([]);
  });

  test.for(files(ALL_CODE))("%s never uses the unsafe raw SQL functions", (file) => {
    // These take a plain string, so anything glued into it can become SQL. The tagged-template
    // forms ($queryRaw`...${value}`) send values separately as parameters instead.
    expect(source(file)).not.toMatch(/\$(queryRaw|executeRaw)Unsafe|Prisma\.raw\(/);
  });

  test.for(files(ALL_CODE).filter((file) => !RAW_SQL_ALLOWED.includes(file)))(
    "%s has no raw SQL (only allowlisted files may)",
    (file) => {
      expect(source(file)).not.toMatch(/\$queryRaw|\$executeRaw|Prisma\.sql|\.query\(\s*[`"']/);
    },
  );

  test.for(files(APP_CODE))("%s never imports from scripts/ (local tooling stays out of the app)", (file) => {
    expect(source(file)).not.toMatch(/from\s+["'](\.\.\/)+scripts\/|from\s+["']@\/scripts\//);
  });

  test.for(files(APP_CODE))("%s has no eval, new Function or raw HTML injection", (file) => {
    expect(source(file)).not.toMatch(/\beval\(|new Function\(|dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });

  // Only lib/claims.ts may write a claim. Reading is fine (`claimedById: true` in a
  // select, or `claimedBy` to show the holder); assigning anything else is a write.
  test.for(files(APP_CODE).filter((file) => file !== "lib/claims.ts"))("%s never writes a claim field", (file) => {
    // The lookahead skips the spaces itself, so `claimedById: true` (a read) never matches.
    expect(source(file)).not.toMatch(/\b(claimedById|claimExpiresAt)\s*:(?!\s*true\b)|"(claimedById|claimExpiresAt)"\s*=/);
  });
});

// The same attack strings against the real code. Every value travels as a parameter, so
// Postgres treats it as plain text, never as SQL.
const INJECTIONS = [
  "a'; DROP TABLE \"Company\"; --",
  "' OR '1'='1",
  "a' UNION SELECT email FROM \"user\" --",
  "\\'; DELETE FROM membership; --",
];

describe("SQL injection attempts", () => {
  beforeEach(async () => {
    await resetAndSeed();
    process.env.WORKSPACE_CREATOR_EMAILS = "ownera@example.com";
  });

  afterAll(async () => {
    delete process.env.WORKSPACE_CREATOR_EMAILS;
    await prisma.$disconnect();
  });

  // Nothing deleted or dropped. Creating a workspace adds its creator's membership, hence the parameter.
  const tablesIntact = async ({ memberships = 3 } = {}) => {
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.membership.count()).toBe(memberships);
    const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('public."Company"') IS NOT NULL AS exists`;
    expect(exists).toBe(true);
  };

  test.for(INJECTIONS)("withTenant treats %j as an id that matches nothing", async (attack) => {
    const seen = await withTenant({ userId: attack, workspaceId: attack }, (tx) => tx.company.findMany());
    expect(seen).toEqual([]);
    await tablesIntact();
  });

  test.for(INJECTIONS)("a workspace named %j is stored as plain text", async (attack) => {
    await asUser("ownerA", () => createWorkspace(null, form({ name: attack.slice(0, 80) }))).catch(() => {});
    expect(await prisma.workspace.count({ where: { name: attack.slice(0, 80).trim() } })).toBe(1);
    await tablesIntact({ memberships: 4 });
  });

  test.for(INJECTIONS)("an id of %j in a server action is refused, nothing else happens", async (attack) => {
    const result = await asUser("ownerA", () =>
      inviteMember(null, form({ workspaceId: attack, email: "x@example.com", role: "member" })),
    );
    expect(result.ok).toBe(false);
    await tablesIntact();
  });
});
