"use client";

import Link from "next/link";
import { useId, useRef, type ReactNode } from "react";
import type { ImportPreview } from "@/demo/csv";
import { demoRoutes } from "@/demo/routes";
import { useCsvImport } from "@/demo/use-csv-import";
import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, type ImportField } from "@/demo/validation";
import { WarningIcon } from "../icons";
import { Tick } from "../marks";
import { ChipGroup } from "./chips";
import { LedgerMenu } from "./ledger-menu";
import { ErrorLine, PageHead } from "./shared";

// Import: the steps are ruled ledger entries with their number in the margin. Choose a file, check
// the columns, review the problems and the "Same company?" groups, then import. A duplicate group is
// laid out side by side: what is already in the workspace next to each row in the file, with Import
// or Skip on every row.

const REASON = (reasons: string[]) => (reasons.length === 2 ? "Same name and website" : reasons[0] === "website" ? "Same website" : "Same name");

type EntryState = "done" | "active" | "later";
const STATE_WORD: Record<EntryState, string> = { done: "Done", active: "Now", later: "Later" };

// One entry of the import ledger: the step number in the margin, a heading, and the body. A step
// that cannot start yet shows a single plain line instead of its controls.
function Entry({ n, state, title, headingId, later, children }: { n: number; state: EntryState; title: string; headingId: string; later?: string; children?: ReactNode }) {
  return (
    <li className="lg-entry" data-state={state} aria-current={state === "active" ? "step" : undefined}>
      <div className="lg-entry-margin" aria-hidden="true">
        <span className="lg-entry-no lg-num">{state === "done" ? <Tick size={18} /> : n}</span>
        <span className="lg-entry-state lg-sc">{STATE_WORD[state]}</span>
      </div>
      <div className="lg-entry-body">
        <h2 id={headingId} className="lg-entry-h">
          <span className="lg-sr">Step {n}: </span>
          {title}
        </h2>
        {state === "later" && later ? <p className="lg-hint">{later}</p> : children}
      </div>
    </li>
  );
}

function ReviewTable({ preview }: { preview: ImportPreview }) {
  return (
    <div className="lg-tablewrap">
      <table className="lg-table">
        <caption className="lg-sr">The first 10 rows, as they will be imported</caption>
        <thead>
          <tr>
            {["Row", "Name", "Industry", "Website", "Contact", "Notes", "Problems"].map((h) => (
              <th key={h} scope="col" className="lg-sc">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.sample.map((r) => (
            <tr key={r.row} data-bad={r.errors.length > 0 || undefined}>
              <td className="lg-num">{r.row}</td>
              <td>{r.company.name || <span className="lg-muted">(empty)</span>}</td>
              <td>{r.company.industry}</td>
              <td>{r.company.website}</td>
              <td>{r.contact ? `${r.contact.name}${r.contact.email ? `, ${r.contact.email}` : ""}` : ""}</td>
              <td className="lg-cellnote">{r.company.notes}</td>
              <td>
                {r.errors.length > 0 && (
                  <span className="lg-late">
                    <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
                    {r.errors.join(" ")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportScreen({ ws }: { ws: string }) {
  const flow = useCsvImport(ws);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { preview, result } = flow;
  const hasProblems = (preview?.errors.length ?? 0) > 0;

  return (
    <div className="lg-import">
      <PageHead title="Import companies">
        <Link href={demoRoutes.queue(ws)} className="lg-btn">
          Back
        </Link>
      </PageHead>
      <p className="lg-hint max-w-[64ch]">
        Upload a .csv file with a header row: up to 2,000 rows and 3 MB. In Google Sheets: File, Download, Comma-separated values. Companies are added as Not contacted, with at most one contact each.
      </p>

      <ol className="lg-entries lg-sheet" aria-label="Import steps">
        {result ? (
          <Entry n={4} state="done" title="Done" headingId={`${id}-done`}>
            <p className="lg-importresult" role="status">
              <span>
                Imported {result.imported}, skipped {result.skipped}, errors {result.errored}.
              </span>
            </p>
            <div className="lg-actions mt-4">
              <Link href={demoRoutes.queue(ws, { never: true })} className="lg-btn lg-btn-primary">
                Go to the queue
              </Link>
              <Link href={demoRoutes.board(ws)} className="lg-btn">
                See the board
              </Link>
              <button type="button" className="lg-btn" onClick={flow.startOver}>
                Import another file
              </button>
            </div>
          </Entry>
        ) : (
          <>
            <Entry n={1} state={preview ? "done" : "active"} title="Choose a .csv file" headingId={`${id}-1`}>
              <div className="lg-actions">
                <input
                  ref={input}
                  type="file"
                  accept=".csv,text/csv"
                  className="lg-file"
                  aria-label="Choose a .csv file"
                  onChange={(e) => flow.chooseFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className="lg-btn" onClick={flow.loadSample}>
                  Use the sample file
                </button>
                {flow.pending && <span className="lg-muted">Working...</span>}
              </div>
              {flow.fileName && !flow.pending && <p className="lg-hint mt-2">Reading {flow.fileName}.</p>}
              {!preview && <ErrorLine>{flow.error}</ErrorLine>}
            </Entry>

            <Entry n={2} state={preview ? "done" : "later"} title="Check the columns" headingId={`${id}-2`} later="Appears once a file is chosen.">
              {preview && (
                <>
                  <p className="lg-hint mb-3">{preview.rowCount} rows found. Guessed from your headers; change any that are wrong.</p>
                  <div className="lg-mapgrid">
                    {IMPORT_FIELDS.map((field: ImportField) => {
                      const none = field === "name" ? [] : [{ value: "", label: "Not in this file" }];
                      const columns = preview.headers.map((h, i) => ({ value: String(i), label: h.trim() || `Column ${i + 1}` }));
                      return (
                        <div key={field}>
                          <p className="lg-label" aria-hidden="true">
                            {IMPORT_FIELD_LABELS[field]}
                          </p>
                          <LedgerMenu
                            block
                            hideLabel
                            label={IMPORT_FIELD_LABELS[field]}
                            value={preview.mapping[field] === null || preview.mapping[field] === undefined ? "" : String(preview.mapping[field])}
                            options={[...none, ...columns]}
                            onChange={(v) => flow.setColumn(field, v === "" ? null : Number(v))}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {flow.error && (
                    <div className="mt-2">
                      <ErrorLine>{flow.error}</ErrorLine>
                      <button type="button" className="lg-btn lg-btn-sm mt-2" onClick={flow.reviewAgain}>
                        Review again
                      </button>
                    </div>
                  )}
                </>
              )}
            </Entry>

            <Entry n={3} state={preview ? "active" : "later"} title="Review" headingId={`${id}-3`} later="The first rows, the problems and any look-alike companies show here.">
              {preview && (
                <>
                  <p className="lg-hint mb-2">The first 10 rows, as they&apos;ll be imported:</p>
                  <ReviewTable preview={preview} />

                  {hasProblems && (
                    <details className="lg-problems" open>
                      <summary>
                        {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} won&apos;t be imported. Fix them in the sheet and upload it again to include them.
                      </summary>
                      <ul>
                        {preview.errors.map((e) => (
                          <li key={e.row} className="lg-late">
                            <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
                            Row {e.row}: {e.messages.join(" ")}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {preview.groups.length > 0 && (
                    <div className="lg-groups">
                      <h3 className="lg-h3">Possible duplicates</h3>
                      <p className="lg-hint mb-3">Choose Import or Skip for each row. Importing a look-alike keeps both as separate companies.</p>
                      {preview.groups.map((g, gi) => (
                        <div key={gi} className="lg-group" role="group" aria-labelledby={`${id}-g${gi}`}>
                          <div className="lg-group-head">
                            <WarningIcon size={18} />
                            <h4 id={`${id}-g${gi}`} className="lg-group-q">
                              Same company?
                            </h4>
                            <span className="lg-sc lg-muted">{REASON(g.matchedOn)}</span>
                          </div>
                          <div className="lg-group-cols">
                            {g.existing.map((x) => (
                              <div key={x.id} className="lg-dupcard lg-dupcard-have">
                                <p className="lg-sc lg-muted">Already in the workspace</p>
                                <p className="lg-dupname">
                                  <Link href={demoRoutes.company(ws, x.id)} className="lg-link">
                                    {x.name}
                                  </Link>
                                </p>
                                <p className="lg-dupsite">
                                  {x.website || "No website"}
                                  {x.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                                </p>
                              </div>
                            ))}
                            {g.rows.map((row) => {
                              const label = preview.labels.find((l) => l.row === row);
                              const skipped = flow.skips.has(row);
                              return (
                                <div key={row} className="lg-dupcard" data-skipped={skipped || undefined}>
                                  <p className="lg-sc lg-muted">In your file, row {row}</p>
                                  <p className="lg-dupname">
                                    <span className="lg-nametext">Row {row}: {label?.name}</span>
                                  </p>
                                  <p className="lg-dupsite">{label?.website ? `(${label.website})` : "No website"}</p>
                                  <ChipGroup
                                    legend={`Row ${row}`}
                                    hideLegend
                                    value={skipped ? "skip" : "import"}
                                    onChange={(v) => flow.setSkip(row, v === "skip")}
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

            <Entry n={4} state="later" title="Import" headingId={`${id}-4`}>
              {preview ? (
                <>
                  <p>
                    {flow.importing} {flow.importing === 1 ? "company" : "companies"} will be added as Not contacted. Nothing is imported until you press the button.
                  </p>
                  <div className="mt-3">
                    <button type="button" className="lg-btn lg-btn-primary" disabled={flow.importing <= 0} onClick={flow.runImport}>
                      Import {flow.importing} {flow.importing === 1 ? "company" : "companies"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="lg-hint">Nothing is imported until you press the button here.</p>
              )}
            </Entry>
          </>
        )}
      </ol>
    </div>
  );
}
