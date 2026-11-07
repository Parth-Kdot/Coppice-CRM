"use client";

import { useState } from "react";
import { WarningIcon } from "@/components/ledger/icons";
import type { CheckedRow } from "@/lib/csv";

// Step 3 of the importer (components/csv-importer.tsx): the first rows of the file, as they'll be
// imported, with their problems.

const COLUMNS = ["Row", "Name", "Industry", "Website", "Contact", "Notes"] as const;

// The first rows of the file. On a phone the table is a tall stack of cards, so it starts folded.
export function SampleRows({ sample }: { sample: CheckedRow[] }) {
  const [open, setOpen] = useState(() => !window.matchMedia("(max-width: 640px)").matches);
  // The Problems column only appears when one of the shown rows has a problem; the list under the table names every bad row.
  const showProblems = sample.some((r) => r.errors.length > 0);
  return (
    <details className="lg-sample" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{open ? `The first ${sample.length} rows, as they'll be imported` : `Show the first ${sample.length} rows`}</summary>
      <div className="lg-tablewrap mt-2">
        <table className="lg-table" role="table">
          <caption className="sr-only">The first {sample.length} rows, as they will be imported</caption>
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
            {sample.map((r) => (
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
    </details>
  );
}
