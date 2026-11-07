import { beforeEach, describe, expect, it } from "vitest";
import { aiBreakdown } from "@/lib/ai/run";
import { breakdownAiUsage, describeAiFailures, describeAiUsage } from "@/lib/ai/usage";
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
    expect(describeAiUsage(b)).toBe("4 drafts, 4 claim checks, 3 Smart import calls, 2 fact sheet reads.");
    expect(b.failed).toBe(1);
  });

  it("uses singular labels, skips features with no calls, and sums statuses", () => {
    const b = breakdownAiUsage([
      { feature: "DRAFT", status: "SUCCEEDED", count: 1 },
      { feature: "DRAFT", status: "FAILED", count: 1 },
      { feature: "FACT_EXTRACTION", status: "SUCCEEDED", count: 1 },
    ]);
    expect(describeAiUsage(b)).toBe("2 drafts, 1 fact sheet read.");
    expect(b.parts.map((p) => p.count)).toEqual([2, 1]);
  });

  it("is empty with no runs, and words failures only when there are some", () => {
    expect(describeAiUsage(breakdownAiUsage([]))).toBe("");
    expect(describeAiFailures(0)).toBe("");
    expect(describeAiFailures(2)).toBe("2 of them failed. Failed calls still count.");
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
    expect(describeAiUsage(b)).toBe("3 drafts, 3 claim checks, 1 Smart import call.");
    expect(b.failed).toBe(1);
    expect(describeAiUsage(await aiBreakdown(B))).toBe("9 drafts.");
  });
});
