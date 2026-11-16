"use client";

import { useId } from "react";
import { Disclosure } from "@/components/ledger/disclosure";
import { WarningIcon } from "@/components/ledger/icons";
import type { CheckedRow } from "@/lib/csv";

// Step 3 of the importer (components/importer/importer.tsx): the first rows of the file, with their
// problems, folded unless there is a reason to look (a file read as Windows text).

const COLUMNS = ["Row", "Name", "Industry", "Website", "Contact", "Notes"] as const;

export function SampleRows({ sample, defaultOpen = false }: { sample: CheckedRow[]; defaultOpen?: boolean }) {
  const titleId = useId();
  // The Problems column only appears when one of the shown rows has a problem.
  const showProblems = sample.some((r) => r.errors.length > 0);
  return (
    <Disclosure variant="inline" className="lg-impnote" defaultOpen={defaultOpen} summary={<span id={titleId}>First {sample.length} rows of the file</span>}>
      <div className="lg-tablewrap mt-2">
        <table className="lg-table" role="table" aria-labelledby={titleId}>
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
    </Disclosure>
  );
}
