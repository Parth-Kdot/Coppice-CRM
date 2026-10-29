"use client";

import Link from "next/link";
import { useId, useState, useTransition, type ReactNode } from "react";
import "./zod-jitless";
import { ChipGroup } from "./chips";
import { WarningIcon } from "./icons";
import { LedgerMenu } from "./ledger-menu";
import { Tick } from "./marks";
import { ErrorLine } from "./shared";
import type { ImportPreview, ImportResult } from "@/lib/csv";
import { IMPORT_FIELDS, type ActionResult, type ImportField, type ImportMapping } from "@/lib/validation";
import "@/components/ledger/company.css";
import "@/components/ledger/pages.css";

type Props = {
  workspaceId: string;
  preview: (prev: ActionResult<ImportPreview> | null, form: FormData) => Promise<ActionResult<ImportPreview>>;
  run: (prev: ActionResult<ImportResult> | null, form: FormData) => Promise<ActionResult<ImportResult>>;
};

const FIELD_LABELS: Record<ImportField, string> = {
  name: "Company name (required)",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact name",
  contactEmail: "Contact email",
};

const reason = (matchedOn: string[]) => (matchedOn.length === 2 ? "Same name and website" : matchedOn[0] === "website" ? "Same website" : "Same name");

type EntryState = "done" | "active" | "later";
const STATE_WORD: Record<EntryState, string> = { done: "Done", active: "Now", later: "Later" };

// One entry of the import ledger: the step number in the margin, a heading, and the body. A step
// that cannot start yet shows a single plain line instead of its controls.
function Entry({ n, state, title, later, children }: { n: number; state: EntryState; title: string; later?: string; children?: ReactNode }) {
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

const COLUMNS = ["Row", "Name", "Industry", "Website", "Contact", "Notes"] as const;

// The CSV import screen: pick a file, check the columns, review problems and look-alikes, import.
// Every step sends the file to the server, which parses and checks it again (lib/csv.ts); this
// component only shows what the server sends back and remembers the person's choices.
export function CsvImporter({ workspaceId, preview, run }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<ImportPreview | null>(null);
  // Rows the person chose to skip, starting from the suggested ones.
  const [skips, setSkips] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const send = (chosen: File, fields: Record<string, string>) => {
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("file", chosen);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };

  // Asks the server for a preview, with the guessed columns (mapping null) or the chosen ones.
  const review = (chosen: File, mapping: ImportMapping | null) =>
    startTransition(async () => {
      setError(null);
      const res = await preview(null, send(chosen, mapping ? { mapping: JSON.stringify(mapping) } : {}));
      if (!res.ok) return setError(res.error);
      setView(res.data);
      setSkips(new Set(res.data.defaultSkips));
    });

  const importNow = (chosen: File, shown: ImportPreview) =>
    startTransition(async () => {
      setError(null);
      const res = await run(
        null,
        send(chosen, { mapping: JSON.stringify(shown.mapping), skip: JSON.stringify([...skips]), seen: JSON.stringify(shown.seen) }),
      );
      if (!res.ok) return setError(res.error);
      setResult(res.data);
      setView(null);
      setFile(null);
    });

  const choose = (row: number, skip: boolean) =>
    setSkips((current) => {
      const next = new Set(current);
      if (skip) next.add(row);
      else next.delete(row);
      return next;
    });

  if (result) {
    return (
      <ol className="lg-entries" aria-label="Import steps">
        <Entry n={4} state="done" title="Done">
          <dl className="lg-tally" role="status">
            <div>
              <dt className="lg-tag">Imported</dt>
              <dd data-tone="ok">{result.imported}</dd>
            </div>
            <div>
              <dt className="lg-tag">Skipped</dt>
              <dd>{result.skipped}</dd>
            </div>
            <div>
              <dt className="lg-tag">Errors</dt>
              <dd data-tone={result.errored > 0 ? "bad" : undefined}>{result.errored}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/demo/w/${workspaceId}?never=1`} className="lg-btn lg-btn-primary">
              Go to the queue
            </Link>
            <Link href={`/demo/w/${workspaceId}/board`} className="lg-btn">
              See the board
            </Link>
            <button type="button" onClick={() => setResult(null)} className="lg-btn">
              Import another file
            </button>
          </div>
        </Entry>
      </ol>
    );
  }

  const label = (row: number) => view?.labels.find((l) => l.row === row);
  // The Problems column only appears when one of the shown rows has a problem; the list under the table names every bad row.
  const showProblems = view ? view.sample.some((r) => r.errors.length > 0) : false;
  const importing = view ? view.rowCount - view.errors.length - skips.size : 0;

  return (
    <ol className="lg-entries" aria-label="Import steps">
      <Entry n={1} state={view ? "done" : "active"} title="Choose a .csv file">
        <div className="lg-filerow">
          <input
            id={`${id}-file`}
            type="file"
            accept=".csv,text/csv"
            className="lg-file"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              setFile(chosen);
              setView(null);
              setResult(null);
              if (chosen) review(chosen, null);
            }}
          />
          <label htmlFor={`${id}-file`} className="lg-btn">
            {file ? "Choose another file" : "Choose a CSV file"}
          </label>
          <span className="lg-filename lg-muted" aria-live="polite">
            {pending && !view ? "Working..." : (file?.name ?? "No file chosen")}
          </span>
        </div>
        {!view && error && <ErrorLine>{error}</ErrorLine>}
      </Entry>

      <Entry n={2} state={view ? "done" : "later"} title="Check the columns" later="Appears once a file is chosen.">
        {file && view && (
          <>
            <p className="lg-hint mb-3">
              {view.rowCount} {view.rowCount === 1 ? "row" : "rows"} found. Guessed from your headers; change any that are wrong.
            </p>
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
                      onChange={(value) => {
                        if (!pending) review(file, { ...view.mapping, [field]: value === "" ? null : Number(value) });
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {pending && (
              <p className="lg-hint mt-2" role="status">
                Working...
              </p>
            )}
            {error && (
              <div className="mt-2">
                <ErrorLine>{error}</ErrorLine>
                <button type="button" onClick={() => review(file, view.mapping)} className="lg-btn lg-btn-sm mt-2">
                  Review again
                </button>
              </div>
            )}
          </>
        )}
      </Entry>

      <Entry n={3} state={view ? "active" : "later"} title="Review" later="The first rows, the problems and any look-alike companies show here.">
        {file && view && (
          <>
            <p className="lg-hint mb-2">The first {view.sample.length} rows, as they&apos;ll be imported:</p>
            <div className="lg-tablewrap">
              <table className="lg-table" role="table">
                <caption className="sr-only">The first {view.sample.length} rows, as they will be imported</caption>
                <thead>
                  <tr role="row">
                    {[...COLUMNS, ...(showProblems ? ["Problems"] : [])].map((h) => (
                      <th key={h} scope="col" role="columnheader" className="lg-sc">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.sample.map((r) => (
                    <tr key={r.row} role="row" data-bad={r.errors.length > 0 || undefined}>
                      <td role="cell" data-label="Row">
                        {r.row}
                      </td>
                      <td role="cell" data-label="Name" className="lg-c-name">
                        {r.company.name || <span className="lg-muted">(empty)</span>}
                      </td>
                      <td role="cell" data-label="Industry" className="lg-c-industry">
                        {r.company.industry}
                      </td>
                      <td role="cell" data-label="Website">
                        {r.company.website}
                      </td>
                      <td role="cell" data-label="Contact" className="lg-c-contact">
                        {r.contact && (
                          <div>
                            <span>{r.contact.name}</span>
                            {r.contact.email && (
                              <span className="lg-email" title={r.contact.email}>
                                {r.contact.email}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td role="cell" data-label="Notes" className="lg-cellnote">
                        {r.company.notes}
                      </td>
                      {showProblems && (
                        <td role="cell" data-label="Problems" className="lg-c-problems">
                          {r.errors.length > 0 && (
                            <span className="lg-late">
                              <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
                              {r.errors.join(" ")}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {view.errors.length > 0 && (
              <details open className="lg-problems">
                <summary>
                  {view.errors.length} {view.errors.length === 1 ? "row" : "rows"} won&apos;t be imported. {view.errors.length === 1 ? "Fix it" : "Fix them"} in the sheet and upload it again to
                  include {view.errors.length === 1 ? "it" : "them"}.
                </summary>
                <ul>
                  {view.errors.map((e) => (
                    <li key={e.row} className="lg-late">
                      <WarningIcon size={14} />
                      <span>
                        Row {e.row}: {e.messages.join(" ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {view.groups.length > 0 && (
              <div className="lg-groups">
                <h3 className="lg-h3">Possible duplicates</h3>
                <p className="lg-hint mb-3">Choose Import or Skip for each row. Importing a look-alike keeps both as separate companies.</p>
                {view.groups.map((group, gi) => (
                  <div key={group.rows[0]} className="lg-group" role="group" aria-labelledby={`${id}-g${gi}`}>
                    <div className="lg-group-head">
                      <h4 id={`${id}-g${gi}`} className="lg-group-q">
                        Same company?
                      </h4>
                      <span className="lg-tag lg-muted">{reason(group.matchedOn)}</span>
                    </div>
                    <div className="lg-group-cols">
                      {group.existing.map((company) => (
                        <div key={company.id} className="lg-dupcard lg-dupcard-have">
                          <p className="lg-tag lg-muted">Already in the workspace</p>
                          <p className="lg-dupname">
                            <Link href={`/demo/w/${workspaceId}/companies/${company.id}`} className="lg-link">
                              {company.name}
                            </Link>
                          </p>
                          <p className="lg-dupsite">
                            {company.website || "No website"}
                            {company.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                          </p>
                        </div>
                      ))}
                      {group.rows.map((row) => {
                        const entry = label(row);
                        const skipped = skips.has(row);
                        return (
                          <div key={row} className="lg-dupcard" data-skipped={skipped || undefined}>
                            <p className="lg-tag lg-muted">In your file, row {row}</p>
                            <p className="lg-dupname">
                              <span className="lg-nametext">
                                Row {row}: {entry?.name}
                              </span>
                            </p>
                            <p className="lg-dupsite">{entry?.website ? `(${entry.website})` : "No website"}</p>
                            <ChipGroup
                              legend={`Row ${row}`}
                              hideLegend
                              value={skipped ? "skip" : "import"}
                              onChange={(value) => choose(row, value === "skip")}
                              options={[
                                { value: "import", label: "Import", ariaLabel: `Import row ${row}` },
                                { value: "skip", label: "Skip", ariaLabel: `Skip row ${row}` },
                              ]}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Entry>

      <Entry n={4} state={view ? "active" : "later"} title="Import">
        {file && view ? (
          <>
            <p>
              {importing} {importing === 1 ? "company" : "companies"} will be added as Not contacted. Nothing is imported until you press the button.
            </p>
            <div className="mt-3">
              <button type="button" disabled={pending || importing === 0} onClick={() => importNow(file, view)} className="lg-btn lg-btn-primary">
                {pending ? "Working..." : `Import ${importing} ${importing === 1 ? "company" : "companies"}`}
              </button>
            </div>
            {!pending && error && <ErrorLine>{error}</ErrorLine>}
          </>
        ) : (
          <p className="lg-hint">Nothing is imported until you press the button here.</p>
        )}
      </Entry>
    </ol>
  );
}
