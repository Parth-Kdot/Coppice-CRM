"use client";

import { useRouter } from "next/navigation";
import { LedgerMenu } from "../ledger-menu";

// The year switcher: past boards' handoffs stay readable. Picking a year goes to ?year=, so the
// choice is a link someone can share.
export function YearMenu({ workspaceId, value, options }: { workspaceId: string; value: number; options: { year: number; label: string; hint?: string }[] }) {
  const router = useRouter();
  return (
    <LedgerMenu
      label="Board year"
      align="right"
      value={String(value)}
      options={options.map((o) => ({ value: String(o.year), label: o.label, hint: o.hint }))}
      onChange={(next) => router.push(`/${workspaceId}/capsule?year=${next}#handoff`)}
    />
  );
}
