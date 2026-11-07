"use client";

import type { ReactNode } from "react";
import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { Tick } from "@/components/ledger/marks";
import type { ImportPreview } from "@/lib/csv";
import { IMPORT_FIELDS, type ImportField, type ImportMapping } from "@/lib/validation";

// The import ledger's pieces (components/csv-importer.tsx): a step, the column choices of step 2,
// and the rows that can't be imported in step 3.

// One step at a time is Now. A step that is finished but can still be changed (the columns) is
// Set, not Done; the import is Next while groups are waiting for a look.
type EntryState = "done" | "set" | "active" | "next" | "later";
const STATE_WORD: Record<EntryState, string> = { done: "Done", set: "Set", active: "Now", next: "Next", later: "Later" };

// One entry of the import ledger: the step number in the margin, a heading, and the body. A step
// that cannot start yet shows a single plain line instead of its controls.
export function Entry({ n, state, title, later, children }: { n: number; state: EntryState; title: string; later?: string; children?: ReactNode }) {
  return (
    <li className="lg-step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
      <div className="lg-step-margin" aria-hidden="true">
        <span className="lg-step-no">{state === "done" ? <Tick size={18} /> : n}</span>
        <span className="lg-step-state lg-tag">{STATE_WORD[state]}</span>
      </div>
      <div className="lg-step-body">
        <h2 className="lg-step-h">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {state === "later" && later ? <p className="lg-hint">{later}</p> : children}
      </div>
    </li>
  );
}

const FIELD_LABELS: Record<ImportField, string> = {
  name: "Company name (required)",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact name",
  contactEmail: "Contact email",
};

// Step 2: which column fills each field. A change asks the importer for a new preview.
export function ColumnsGrid({ view, onChange }: { view: ImportPreview; onChange: (mapping: ImportMapping) => void }) {
  return (
    <div className="lg-mapgrid">
      {IMPORT_FIELDS.map((field) => {
        const none = field === "name" ? [] : [{ value: "", label: "Not in this file" }];
        const columns = view.headers.map((header, index) => ({ value: String(index), label: header.trim() || `Column ${index + 1}` }));
        const current = view.mapping[field];
        return (
          <div key={field}>
            <p className="lg-maplabel" aria-hidden="true">
              {FIELD_LABELS[field]}
            </p>
            <LedgerMenu
              block
              hideLabel
              label={FIELD_LABELS[field]}
              value={current === null || current === undefined ? "" : String(current)}
              options={[...none, ...columns]}
              onChange={(value) => onChange({ ...view.mapping, [field]: value === "" ? null : Number(value) })}
            />
          </div>
        );
      })}
    </div>
  );
}

// Step 3: every row that can't be imported, and why.
export function RowProblems({ errors }: { errors: ImportPreview["errors"] }) {
  if (errors.length === 0) return null;
  return (
    <details open className="lg-problems">
      <summary>
        {errors.length} {errors.length === 1 ? "row" : "rows"} won&apos;t be imported. {errors.length === 1 ? "Fix it" : "Fix them"} in the sheet and upload it
        again to include {errors.length === 1 ? "it" : "them"}.
      </summary>
      <ul>
        {errors.map((e) => (
          <li key={e.row} className="lg-late">
            <WarningIcon size={14} />
            <span>
              Row {e.row}: {e.messages.join(" ")}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
