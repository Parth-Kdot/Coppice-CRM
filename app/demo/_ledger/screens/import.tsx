"use client";

import Link from "next/link";
import { useId, useRef } from "react";
import type { ImportPreview } from "@/demo/csv";
import { demoRoutes } from "@/demo/routes";
import { useCsvImport } from "@/demo/use-csv-import";
import { IMPORT_FIELDS, IMPORT_FIELD_LABELS, type ImportField } from "@/demo/validation";
import { PaperclipIcon, WarningIcon } from "../icons";
import { Tick } from "../marks";
import { ErrorLine, PageHead } from "./shared";

// Import: the steps are ledger pages. Upload, map the columns, review the duplicates and problems,
// then import. Duplicate groups are slips paper-clipped together, with Import or Skip for each row.

const REASON = (reasons: string[]) => (reasons.length === 2 ? "Same name and website" : reasons[0] === "website" ? "Same website" : "Same name");

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Upload", "Map columns", "Review duplicates", "Done"];
  return (
    <ol className="lg-stepper" aria-label="Import steps">
      {steps.map((s, i) => (
        <li key={s} className="lg-step-tab" aria-current={i + 1 === step ? "step" : undefined} data-done={i + 1 < step || undefined}>
          <span className="lg-num">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
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
  const step: 1 | 2 | 3 | 4 = result ? 4 : preview ? 3 : 1;

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
      <Stepper step={step} />

      {result ? (
        <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-done`}>
          <h2 id={`${id}-done`} className="lg-bh">
            Done
          </h2>
          <p className="lg-importresult" role="status">
            <Tick size={22} />
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
        </section>
      ) : (
        <>
          <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-1`}>
            <h2 id={`${id}-1`} className="lg-bh">
              <span className="lg-pageno">1</span> Choose a .csv file
            </h2>
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
          </section>

          {preview && (
            <>
              <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-2`}>
                <h2 id={`${id}-2`} className="lg-bh">
                  <span className="lg-pageno">2</span> Check the columns
                </h2>
                <p className="lg-hint mb-3">{preview.rowCount} rows found. Guessed from your headers; change any that are wrong.</p>
                <div className="lg-mapgrid">
                  {IMPORT_FIELDS.map((field: ImportField) => (
                    <div key={field}>
                      <label className="lg-label" htmlFor={`${id}-map-${field}`}>
                        {IMPORT_FIELD_LABELS[field]}
                      </label>
                      <select
                        id={`${id}-map-${field}`}
                        className="lg-select"
                        value={preview.mapping[field] ?? ""}
                        onChange={(e) => flow.setColumn(field, e.target.value === "" ? null : Number(e.target.value))}
                      >
                        {field !== "name" && <option value="">Not in this file</option>}
                        {preview.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {flow.error && (
                  <div className="mt-2">
                    <ErrorLine>{flow.error}</ErrorLine>
                    <button type="button" className="lg-btn lg-btn-sm mt-2" onClick={flow.reviewAgain}>
                      Review again
                    </button>
                  </div>
                )}
              </section>

              <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-3`}>
                <h2 id={`${id}-3`} className="lg-bh">
                  <span className="lg-pageno">3</span> Review
                </h2>
                <p className="lg-hint mb-2">The first 10 rows, as they&apos;ll be imported:</p>
                <ReviewTable preview={preview} />

                {preview.errors.length > 0 && (
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
                      <div key={gi} className="lg-group lg-warn-box">
                        <PaperclipIcon size={22} className="lg-group-clip" />
                        <p className="lg-sc font-semibold">{REASON(g.matchedOn)}</p>
                        {g.existing.length > 0 && (
                          <ul className="lg-existing">
                            {g.existing.map((x) => (
                              <li key={x.id}>
                                Already in the workspace:{" "}
                                <Link href={demoRoutes.company(ws, x.id)} className="lg-link">
                                  {x.name}
                                </Link>{" "}
                                {x.website ? `(${x.website})` : ""}
                                {x.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="lg-rowslips">
                          {g.rows.map((row) => {
                            const label = preview.labels.find((l) => l.row === row);
                            const skipped = flow.skips.has(row);
                            return (
                              <fieldset key={row} className="lg-slip lg-rowslip">
                                <legend className="lg-sc">Row {row}</legend>
                                <p className="font-semibold">
                                  Row {row}: {label?.name}
                                  {label?.website ? <span className="lg-muted font-normal"> ({label.website})</span> : null}
                                </p>
                                <div className="lg-radios">
                                  <label className="lg-radio">
                                    <input type="radio" className="lg-check" name={`${id}-row-${row}`} checked={!skipped} onChange={() => flow.setSkip(row, false)} aria-label={`Import row ${row}`} />
                                    Import
                                  </label>
                                  <label className="lg-radio">
                                    <input type="radio" className="lg-check" name={`${id}-row-${row}`} checked={skipped} onChange={() => flow.setSkip(row, true)} aria-label={`Skip row ${row}`} />
                                    Skip
                                  </label>
                                </div>
                              </fieldset>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="lg-leaf-page lg-sheet lg-ipage" aria-labelledby={`${id}-4`}>
                <h2 id={`${id}-4`} className="lg-bh">
                  <span className="lg-pageno">4</span> Import
                </h2>
                <p>
                  {flow.importing} {flow.importing === 1 ? "company" : "companies"} will be added as Not contacted. Nothing is imported until you press the button.
                </p>
                <div className="mt-3">
                  <button type="button" className="lg-btn lg-btn-primary" disabled={flow.importing <= 0} onClick={flow.runImport}>
                    Import {flow.importing} {flow.importing === 1 ? "company" : "companies"}
                  </button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
