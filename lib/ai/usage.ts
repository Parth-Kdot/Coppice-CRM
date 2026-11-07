import type { AiFeature, AiRunStatus } from "@/generated/prisma/enums";

// What the 30-day AI count is made of, in plain words. Pure, so it is easy to test; the grouped
// query that feeds it is aiBreakdown() in lib/ai/run.ts.

export type AiUsageRow = { feature: AiFeature; status: AiRunStatus; count: number };
export type AiUsagePart = { key: string; label: string; count: number };
// `total` is every call counted, the same number as the 30-day count.
export type AiBreakdown = { parts: AiUsagePart[]; failed: number; total: number };

// Display order. Smart import's three features are one line. A draft is "draft calls": one Draft
// click writes two drafts in one call and checks them in another (a claim check).
const GROUPS: { key: string; one: string; many: string; features: AiFeature[] }[] = [
  { key: "draft", one: "draft call", many: "draft calls", features: ["DRAFT"] },
  { key: "claim-check", one: "claim check", many: "claim checks", features: ["CLAIM_CHECK"] },
  { key: "smart-import", one: "Smart import call", many: "Smart import calls", features: ["IMPORT_MAPPING", "IMPORT_LOOKALIKES", "IMPORT_ROWS"] },
  { key: "fact-sheet", one: "fact sheet read", many: "fact sheet reads", features: ["FACT_EXTRACTION"] },
];

export function breakdownAiUsage(rows: AiUsageRow[]): AiBreakdown {
  const parts: AiUsagePart[] = [];
  for (const group of GROUPS) {
    const count = rows.filter((r) => group.features.includes(r.feature)).reduce((sum, r) => sum + r.count, 0);
    if (count > 0) parts.push({ key: group.key, label: `${count} ${count === 1 ? group.one : group.many}`, count });
  }
  const failed = rows.filter((r) => r.status === "FAILED").reduce((sum, r) => sum + r.count, 0);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return { parts, failed, total };
}

// "4 draft calls, 4 claim checks, 3 Smart import calls." Empty when nothing was used.
export function describeAiUsage(breakdown: AiBreakdown): string {
  if (breakdown.parts.length === 0) return "";
  return `${breakdown.parts.map((p) => p.label).join(", ")}.`;
}

export function describeAiFailures(failed: number): string {
  if (failed <= 0) return "";
  return `${failed} of them failed. Failed calls still count.`;
}
