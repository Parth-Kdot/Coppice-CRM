import type { ReactNode } from "react";
import { Disclosure } from "@/components/ledger/disclosure";
import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { Tick } from "@/components/ledger/marks";
import { ShowMore } from "@/components/ledger/show-more";
import type { ImportPreview } from "@/lib/csv";
import { IMPORT_FIELDS, type ImportField } from "@/lib/limits";
import type { ImportMapping } from "@/lib/validation";

// The import's pieces (components/importer/importer.tsx): a step of the review, the column check of
// step 2, and the rows that can't be imported (or import with a note) in step 3.

// One step of the review: its number in the margin (a tick once it needs nothing more), a heading
// and the body. The margin is dropped on a phone (import.css).
export function Entry({ n, done, title, children }: { n: number; done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="lg-step lg-impstep" data-state={done ? "done" : "set"}>
      <div className="lg-step-margin" aria-hidden="true">
        <span className="lg-step-no">{done ? <Tick size={18} /> : n}</span>
      </div>
      <div className="lg-step-body">
        <h2 className="lg-step-h">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}

const FIELD_LABELS: Record<ImportField, string> = {
  name: "Company name",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact name",
  contactEmail: "Contact email",
};

const columnName = (headers: string[], index: number | null) => (index === null ? "Not in this file" : headers[index]?.trim() || `Column ${index + 1}`);

const SHORT_LABELS: Record<ImportField, string> = {
  name: "Company",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact",
  contactEmail: "Email",
};

// Step 2 as one line: "Company: column Name, Website: column Site", and Change for the full grid.
export function ColumnsLine({ view }: { view: ImportPreview }) {
  const used = IMPORT_FIELDS.filter((f) => view.mapping[f] !== null);
  return (
    <span className="lg-colsline">
      {used.map((f, i) => (
        <span key={f} className="lg-colpair">
          {SHORT_LABELS[f]}: column <strong className="lg-wrap-any">{columnName(view.headers, view.mapping[f])}</strong>
          {i < used.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

// The columns no field uses: they are not imported, and saying so beats dropping them silently (a
// "Stage" or "Last contacted" column, say). `read`: columns Smart import is reading anyway.
export function UnusedColumns({ view, read = [], smartOffered }: { view: ImportPreview; read?: number[]; smartOffered: boolean }) {
  const used = new Set(IMPORT_FIELDS.map((f) => view.mapping[f]).filter((c) => c !== null));
  const unused = view.headers.map((_, i) => i).filter((i) => !used.has(i) && !read.includes(i));
  if (unused.length === 0) return null;
  const names = unused.map((i) => `"${columnName(view.headers, i)}"`).join(", ");
  return (
    <p className="lg-hint lg-unusedcols" role="note">
      Not imported: {names}.{" "}
      {smartOffered
        ? "Smart import below can read stages, dates and notes out of columns like these."
        : "Choose one of them as Notes under Change to keep what it says."}
    </p>
  );
}

// The full grid: which column fills each field. A column already in use says which field it fills,
// so choosing it (a swap) is no surprise. A change asks the importer for a new preview.
export function ColumnsGrid({ view, disabled, onChange }: { view: ImportPreview; disabled: boolean; onChange: (field: ImportField, column: number | null) => void }) {
  return (
    <fieldset className="lg-mapgrid lg-mapset" disabled={disabled}>
      <legend className="sr-only">Which column fills each field</legend>
      {IMPORT_FIELDS.map((field) => {
        const none = field === "name" ? [] : [{ value: "", label: "Not in this file" }];
        const columns = view.headers.map((header, index) => {
          const holder = IMPORT_FIELDS.find((f) => f !== field && view.mapping[f] === index);
          return { value: String(index), label: header.trim() || `Column ${index + 1}`, hint: holder ? `Now ${FIELD_LABELS[holder]}; they swap` : undefined };
        });
        const current = view.mapping[field];
        return (
          <div key={field}>
            <p className="lg-maplabel" aria-hidden="true">
              {FIELD_LABELS[field]}
              {field === "name" ? " (required)" : ""}
            </p>
            <LedgerMenu
              block
              hideLabel
              label={FIELD_LABELS[field]}
              value={current === null || current === undefined ? "" : String(current)}
              options={[...none, ...columns]}
              onChange={(value) => onChange(field, value === "" ? null : Number(value))}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

// Swaps instead of refusing: choosing a column another field uses gives that field "Not in this
// file" (or, for the company name, which must have a column, this field's old column). Returns the
// new mapping and a sentence saying what moved, or a reason it can't.
export function swapColumn(mapping: ImportMapping, headers: string[], field: ImportField, column: number | null): { mapping: ImportMapping; note: string | null } | { error: string } {
  const next: Record<ImportField, number | null> = { ...mapping, [field]: column };
  let note: string | null = null;
  const holder = column === null ? undefined : IMPORT_FIELDS.find((f) => f !== field && mapping[f] === column);
  if (holder) {
    const named = `"${columnName(headers, column)}"`;
    if (holder === "name") {
      const old = mapping[field];
      if (old === null) return { error: `${named} is the company name. Choose another column for Company name first.` };
      next.name = old;
      note = `${named} now fills ${FIELD_LABELS[field]}; Company name takes "${columnName(headers, old)}".`;
    } else {
      next[holder] = null;
      note = `${named} now fills ${FIELD_LABELS[field]}. ${FIELD_LABELS[holder]} is set to Not in this file.`;
    }
  }
  return { mapping: next as ImportMapping, note };
}

// Step 3: every row that can't be imported, and why. Folded, unless no row can be imported.
export function RowProblems({ errors, allFail }: { errors: ImportPreview["errors"]; allFail: boolean }) {
  if (errors.length === 0) return null;
  const rows = errors.length === 1 ? "row" : "rows";
  return (
    <Disclosure variant="inline" className="lg-impnote" summary={`${errors.length.toLocaleString("en-US")} ${rows} can't be imported`} defaultOpen={allFail}>
      <p className="lg-hint">Fix {errors.length === 1 ? "it" : "them"} in the sheet and choose the file again.</p>
      <ShowMore initial={20} label="rows" as="ul" listClassName="lg-rowlist">
        {errors.map((e) => (
          <li key={e.row} className="lg-late">
            <WarningIcon size={14} />
            <span>
              Row {e.row}
              {e.name ? ` (${e.name})` : ""}: {e.messages.join(" ")}
            </span>
          </li>
        ))}
      </ShowMore>
    </Disclosure>
  );
}

// Rows that import with part of their contact left out or filled in. They never block the row.
export function RowWarnings({ warnings }: { warnings: ImportPreview["warnings"] }) {
  if (warnings.length === 0) return null;
  return (
    <Disclosure variant="inline" className="lg-impnote" summary={`Contact notes on ${warnings.length.toLocaleString("en-US")} ${warnings.length === 1 ? "row" : "rows"}`}>
      <p className="lg-hint">These rows still import.</p>
      <ShowMore initial={20} label="rows" as="ul" listClassName="lg-rowlist">
        {warnings.map((w) => (
          <li key={w.row}>
            <span>
              Row {w.row} ({w.name}): {w.messages.join(" ")}
            </span>
          </li>
        ))}
      </ShowMore>
    </Disclosure>
  );
}
