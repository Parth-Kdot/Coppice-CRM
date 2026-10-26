"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ImportPreview, ImportResult } from "@/lib/csv";
import { IMPORT_FIELDS, type ActionResult, type ImportField, type ImportMapping } from "@/lib/validation";

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
      <section className="flex flex-col gap-3">
        <p role="status" className="text-lg">
          Imported {result.imported} · Skipped {result.skipped} · Errors {result.errored}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/${workspaceId}?never=1`} className="rounded border px-3 py-1">
            Go to the queue
          </Link>
          <Link href={`/${workspaceId}/board`} className="rounded border px-3 py-1">
            See the board
          </Link>
          <button type="button" onClick={() => setResult(null)} className="rounded border px-3 py-1">
            Import another file
          </button>
        </div>
      </section>
    );
  }

  const label = (row: number) => view?.labels.find((l) => l.row === row);
  const importing = view ? view.rowCount - view.errors.length - skips.size : 0;

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">1. Choose a .csv file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            setView(null);
            if (chosen) review(chosen, null);
          }}
        />
      </label>

      {pending && <p className="text-sm text-zinc-500">Working...</p>}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-red-600">
          <span>{error}</span>
          {file && view && (
            <button type="button" onClick={() => review(file, view.mapping)} className="rounded border px-2 py-0.5 text-sm">
              Review again
            </button>
          )}
        </div>
      )}

      {file && view && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">2. Check the columns</h2>
            <p className="text-sm text-zinc-500">
              {view.rowCount} rows found. Guessed from your headers; change any that are wrong.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span>{FIELD_LABELS[field]}</span>
                  <select
                    value={view.mapping[field] ?? ""}
                    disabled={pending}
                    onChange={(e) => review(file, { ...view.mapping, [field]: e.target.value === "" ? null : Number(e.target.value) })}
                    className="rounded border px-2 py-1"
                  >
                    {field !== "name" && <option value="">Not in this file</option>}
                    {view.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">3. Review</h2>
            <p className="text-sm text-zinc-500">The first {view.sample.length} rows, as they&apos;ll be imported:</p>
            <div className="overflow-x-auto">
              <table className="text-left text-sm">
                <thead>
                  <tr>
                    {["Row", "Name", "Industry", "Website", "Contact", "Notes", "Problems"].map((h) => (
                      <th key={h} className="border-b px-2 py-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.sample.map((r) => (
                    <tr key={r.row} className={r.errors.length ? "text-red-600" : ""}>
                      <td className="px-2 py-1">{r.row}</td>
                      <td className="px-2 py-1">{r.company.name}</td>
                      <td className="px-2 py-1">{r.company.industry}</td>
                      <td className="px-2 py-1">{r.company.website}</td>
                      <td className="px-2 py-1">{r.contact && [r.contact.name, r.contact.email].filter(Boolean).join(", ")}</td>
                      <td className="max-w-48 truncate px-2 py-1">{r.company.notes}</td>
                      <td className="px-2 py-1">{r.errors.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {view.errors.length > 0 && (
              <details open className="text-sm">
                <summary className="cursor-pointer">
                  {view.errors.length} {view.errors.length === 1 ? "row" : "rows"} won&apos;t be imported. Fix them in the sheet and upload it again
                  to include them.
                </summary>
                <ul className="flex flex-col gap-1 pt-2 text-red-600">
                  {view.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.messages.join(" ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {view.groups.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">Possible duplicates</h3>
                <p className="text-sm text-zinc-500">Choose Import or Skip for each row. Importing a look-alike keeps both as separate companies.</p>
                {view.groups.map((group) => (
                  <div key={group.rows[0]} className="flex flex-col gap-2 rounded border border-amber-500 p-3 text-sm">
                    <span className="text-zinc-500">Same {group.matchedOn.join(" and ")}</span>
                    {group.existing.map((company) => (
                      <span key={company.id}>
                        Already in the workspace:{" "}
                        <Link href={`/${workspaceId}/companies/${company.id}`} className="underline">
                          {company.name}
                        </Link>
                        {company.website && ` (${company.website})`}
                        {company.archived && <span className="ml-1 rounded bg-zinc-200 px-1 text-zinc-900">archived</span>}
                      </span>
                    ))}
                    {group.rows.map((row) => (
                      <fieldset key={row} className="flex flex-wrap items-center gap-3">
                        <legend className="sr-only">Row {row}</legend>
                        <span>
                          Row {row}: {label(row)?.name}
                          {label(row)?.website && ` (${label(row)?.website})`}
                        </span>
                        <label className="flex items-center gap-1">
                          <input type="radio" name={`row-${row}`} checked={!skips.has(row)} onChange={() => choose(row, false)} />
                          Import
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="radio" name={`row-${row}`} checked={skips.has(row)} onChange={() => choose(row, true)} />
                          Skip
                        </label>
                      </fieldset>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">4. Import</h2>
            <p className="text-sm text-zinc-500">
              {importing} {importing === 1 ? "company" : "companies"} will be added as Not contacted. Nothing is imported until you press the button.
            </p>
            <button
              type="button"
              disabled={pending || importing === 0}
              onClick={() => importNow(file, view)}
              className="self-start rounded border px-3 py-1 disabled:opacity-50"
            >
              Import {importing} {importing === 1 ? "company" : "companies"}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
