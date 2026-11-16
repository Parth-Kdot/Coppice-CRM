import { beforeEach, describe, expect, it } from "vitest";
import { aiBreakdown, aiUsage, aiUsageDetail } from "@/lib/ai/run";
import { AiFeature } from "@/generated/prisma/enums";
import { breakdownAiUsage, describeAiFailures, describeAiUsage, GROUPED_FEATURES } from "@/lib/ai/usage";
import { dbNow } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

const A: Tenant = { userId: "ownerA", workspaceId: "a" };
const OFFICER_A: Tenant = { userId: "officerA", workspaceId: "a" };
const B: Tenant = { userId: "ownerB", workspaceId: "b" };

describe("breakdownAiUsage (pure)", () => {
  it("groups Smart import's three features and orders lines", () => {
    const b = breakdownAiUsage([
      { feature: "CLAIM_CHECK", status: "SUCCEEDED", count: 4 },
      { feature: "DRAFT", status: "SUCCEEDED", count: 4 },
      { feature: "IMPORT_MAPPING", status: "SUCCEEDED", count: 1 },
      { feature: "IMPORT_LOOKALIKES", status: "SUCCEEDED", count: 1 },
      { feature: "IMPORT_ROWS", status: "FAILED", count: 1 },
      { feature: "FACT_EXTRACTION", status: "SUCCEEDED", count: 2 },
    ]);
    expect(describeAiUsage(b)).toBe("4 draft calls, 4 claim checks, 3 Smart import calls, 2 fact sheet reads.");
    expect(b.total).toBe(13);
    expect(b.failed).toBe(1);
  });

  it("uses singular labels, skips features with no calls, and sums statuses", () => {
    const b = breakdownAiUsage([
      { feature: "DRAFT", status: "SUCCEEDED", count: 1 },
      { feature: "DRAFT", status: "FAILED", count: 1 },
      { feature: "FACT_EXTRACTION", status: "SUCCEEDED", count: 1 },
    ]);
    expect(describeAiUsage(b)).toBe("2 draft calls, 1 fact sheet read.");
    expect(b.parts.map((p) => p.count)).toEqual([2, 1]);
  });

  it("is empty with no runs, and words failures only when there are some", () => {
    expect(describeAiUsage(breakdownAiUsage([]))).toBe("");
    expect(describeAiFailures(0)).toBe("");
    expect(describeAiFailures(2)).toBe("2 of them failed. Failed calls still count.");
  });
});

describe("breakdownAiUsage covers every feature", () => {
  it("names research briefs' two calls as one line", () => {
    const b = breakdownAiUsage([
      { feature: "DRAFT", status: "SUCCEEDED", count: 83 },
      { feature: "CLAIM_CHECK", status: "SUCCEEDED", count: 27 },
      { feature: "FACT_EXTRACTION", status: "SUCCEEDED", count: 19 },
      { feature: "RESEARCH_READ", status: "SUCCEEDED", count: 1 },
      { feature: "RESEARCH_BRIEF", status: "FAILED", count: 1 },
    ]);
    expect(describeAiUsage(b)).toBe("83 draft calls, 27 claim checks, 19 fact sheet reads, 2 research brief calls.");
    expect(b.total).toBe(131);
  });

  it("every AiFeature is in exactly one group", () => {
    const all = Object.values(AiFeature);
    expect([...GROUPED_FEATURES].sort()).toEqual([...all].sort());
    expect(new Set(GROUPED_FEATURES).size).toBe(GROUPED_FEATURES.length);
  });

  it("the parts always add up to the total, whatever mix of features and statuses", () => {
    const statuses = ["SUCCEEDED", "FAILED", "RUNNING"] as const;
    const rows = Object.values(AiFeature).flatMap((feature, i) => statuses.map((status, j) => ({ feature, status, count: i + j + 1 })));
    const b = breakdownAiUsage(rows);
    expect(b.parts.reduce((sum, p) => sum + p.count, 0)).toBe(b.total);
    expect(b.total).toBe(rows.reduce((sum, r) => sum + r.count, 0));
    // A feature added later, before it has a group, is still counted.
    const later = breakdownAiUsage([{ feature: "SOMETHING_NEW" as AiFeature, status: "SUCCEEDED", count: 3 }]);
    expect(later.parts).toEqual([{ key: "other", label: "3 other AI calls", count: 3 }]);
  });
});

describe("aiBreakdown (database)", () => {
  beforeEach(resetAndSeed);

  async function add(t: Tenant, feature: "DRAFT" | "CLAIM_CHECK" | "IMPORT_ROWS", status: "SUCCEEDED" | "FAILED", count: number, ageDays = 0) {
    const at = new Date((await dbNow()).getTime() - ageDays * 24 * 60 * 60 * 1000);
    await withTenant(t, (tx) =>
      tx.aiRun.createMany({
        data: Array.from({ length: count }, () => ({
          workspaceId: t.workspaceId,
          userId: t.userId,
          feature,
          model: "m",
          status,
          latencyMs: 1,
          createdAt: at,
        })),
      }),
    );
  }

  it("counts every member and failed calls, within 30 days, for this workspace only", async () => {
    await add(A, "DRAFT", "SUCCEEDED", 2);
    await add(OFFICER_A, "DRAFT", "FAILED", 1);
    await add(A, "CLAIM_CHECK", "SUCCEEDED", 3);
    await add(A, "IMPORT_ROWS", "SUCCEEDED", 1);
    await add(A, "DRAFT", "SUCCEEDED", 5, 31);
    await add(B, "DRAFT", "SUCCEEDED", 9);
    const b = await aiBreakdown(A);
    expect(describeAiUsage(b)).toBe("3 draft calls, 3 claim checks, 1 Smart import call.");
    expect(b.failed).toBe(1);
    expect(describeAiUsage(await aiBreakdown(B))).toBe("9 draft calls.");
    // Settings' count is the breakdown's total: the same number aiUsage counts.
    const detail = await aiUsageDetail(A);
    expect(detail.used).toBe(7);
    expect(detail.used).toBe((await aiUsage(A)).used);
    expect(detail.breakdown.parts.map((p) => p.count)).toEqual([3, 3, 1]);
  });
});
