"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ImportResult } from "@/lib/csv";

// The importer's last step once the file is in (components/csv-importer.tsx): the tallies, the
// names behind them, and where to go next. The tally takes focus, so it is read out and the
// keyboard starts from there.

export type Named = { row: number; name: string };
export type Done = { data: ImportResult; imported: Named[]; skipped: Named[] };

// The names behind a tally: a long list starts folded. A name that appears more than once in the
// file, in either list, gets its row number, so "Brightwater Media" imported and "Brightwater
// Media" skipped don't read as a contradiction.
function NameList({ title, names, repeated }: { title: string; names: Named[]; repeated: ReadonlySet<string> }) {
  if (names.length === 0) return null;
  return (
    <details className="lg-resultnames" open={names.length <= 12}>
      <summary>
        {title} ({names.length})
      </summary>
      <ul>
        {names.map((n) => (
          <li key={n.row}>{repeated.has(n.name.trim().toLowerCase()) ? `${n.name} (row ${n.row})` : n.name}</li>
        ))}
      </ul>
    </details>
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

  return (
    <>
      <dl className="lg-tally" role="status" tabIndex={-1} ref={tallyRef}>
        <div>
          <dt className="lg-tag">Imported</dt>
          <dd data-tone="ok">{result.data.imported}</dd>
        </div>
        <div>
          <dt className="lg-tag">Skipped</dt>
          <dd>{result.data.skipped}</dd>
        </div>
        <div>
          <dt className="lg-tag">Errors</dt>
          <dd data-tone={result.data.errored > 0 ? "bad" : undefined}>{result.data.errored}</dd>
        </div>
      </dl>
      <div className="lg-resultlists">
        <NameList title="Imported" names={result.imported} repeated={repeated} />
        <NameList title="Skipped" names={result.skipped} repeated={repeated} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/${workspaceId}?never=1`} className="lg-btn lg-btn-primary">
          Go to the queue
        </Link>
        <Link href={`/${workspaceId}/board`} className="lg-btn">
          See the board
        </Link>
        <button type="button" onClick={again} className="lg-btn">
          Import another file
        </button>
      </div>
    </>
  );
}
