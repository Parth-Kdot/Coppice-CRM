"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { decodeCsvBytes } from "@/app/(app)/[workspaceId]/import/read-file";
import { Disclosure } from "@/components/ledger/disclosure";
import { ShowMore } from "@/components/ledger/show-more";
import { ErrorLine } from "@/components/ledger/shared";
import type { ImportResult } from "@/lib/csv";

// The importer's result (components/csv-importer.tsx): three tallies, the names behind them
// (folded), the rows that couldn't be imported with why and a download of just those rows, and
// where to go next. The tally takes focus, so it is read out and the keyboard starts from there.

export type Named = { row: number; name: string };
export type Failed = Named & { reason: string };
export type Done = { data: ImportResult; imported: Named[]; skipped: Named[]; failed: Failed[]; file: File };

const shownName = (n: Named, repeated: ReadonlySet<string>) => (repeated.has(n.name.trim().toLowerCase()) ? `${n.name} (row ${n.row})` : n.name || `Row ${n.row}`);

// The names behind a tally. A name that appears more than once in the file gets its row number, so
// "Brightwater Media" imported and "Brightwater Media" skipped don't read as a contradiction.
function NameList({ title, names, repeated }: { title: string; names: Named[]; repeated: ReadonlySet<string> }) {
  if (names.length === 0) return null;
  return (
    <Disclosure variant="inline" summary={title} count={names.length}>
      <ShowMore initial={20} label="names" as="ul" listClassName="lg-resultlist">
        {names.map((n) => (
          <li key={n.row} className="lg-wrap-any">
            {shownName(n, repeated)}
          </li>
        ))}
      </ShowMore>
    </Disclosure>
  );
}

// Just the rows that couldn't be imported, as a CSV with the file's own header, to fix and import
// again. Built in the browser from the file still held here; nothing is sent anywhere.
async function failedRowsCsv(file: File, rows: number[]): Promise<string> {
  const { default: Papa } = await import("papaparse");
  const { text } = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  const [header = [], ...records] = parsed.data;
  const wanted = new Set(rows);
  // Row numbers count the header as row 1, like the sheet (lib/csv.ts parseCsv).
  const picked = records.filter((_, i) => wanted.has(i + 2));
  return `﻿${Papa.unparse([header, ...picked])}`;
}

function FailedList({ failed, file }: { failed: Failed[]; file: File }) {
  const [error, setError] = useState<string | null>(null);
  if (failed.length === 0) return null;
  const download = async () => {
    setError(null);
    try {
      const csv = await failedRowsCsv(file, failed.map((f) => f.row));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name.replace(/\.csv$/i, "")}-to-fix.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Couldn't build the file. Fix the rows listed here in the sheet instead.");
    }
  };
  return (
    <Disclosure variant="inline" summary="Couldn't import" count={failed.length}>
      <ShowMore initial={20} label="rows" as="ul" listClassName="lg-resultlist lg-resultfail">
        {failed.map((f) => (
          <li key={f.row} className="lg-wrap-any">
            Row {f.row}
            {f.name ? ` (${f.name})` : ""}: {f.reason}
          </li>
        ))}
      </ShowMore>
      <p className="mt-2">
        <button type="button" className="lg-linkbtn" onClick={download}>
          Download these rows as CSV
        </button>
      </p>
      <ErrorLine>{error}</ErrorLine>
    </Disclosure>
  );
}

export function ImportDone({ workspaceId, result, again }: { workspaceId: string; result: Done; again: () => void }) {
  const tallyRef = useRef<HTMLDListElement>(null);
  useEffect(() => {
    tallyRef.current?.focus({ preventScroll: true });
  }, [result]);

  const count = new Map<string, number>();
  for (const n of [...result.imported, ...result.skipped]) {
    const key = n.name.trim().toLowerCase();
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const repeated = new Set([...count].filter(([, n]) => n > 1).map(([key]) => key));
  const n = (v: number) => v.toLocaleString("en-US");

  return (
    <div className="lg-importdone">
      <dl className="lg-tally" role="status" tabIndex={-1} ref={tallyRef}>
        <div>
          <dt className="lg-tag">Imported</dt>
          <dd data-tone="ok">{n(result.data.imported)}</dd>
        </div>
        <div>
          <dt className="lg-tag">Skipped</dt>
          <dd>{n(result.data.skipped)}</dd>
        </div>
        <div>
          <dt className="lg-tag">Couldn&apos;t import</dt>
          <dd data-tone={result.data.errored > 0 ? "bad" : undefined}>{n(result.data.errored)}</dd>
        </div>
      </dl>
      <div className="lg-resultlists">
        <NameList title="Imported" names={result.imported} repeated={repeated} />
        <NameList title="Skipped" names={result.skipped} repeated={repeated} />
        <FailedList failed={result.failed} file={result.file} />
      </div>
      <div className="lg-resultnext">
        <Link href={`/${workspaceId}`} className="lg-btn lg-btn-primary">
          Go to the queue
        </Link>
        <Link href={`/${workspaceId}/board`} className="lg-link">
          See the board
        </Link>
        <button type="button" onClick={again} className="lg-linkbtn">
          Import another file
        </button>
      </div>
    </div>
  );
}
