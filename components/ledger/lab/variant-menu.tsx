"use client";

import { useState } from "react";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { VariantDialog } from "./variant-dialog";
import "./lab.css";

// The "Try a variant" entry in a template's ⋯ menu, for owners (stats page rows and Settings rows).
// Picking it opens the panel (variant-dialog.tsx); the AI is not asked until the panel's own button
// is pressed. Only one experiment runs at a time, so while one does the entry is there but off, and
// says why.

type Props = { workspaceId: string; templateId: string; templateName: string; running: boolean };

export function TryVariantMenu({ workspaceId, templateId, templateName, running }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <OverflowMenu
        label={`More actions for ${templateName}`}
        items={[
          {
            key: "variant",
            label: "Try a variant",
            hint: "Test a one-change version of it",
            disabled: running,
            disabledReason: "An experiment is already running. End it first.",
            onSelect: () => setOpen(true),
          },
        ]}
      />
      {open && <VariantDialog workspaceId={workspaceId} templateId={templateId} templateName={templateName} onClose={() => setOpen(false)} />}
    </>
  );
}
