"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import "@/components/ledger/zod-jitless";
import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { Tick } from "@/components/ledger/marks";
import { reducedMotion } from "@/components/ledger/motion";
import { ErrorLine } from "@/components/ledger/shared";
import { DuplicateGroups, groupDomId } from "@/components/csv-importer-duplicates";
import { ImportSummary } from "@/components/csv-importer-summary";
import { SmartColumns } from "@/components/csv-importer-smart/columns";
import { SmartReview } from "@/components/csv-importer-smart/review";
import { readingMatches, useSmartImport, type SmartActions } from "@/components/csv-importer-smart/use-smart-import";
import type { CheckedRow, ImportPreview, ImportResult } from "@/lib/csv";
import { CONTAINED_WHY, mergeGroups, unconfirmedNote, type ReviewSource } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";
import { IMPORT_FIELDS, type ActionResult, type ImportField, type ImportMapping } from "@/lib/validation";
import "@/components/ledger/company.css";
import "@/components/ledger/pages.css";

type Props = {
  workspaceId: string;
  preview: (prev: ActionResult<ImportPreview> | null, form: FormData) => Promise<ActionResult<ImportPreview>>;
  run: (prev: ActionResult<ImportResult> | null, form: FormData) => Promise<ActionResult<ImportResult>>;
  // Smart import (AI feature 3), offered only while AI is on for the workspace.
  smart?: SmartActions;
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

// One step at a time is Now. A step that is finished but can still be changed (the columns) is
// Set, not Done; the import is Next while groups are waiting for a look.
type EntryState = "done" | "set" | "active" | "next" | "later";
const STATE_WORD: Record<EntryState, string> = { done: "Done", set: "Set", active: "Now", next: "Next", later: "Later" };

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

// The first rows of the file. On a phone the table is a tall stack of cards, so it starts folded.
function SampleRows({ sample }: { sample: CheckedRow[] }) {
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

// The names behind the result's tallies: a long list starts folded. A name that appears twice
// gets its row number.
type Named = { row: number; name: string };
function NameList({ title, names }: { title: string; names: Named[] }) {
  if (names.length === 0) return null;
  const count = new Map<string, number>();
  for (const n of names) count.set(n.name, (count.get(n.name) ?? 0) + 1);
  return (
    <details className="lg-resultnames" open={names.length <= 12}>
      <summary>
        {title} ({names.length})
      </summary>
      <ul>
        {names.map((n) => (
          <li key={n.row}>{(count.get(n.name) ?? 0) > 1 ? `${n.name} (row ${n.row})` : n.name}</li>
        ))}
      </ul>
    </details>
  );
}

type Done = { data: ImportResult; imported: Named[]; skipped: Named[] };

// The CSV import screen: pick a file, check the columns, review problems and look-alikes, import.
// Every step sends the file to the server, which parses and checks it again (lib/csv.ts); this
// component only shows what the server sends back and remembers the person's choices.
export function CsvImporter({ workspaceId, preview, run, smart }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<ImportPreview | null>(null);
  // Rows the person chose to skip, starting from the suggested ones.
  const [skips, setSkips] = useState<Set<number>>(new Set());
  // Duplicate groups the person confirmed. Only for the screen: the server gets the skips.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Done | null>(null);
  // A preview's problem shows by the columns; an import's by the Import button.
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
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
  // Every choice goes back to the suggested one, so confirmed groups start over too.
  const review = (chosen: File, mapping: ImportMapping | null) =>
    startTransition(async () => {
      setPreviewError(null);
      setImportError(null);
      const res = await preview(null, send(chosen, mapping ? { mapping: JSON.stringify(mapping) } : {}));
      if (!res.ok) return setPreviewError(res.error);
      setView(res.data);
      setSkips(new Set([...res.data.defaultSkips, ...smartState.heldRows(res.data.mapping)]));
      setConfirmed(new Set());
    });

  const choose = (row: number, skip: boolean) =>
    setSkips((current) => {
      const next = new Set(current);
      if (skip) next.add(row);
      else next.delete(row);
      return next;
    });

  const smartState = useSmartImport({
    actions: smart,
    send: (fields) => (file ? send(file, fields) : null),
    applyMapping: (mapping) => {
      if (file) review(file, mapping);
    },
    skips,
    choose,
    release: (rows) => {
      const suggested = new Set(view?.defaultSkips ?? []);
      for (const row of rows) choose(row, suggested.has(row));
    },
  });
  // Smart import is used for the import only if its reading matches the columns shown now.
  const smartReady = Boolean(smart && view && readingMatches(smartState, view.mapping));

  // The duplicate review: exact groups, names inside names, and Smart import's look-alikes, joined
  // so that each row is decided in one group only.
  const label = (row: number) => view?.labels.find((l) => l.row === row);
  const sources: ReviewSource[] = view
    ? [
        ...view.groups.map((g) => ({
          reason: reason(g.matchedOn),
          existing: g.existing,
          rows: g.rows.map((row) => ({ row, name: label(row)?.name ?? "", website: label(row)?.website ?? null })),
        })),
        ...view.contained.map((g) => ({ reason: g.why, existing: g.existing, rows: g.rows })),
        ...(smartReady ? smartState.session!.lookalikes : []).map((g) => ({ reason: g.reason === "contained" ? CONTAINED_WHY : g.why, existing: g.existing, rows: g.rows })),
      ]
    : [];
  const groups = mergeGroups(sources);
  const doNotContact = new Map<number, Quote>(
    smartReady
      ? [...smartState.session!.doNotContact.map((d) => [d.row, d] as const), ...smartState.proposals.flatMap((p) => (p.doNotContact ? [[p.row, p.doNotContact] as const] : []))]
      : [],
  );
  const suggested = new Set([...(view?.defaultSkips ?? []), ...doNotContact.keys()]);
  const open = groups.filter((g) => !confirmed.has(g.key));
  const unconfirmed = unconfirmedNote(groups, confirmed, skips, suggested);
  const importing = view ? view.rowCount - view.errors.length - skips.size : 0;

  // Scrolls to a group and gives its heading focus, bringing it back from Decided if needed (then
  // it scrolls once the group is on the page again).
  const pendingJump = useRef<string | null>(null);
  const scrollToGroup = (key: string) => {
    const el = document.getElementById(groupDomId(id, key));
    if (!el) return false;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    document.getElementById(`${groupDomId(id, key)}-h`)?.focus({ preventScroll: true });
    return true;
  };
  const jumpTo = (key: string) => {
    if (!confirmed.has(key)) {
      scrollToGroup(key);
      return;
    }
    pendingJump.current = key;
    setConfirmed((current) => new Set([...current].filter((k) => k !== key)));
  };
  useEffect(() => {
    if (pendingJump.current && scrollToGroup(pendingJump.current)) pendingJump.current = null;
  });

  // The result takes focus, so it is read out and the keyboard starts from there.
  const tallyRef = useRef<HTMLDListElement>(null);
  useEffect(() => {
    if (result) tallyRef.current?.focus({ preventScroll: true });
  }, [result]);

  const importNow = (chosen: File, shown: ImportPreview) =>
    startTransition(async () => {
      setImportError(null);
      const fields = { mapping: JSON.stringify(shown.mapping), skip: JSON.stringify([...skips]), seen: JSON.stringify(shown.seen) };
      const nameOf = new Map(shown.names.map((n) => [n.row, n.name]));
      const names = {
        imported: shown.names.filter((n) => !skips.has(n.row)),
        skipped: [...skips].sort((a, b) => a - b).map((row) => ({ row, name: nameOf.get(row) ?? `Row ${row}` })),
      };
      const res =
        smart && smartReady
          ? await smart.run(null, send(chosen, { ...fields, sessionId: smartState.session!.sessionId, decisions: JSON.stringify(smartState.decisions()) }))
          : await run(null, send(chosen, fields));
      if (!res.ok) return setImportError(res.error);
      setResult({ data: res.data, ...names });
      setView(null);
      setFile(null);
      setConfirmed(new Set());
      smartState.reset();
    });

  if (result) {
    return (
      <ol className="lg-entries" aria-label="Import steps">
        <Entry n={4} state="done" title="Done">
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
            <NameList title="Imported" names={result.imported} />
            <NameList title="Skipped" names={result.skipped} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/${workspaceId}?never=1`} className="lg-btn lg-btn-primary">
              Go to the queue
            </Link>
            <Link href={`/${workspaceId}/board`} className="lg-btn">
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

  const canImport = !pending && !smartState.busy && importing > 0;
  const importButtonLabel = pending ? "Working..." : `Import ${importing} ${importing === 1 ? "company" : "companies"}`;
  // A refusal that means the file or the choices no longer match needs a fresh preview.
  const needsReview = importError !== null && /review/i.test(importError);

  return (
    <div className="lg-importer">
      {file && view && (
        <ImportSummary
          importing={importing}
          skipping={skips.size}
          toReview={open.length}
          errored={view.errors.length}
          unconfirmed={unconfirmed}
          onJump={open.length > 0 ? () => jumpTo(open[0].key) : null}
          onImport={() => importNow(file, view)}
          disabled={!canImport}
          pending={pending}
        />
      )}
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
                setConfirmed(new Set());
                smartState.reset();
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
          {!view && previewError && <ErrorLine>{previewError}</ErrorLine>}
        </Entry>

        <Entry n={2} state={view ? "set" : "later"} title="Check the columns" later="Appears once a file is chosen.">
          {file && view && (
            <>
              <p className="lg-hint mb-3">
                {view.rowCount} {view.rowCount === 1 ? "row" : "rows"} found. Guessed from your headers; change any that are wrong. A change starts the review
                below over.
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
              {previewError && (
                <div className="mt-2">
                  <ErrorLine>{previewError}</ErrorLine>
                  <button type="button" onClick={() => review(file, view.mapping)} className="lg-btn lg-btn-sm mt-2">
                    Try again
                  </button>
                </div>
              )}
              {smart && <SmartColumns smart={smartState} actions={smart} view={view} pending={pending} />}
            </>
          )}
        </Entry>

        <Entry
          n={3}
          state={view ? (open.length > 0 ? "active" : "done") : "later"}
          title="Review"
          later="The first rows, the problems and any look-alike companies show here."
        >
          {file && view && (
            <>
              <SampleRows sample={view.sample} />

              {view.errors.length > 0 && (
                <details open className="lg-problems">
                  <summary>
                    {view.errors.length} {view.errors.length === 1 ? "row" : "rows"} won&apos;t be imported. {view.errors.length === 1 ? "Fix it" : "Fix them"} in the sheet and upload it
                    again to include {view.errors.length === 1 ? "it" : "them"}.
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

              <DuplicateGroups
                idPrefix={id}
                workspaceId={workspaceId}
                groups={groups}
                skips={skips}
                suggested={suggested}
                choose={choose}
                confirmed={confirmed}
                confirm={(key) => setConfirmed((current) => new Set([...current, key]))}
                reopen={(key) => setConfirmed((current) => new Set([...current].filter((k) => k !== key)))}
                doNotContact={doNotContact}
              />

              {smart && (
                <SmartReview
                  smart={smartState}
                  view={view}
                  choose={choose}
                  groupOf={(row) => {
                    const at = groups.findIndex((g) => g.rows.some((r) => r.row === row));
                    return at < 0 ? undefined : { index: at + 1, jump: () => jumpTo(groups[at].key) };
                  }}
                />
              )}
            </>
          )}
        </Entry>

        <Entry n={4} state={view ? (open.length > 0 ? "next" : "active") : "later"} title="Import">
          {file && view ? (
            <>
              <p>
                {importing} {importing === 1 ? "company" : "companies"} will be added
                {smartReady ? ". The readings you use set their stage, dates, contact and notes; the rest start as Not contacted." : " as Not contacted."}
                {unconfirmed ? ` ${unconfirmed}` : ""} Nothing is imported until you press the button.
              </p>
              <div className="mt-3">
                <button type="button" disabled={!canImport} onClick={() => importNow(file, view)} className="lg-btn lg-btn-primary">
                  {importButtonLabel}
                </button>
              </div>
              {!pending && importError && (
                <div className="mt-2">
                  <ErrorLine>{importError}</ErrorLine>
                  {needsReview && (
                    <>
                      <button type="button" onClick={() => review(file, view.mapping)} className="lg-btn lg-btn-sm mt-2">
                        Start the review again
                      </button>
                      <p className="lg-hint mt-1">Coppice checks the file again, and every choice goes back to the suggested one.</p>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="lg-hint">Nothing is imported until you press the button here.</p>
          )}
        </Entry>
      </ol>
    </div>
  );
}
