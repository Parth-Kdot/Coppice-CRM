import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, test } from "vitest";
import { PLACEHOLDERS } from "@/lib/placeholders";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { assertLocalDatabases, isLocalDatabaseUrl } from "../prisma/seed-guard";
import { DEMO_WORKSPACE_ID, seedDemo } from "../prisma/seed-demo";
import { resetAndSeed } from "./helpers/seed";

describe("seed host check", () => {
  test.each([
    ["postgresql://app_user:pw@localhost:5445/boilerpitch", true],
    ["postgres://postgres:pw@127.0.0.1:5432/postgres", true],
    ["postgresql://u:pw@[::1]:5432/db", true],
    ["postgresql://postgres.abcdefgh:pw@db.abcdefgh.supabase.co:5432/postgres", false],
    ["postgresql://app_user.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", false],
    ["postgresql://u:pw@localhost.evil.example.com:5432/db", false],
    ["postgresql://u:pw@10.0.0.5:5432/db", false],
    ["postgresql://localhost@evil.example.com/db", false],
    // The pg driver would connect to the host named in the query string, not the one in the URL.
    ["postgresql://u:pw@localhost:5432/db?host=db.abcdefgh.supabase.co", false],
    ["postgresql://u:pw@localhost:5432/db?hostaddr=203.0.113.9", false],
    ["http://localhost:5432/db", false],
    ["not a url", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalDatabaseUrl(url)).toBe(expected);
  });

  it("needs both DATABASE_URL and DIRECT_URL to be local, and never prints the URL", () => {
    const local = "postgresql://u:secret-pw@localhost:5445/db";
    const remote = "postgresql://u:secret-pw@db.abcdefgh.supabase.co:5432/postgres";
    expect(() => assertLocalDatabases({ DATABASE_URL: local, DIRECT_URL: local })).not.toThrow();
    expect(() => assertLocalDatabases({ DATABASE_URL: remote, DIRECT_URL: local })).toThrow(/DATABASE_URL/);
    expect(() => assertLocalDatabases({ DATABASE_URL: local, DIRECT_URL: remote })).toThrow(/DIRECT_URL/);
    expect(() => assertLocalDatabases({ DATABASE_URL: local })).toThrow(/DIRECT_URL/);
    try {
      assertLocalDatabases({ DATABASE_URL: remote, DIRECT_URL: remote });
    } catch (error) {
      expect(String(error)).not.toContain("secret-pw");
      expect(String(error)).not.toContain("supabase");
    }
  });

  it("the seed command itself stops before connecting when a URL is remote", () => {
    const remote = "postgresql://app_user:pw@db.abcdefgh.supabase.co:5432/postgres";
    const run = () =>
      execFileSync("npx", ["tsx", "prisma/seed.ts"], {
        env: { ...process.env, DATABASE_URL: remote, DIRECT_URL: remote },
        stdio: "pipe",
        timeout: 60_000,
      });
    expect(run).toThrow(/Refusing to seed/);
  });
});

// Everything a run writes, minus the timestamps (which come from the database clock and move
// between runs) and generated order.
async function snapshot() {
  return withTenant({ userId: "demo-user-dana", workspaceId: DEMO_WORKSPACE_ID }, async (tx) => {
    const where = { workspaceId: DEMO_WORKSPACE_ID };
    return {
      companies: await tx.company.findMany({ where, orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true, lastContactedAt: true, claimExpiresAt: true, nextFollowUpAt: true } }),
      contacts: await tx.contact.findMany({ where, orderBy: { id: "asc" }, omit: { createdAt: true } }),
      templates: await tx.template.findMany({ where, orderBy: { id: "asc" }, omit: { createdAt: true, updatedAt: true, archivedAt: true } }),
      outreach: await tx.outreach.findMany({ where, orderBy: { id: "asc" }, omit: { sentAt: true } }),
      stageChanges: await tx.stageChange.findMany({ where, orderBy: { id: "asc" }, omit: { changedAt: true } }),
    };
  });
}

const demoTenant = { userId: "demo-user-dana", workspaceId: DEMO_WORKSPACE_ID };

describe("demo seed", () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it("running it twice gives the same rows and leaves other workspaces alone", async () => {
    // Another workspace with a company in it, which the seed must never touch.
    await withTenant({ userId: "ownerB", workspaceId: "b" }, (tx) =>
      tx.company.create({ data: { id: "other-co", workspaceId: "b", name: "Other Co", nameKey: "other co" } }),
    );

    const first = await seedDemo();
    const before = await snapshot();
    const second = await seedDemo();
    const after = await snapshot();

    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(after.companies).toHaveLength(40);

    const others = await withTenant({ userId: "ownerB", workspaceId: "b" }, (tx) => tx.company.findMany({ select: { id: true } }));
    expect(others).toEqual([{ id: "other-co" }]);
    expect(await withTenant({ userId: "ownerA", workspaceId: "a" }, (tx) => tx.company.count())).toBe(0);
    expect(await prisma.membership.count({ where: { workspaceId: DEMO_WORKSPACE_ID } })).toBe(5);
    expect(await prisma.user.count({ where: { email: { endsWith: "@example.com" } } })).toBe(3 + 5);
  });

  it("builds a believable pipeline", async () => {
    await seedDemo();
    const now = await dbNow();
    const data = await withTenant(demoTenant, async (tx) => ({
      companies: await tx.company.findMany({ include: { contacts: true } }),
      templates: await tx.template.findMany(),
      outreach: await tx.outreach.findMany({ orderBy: { sentAt: "asc" } }),
      changes: await tx.stageChange.findMany({ orderBy: { changedAt: "asc" } }),
    }));

    // Forty companies across all six stages, with fictional example.com websites and contacts.
    expect(data.companies).toHaveLength(40);
    expect(new Set(data.companies.map((c) => c.stage)).size).toBe(6);
    for (const company of data.companies) {
      expect(company.website).toMatch(/^https:\/\/[a-z-]+\.example\.com$/);
      for (const contact of company.contacts) expect(contact.email).toMatch(/@[a-z-]+\.example\.com$/);
    }
    expect(data.companies.filter((c) => c.contacts.length > 0).length).toBeGreaterThanOrEqual(30);

    // Templates use only the three placeholders; one is archived; most outreach uses one.
    expect(data.templates).toHaveLength(3);
    expect(data.templates.filter((t) => t.archivedAt).length).toBe(1);
    for (const template of data.templates) {
      const used = [...template.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(0);
      for (const name of used) expect(PLACEHOLDERS as readonly string[]).toContain(name);
    }
    const emails = data.outreach.filter((o) => o.channel === "EMAIL");
    expect(data.outreach.filter((o) => o.templateId).length / data.outreach.length).toBeGreaterThan(0.6);
    expect(emails.filter((o) => o.templateId).length / emails.length).toBeGreaterThan(0.7);
    expect(data.outreach.some((o) => o.gotReply)).toBe(true);
    expect(data.outreach.every((o) => o.note && o.sentAt <= now)).toBe(true);
    const touchCounts = data.companies.map((c) => data.outreach.filter((o) => o.companyId === c.id).length);
    expect(touchCounts.some((n) => n >= 3)).toBe(true);

    // Stage history is a chain from Not contacted to the company's current stage, in time order,
    // and each company's last contact matches its last outreach.
    for (const company of data.companies) {
      const moves = data.changes.filter((m) => m.companyId === company.id);
      let at = "NOT_CONTACTED";
      for (const move of moves) {
        expect(move.fromStage).toBe(at);
        expect(move.changedAt <= now).toBe(true);
        at = move.toStage;
      }
      expect(at).toBe(company.stage);
      const touches = data.outreach.filter((o) => o.companyId === company.id);
      expect(company.lastContactedAt?.getTime() ?? null).toBe(touches.at(-1)?.sentAt.getTime() ?? null);
      if (company.stage !== "NOT_CONTACTED") expect(touches.length).toBeGreaterThan(0);
      // A reply only exists for companies that moved past Contacted (or declined after one).
      if (touches.some((o) => o.gotReply)) expect(moves.some((m) => m.toStage === "REPLIED")).toBe(true);
    }

    // Follow-ups: only open, contacted companies have one; some are overdue and some are ahead.
    const withFollowUp = data.companies.filter((c) => c.nextFollowUpAt);
    for (const company of withFollowUp) {
      expect(["CONTACTED", "REPLIED", "IN_CONVERSATION"]).toContain(company.stage);
      expect(company.nextFollowUpAt! > company.lastContactedAt!).toBe(true);
    }
    expect(withFollowUp.filter((c) => c.nextFollowUpAt! <= now).length).toBeGreaterThanOrEqual(8);
    expect(withFollowUp.filter((c) => c.nextFollowUpAt! > now).length).toBeGreaterThanOrEqual(5);

    // Claims: some live, some expired, never on a closed company.
    const claimed = data.companies.filter((c) => c.claimedById);
    expect(claimed.filter((c) => c.claimExpiresAt! > now).length).toBeGreaterThanOrEqual(5);
    expect(claimed.filter((c) => c.claimExpiresAt! <= now).length).toBeGreaterThanOrEqual(2);
    for (const company of claimed) expect(["COMMITTED", "DECLINED"]).not.toContain(company.stage);
  });

  it("is dated from the database clock, so an old seed is rebuilt as freshly overdue", async () => {
    await seedDemo();
    await withTenant(demoTenant, (tx) => tx.company.updateMany({ data: { nextFollowUpAt: new Date("2020-01-01") } }));
    await seedDemo();
    const now = await dbNow();
    const due = await withTenant(demoTenant, (tx) => tx.company.count({ where: { nextFollowUpAt: { lte: now } } }));
    expect(due).toBeGreaterThanOrEqual(8);
  });

  describe("SEED_OWNER_EMAIL", () => {
    it("adds a local user as an owner, and keeps them on rerun", async () => {
      await prisma.user.create({ data: { id: "me", name: "Me", email: "me.local@example.com", emailVerified: true } });
      expect((await seedDemo({ ownerEmail: " Me.Local@Example.com " })).ownerNote).toMatch(/is an owner/);
      await seedDemo();
      const membership = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: "me" } } });
      expect(membership?.role).toBe("owner");
      // The demo workspace was rebuilt, and the user can read it.
      expect(await withTenant({ userId: "me", workspaceId: DEMO_WORKSPACE_ID }, (tx) => tx.company.count())).toBe(40);
    });

    it("says so when no such user exists, and does not create one", async () => {
      const result = await seedDemo({ ownerEmail: "nobody@example.com" });
      expect(result.ownerNote).toMatch(/no local user/);
      expect(await prisma.user.count({ where: { email: "nobody@example.com" } })).toBe(0);
    });
  });
});
