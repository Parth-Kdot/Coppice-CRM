import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Row-level security, constraints and indexes of the three tables the stats page's AI features
// added (ScorecardNarrative, TemplateExperiment, ExperimentArm), and the columns they put on
// Template, against the real database as app_user. Same seed as tests/rls.test.ts: workspace "a"
// (ownerA owner, officerA officer) and "b" (ownerB owner).
const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };
// ownerB claiming to act in workspace a: not a member there.
const B_IN_A: Tenant = { userId: "ownerB", workspaceId: "a" };

const RLS = /row-level security/i;

async function seedLab(tenant: Tenant, suffix: string) {
  await withTenant(tenant, async (tx) => {
    const { workspaceId, userId } = tenant;
    await tx.template.createMany({
      data: [
        { id: `tp-${suffix}`, workspaceId, name: "Base", body: "Hi" },
        { id: `tv-${suffix}`, workspaceId, name: "Base (B)", body: "Hello", familyId: `tp-${suffix}`, variantNote: "Warmer greeting." },
      ],
    });
    await tx.templateExperiment.create({ data: { id: `ex-${suffix}`, workspaceId, baseTemplateId: `tp-${suffix}`, startedById: userId } });
    await tx.experimentArm.createMany({
      data: [
        { id: `arm-a-${suffix}`, workspaceId, experimentId: `ex-${suffix}`, templateId: `tp-${suffix}`, label: "A", kind: "original", summary: "The original." },
        { id: `arm-b-${suffix}`, workspaceId, experimentId: `ex-${suffix}`, templateId: `tv-${suffix}`, label: "B", kind: "opening", summary: "Warmer greeting." },
      ],
    });
    await tx.scorecardNarrative.create({
      data: { id: `nar-${suffix}`, workspaceId, statsHash: "h", facts: { facts: [], names: {} }, paragraphs: [], model: "m", createdById: userId },
    });
  });
}

beforeEach(async () => {
  await resetAndSeed();
  await seedLab(A, "a");
  await seedLab(B, "b");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("row-level security is on", () => {
  test.for(["ScorecardNarrative", "TemplateExperiment", "ExperimentArm"])("%s has it enabled and forced", async (table) => {
    const [row] = await prisma.$queryRaw<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname = ${table}`;
    expect(row).toEqual({ enabled: true, forced: true });
  });

  it("the tables look empty without withTenant", async () => {
    expect(await prisma.scorecardNarrative.count()).toBe(0);
    expect(await prisma.templateExperiment.count()).toBe(0);
    expect(await prisma.experimentArm.count()).toBe(0);
  });

  it("the new functions and tables follow the database rules: app_user can't truncate or drop them", async () => {
    await expect(prisma.$executeRaw`TRUNCATE "TemplateExperiment" CASCADE`).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRaw`DROP TABLE "ExperimentArm"`).rejects.toThrow(/must be owner|permission denied/);
  });
});

describe("workspaces can't see each other's rows", () => {
  it("shows each workspace only its own", async () => {
    for (const [tenant, suffix] of [[A, "a"], [B, "b"]] as const) {
      const seen = await withTenant(tenant, async (tx) => ({
        narratives: (await tx.scorecardNarrative.findMany({ select: { id: true } })).map((r) => r.id),
        experiments: (await tx.templateExperiment.findMany({ select: { id: true } })).map((r) => r.id),
        arms: (await tx.experimentArm.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id),
        templates: (await tx.template.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((r) => r.id),
      }));
      expect(seen).toEqual({
        narratives: [`nar-${suffix}`],
        experiments: [`ex-${suffix}`],
        arms: [`arm-a-${suffix}`, `arm-b-${suffix}`],
        templates: [`tp-${suffix}`, `tv-${suffix}`],
      });
    }
  });

  it("shows a non-member nothing, even with the workspace's id", async () => {
    const seen = await withTenant(B_IN_A, async (tx) => [
      await tx.scorecardNarrative.count(),
      await tx.templateExperiment.count(),
      await tx.experimentArm.count(),
    ]);
    expect(seen).toEqual([0, 0, 0]);
  });

  it("refuses a row written into another workspace, and by a non-member", async () => {
    await expect(
      withTenant(B, (tx) => tx.scorecardNarrative.create({ data: { workspaceId: "a", statsHash: "h", facts: {}, paragraphs: [], model: "m", createdById: "ownerB" } })),
    ).rejects.toThrow(RLS);
    await expect(withTenant(B_IN_A, (tx) => tx.templateExperiment.create({ data: { workspaceId: "a", baseTemplateId: "tp-a", startedById: "ownerB" } }))).rejects.toThrow(RLS);
    await expect(
      withTenant(B, (tx) => tx.experimentArm.create({ data: { workspaceId: "a", experimentId: "ex-a", templateId: "tp-a", label: "C", kind: "ask", summary: "x" } })),
    ).rejects.toThrow(RLS);
  });

  it("can't change or delete another workspace's rows", async () => {
    const result = await withTenant(B, async (tx) => ({
      narrative: (await tx.scorecardNarrative.updateMany({ where: { id: "nar-a" }, data: { model: "x" } })).count,
      experiment: (await tx.templateExperiment.updateMany({ where: { id: "ex-a" }, data: { status: "ENDED", endedAt: new Date(), keptTemplateId: "tp-a" } })).count,
      arm: (await tx.experimentArm.deleteMany({ where: { id: "arm-a-a" } })).count,
    }));
    expect(result).toEqual({ narrative: 0, experiment: 0, arm: 0 });
    expect(await withTenant(A, (tx) => tx.experimentArm.count())).toBe(2);
  });
});

describe("officers read, owners write", () => {
  it("lets an officer read experiments and arms and the stored explanation", async () => {
    const seen = await withTenant(OFFICER_A, async (tx) => [await tx.templateExperiment.count(), await tx.experimentArm.count(), await tx.scorecardNarrative.count()]);
    expect(seen).toEqual([1, 2, 1]);
  });

  it("lets an officer write the stored explanation: any member can press the button", async () => {
    await withTenant(OFFICER_A, (tx) => tx.scorecardNarrative.update({ where: { workspaceId: "a" }, data: { createdById: "officerA", model: "m2" } }));
    expect(await withTenant(A, (tx) => tx.scorecardNarrative.findUniqueOrThrow({ where: { workspaceId: "a" }, select: { model: true, createdById: true } }))).toEqual({
      model: "m2",
      createdById: "officerA",
    });
  });

  it("refuses an officer who tries to start, change, end or delete an experiment or an arm", async () => {
    await expect(withTenant(OFFICER_A, (tx) => tx.templateExperiment.create({ data: { workspaceId: "a", baseTemplateId: "tp-a", startedById: "officerA" } }))).rejects.toThrow(RLS);
    await expect(
      withTenant(OFFICER_A, (tx) => tx.experimentArm.create({ data: { workspaceId: "a", experimentId: "ex-a", templateId: "tp-a", label: "C", kind: "ask", summary: "x" } })),
    ).rejects.toThrow(RLS);
    const changed = await withTenant(OFFICER_A, async (tx) => ({
      end: (await tx.templateExperiment.updateMany({ where: { id: "ex-a" }, data: { status: "ENDED", endedAt: new Date(), keptTemplateId: "tp-a" } })).count,
      relabel: (await tx.experimentArm.updateMany({ where: { id: "arm-a-a" }, data: { summary: "changed" } })).count,
      dropArm: (await tx.experimentArm.deleteMany({ where: { id: "arm-b-a" } })).count,
      dropExperiment: (await tx.templateExperiment.deleteMany({ where: { id: "ex-a" } })).count,
    }));
    expect(changed).toEqual({ end: 0, relabel: 0, dropArm: 0, dropExperiment: 0 });
    expect(await withTenant(A, async (tx) => [await tx.templateExperiment.count({ where: { status: "RUNNING" } }), await tx.experimentArm.count()])).toEqual([1, 2]);
  });

  it("lets an owner do all of it", async () => {
    await withTenant(A, async (tx) => {
      await tx.templateExperiment.update({ where: { id: "ex-a" }, data: { status: "ENDED", endedAt: new Date(), keptTemplateId: "tv-a" } });
      await tx.experimentArm.update({ where: { id: "arm-a-a" }, data: { summary: "changed" } });
    });
    expect(await withTenant(A, (tx) => tx.templateExperiment.findUniqueOrThrow({ where: { id: "ex-a" }, select: { status: true, keptTemplateId: true } }))).toEqual({ status: "ENDED", keptTemplateId: "tv-a" });
  });
});

describe("one explanation per workspace", () => {
  it("refuses a second row for the same workspace", async () => {
    await expect(
      withTenant(A, (tx) => tx.scorecardNarrative.create({ data: { workspaceId: "a", statsHash: "h2", facts: {}, paragraphs: [], model: "m", createdById: "ownerA" } })),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("one running experiment per workspace, in the database too", () => {
  it("refuses a second RUNNING experiment in the same workspace", async () => {
    await expect(withTenant(A, (tx) => tx.templateExperiment.create({ data: { workspaceId: "a", baseTemplateId: "tv-a", startedById: "ownerA" } }))).rejects.toThrow(/unique|duplicate/i);
  });

  it("allows a RUNNING one in another workspace, and any number of ended ones", async () => {
    await withTenant(A, async (tx) => {
      await tx.templateExperiment.update({ where: { id: "ex-a" }, data: { status: "ENDED", endedAt: new Date(), keptTemplateId: "tp-a" } });
      await tx.templateExperiment.create({ data: { id: "ex-a2", workspaceId: "a", baseTemplateId: "tp-a", startedById: "ownerA", status: "ENDED", endedAt: new Date(), keptTemplateId: "tp-a" } });
      // With the earlier ones ended, a new one can run.
      await tx.templateExperiment.create({ data: { id: "ex-a3", workspaceId: "a", baseTemplateId: "tv-a", startedById: "ownerA" } });
    });
    expect(await withTenant(A, (tx) => tx.templateExperiment.count({ where: { status: "RUNNING" } }))).toBe(1);
    expect(await withTenant(B, (tx) => tx.templateExperiment.count({ where: { status: "RUNNING" } }))).toBe(1);
  });

  it("is a partial index that `prisma migrate diff` leaves alone", async () => {
    const [row] = await prisma.$queryRaw<{ def: string }[]>`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'TemplateExperiment_one_running_key'`;
    expect(row.def).toMatch(/UNIQUE INDEX .*\("workspaceId"\) WHERE/);
    expect(row.def).toContain("RUNNING");
  });
});

describe("constraints", () => {
  const arm = (label: string, kind: string) => ({ workspaceId: "a", experimentId: "ex-a", templateId: "tp-a", label, kind, summary: "x" });

  it("limits an arm's label to A, B or C and its kind to the five it can be", async () => {
    await withTenant(A, (tx) => tx.experimentArm.deleteMany({ where: { templateId: "tp-a" } }));
    await expect(withTenant(A, (tx) => tx.experimentArm.create({ data: arm("D", "ask") }))).rejects.toThrow(/check constraint|violates/i);
    await expect(withTenant(A, (tx) => tx.experimentArm.create({ data: arm("A", "rewrite") }))).rejects.toThrow(/check constraint|violates/i);
    for (const kind of ["original", "opening", "ask", "closing", "shorter"]) {
      await withTenant(A, async (tx) => {
        await tx.experimentArm.create({ data: arm("A", kind) });
        await tx.experimentArm.deleteMany({ where: { templateId: "tp-a" } });
      });
    }
  });

  it("an ended experiment needs an end and a kept template; a running one has neither", async () => {
    await expect(
      withTenant(A, (tx) => tx.templateExperiment.update({ where: { id: "ex-a" }, data: { status: "ENDED" } })),
    ).rejects.toThrow(/check constraint|violates/i);
    await expect(
      withTenant(A, (tx) => tx.templateExperiment.update({ where: { id: "ex-a" }, data: { keptTemplateId: "tp-a" } })),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("an arm is one of an experiment's, once", async () => {
    await expect(withTenant(A, (tx) => tx.experimentArm.create({ data: arm("C", "ask") }))).rejects.toThrow(/unique|duplicate/i);
  });

  it("ties every row to the same workspace: no arm, base, kept or family from another workspace", async () => {
    // A template of workspace b, which workspace a's rows must never point at.
    await expect(
      withTenant(A, (tx) => tx.experimentArm.create({ data: { workspaceId: "a", experimentId: "ex-a", templateId: "tp-b", label: "C", kind: "ask", summary: "x" } })),
    ).rejects.toThrow(/foreign key/i);
    await expect(withTenant(A, (tx) => tx.templateExperiment.create({ data: { id: "ex-x", workspaceId: "a", baseTemplateId: "tp-b", startedById: "ownerA", status: "ENDED", endedAt: new Date(), keptTemplateId: "tp-a" } }))).rejects.toThrow(
      /foreign key/i,
    );
    await expect(withTenant(A, (tx) => tx.template.create({ data: { workspaceId: "a", name: "Variant of theirs", body: "Hi", familyId: "tp-b" } }))).rejects.toThrow(/foreign key/i);
    await expect(
      withTenant(A, (tx) => tx.experimentArm.create({ data: { workspaceId: "a", experimentId: "ex-b", templateId: "tp-a", label: "C", kind: "ask", summary: "x" } })),
    ).rejects.toThrow(/foreign key/i);
  });

  it("a variant points at a template of its own workspace, and a template without a family is untouched", async () => {
    const rows = await withTenant(A, (tx) => tx.template.findMany({ select: { id: true, familyId: true, variantNote: true }, orderBy: { id: "asc" } }));
    expect(rows).toEqual([
      { id: "tp-a", familyId: null, variantNote: null },
      { id: "tv-a", familyId: "tp-a", variantNote: "Warmer greeting." },
    ]);
  });
});

describe("deleting a workspace", () => {
  it("removes its templates, variants, experiments, arms and explanation together", async () => {
    await prisma.workspace.delete({ where: { id: "b" } });
    expect(await withTenant(B, async (tx) => [await tx.template.count(), await tx.templateExperiment.count(), await tx.experimentArm.count(), await tx.scorecardNarrative.count()])).toEqual([0, 0, 0, 0]);
    // Workspace a is untouched.
    expect(await withTenant(A, async (tx) => [await tx.template.count(), await tx.templateExperiment.count(), await tx.experimentArm.count(), await tx.scorecardNarrative.count()])).toEqual([2, 1, 2, 1]);
  });
});
