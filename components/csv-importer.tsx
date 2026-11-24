"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import "@/components/ledger/zod-jitless";
import { reducedMotion } from "@/components/ledger/motion";
import { ErrorLine } from "@/components/ledger/shared";
import { DuplicateGroups, groupDomId } from "@/components/csv-importer-duplicates";
import { ImportDone, type Done } from "@/components/csv-importer-result";
import { SampleRows } from "@/components/csv-importer-sample";
import { ColumnsGrid, Entry, RowProblems } from "@/components/csv-importer-steps";
import { ImportSummary } from "@/components/csv-importer-summary";
import { SmartColumns } from "@/components/csv-importer-smart/columns";
import { SmartReview } from "@/components/csv-importer-smart/review";
import { readingMatches, useSmartImport, type SmartActions } from "@/components/csv-importer-smart/use-smart-import";
import type { ImportPreview, ImportResult } from "@/lib/csv";
import { CONTAINED_WHY, mergeGroups, openChanged, unconfirmedNote, type ReviewSource } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";
import type { ActionResult, ImportMapping } from "@/lib/validation";
import "@/components/ledger/company.css";
import "@/components/ledger/pages.css";

type Props = {
  workspaceId: string;
  preview: (prev: ActionResult<ImportPreview> | null, form: FormData) => Promise<ActionResult<ImportPreview>>;
  run: (prev: ActionResult<ImportResult> | null, form: FormData) => Promise<ActionResult<ImportResult>>;
  // Smart import (AI feature 3), offered only while AI is on for the workspace.
  smart?: SmartActions;
};

const reason = (matchedOn: string[]) => (matchedOn.length === 2 ? "Same name and website" : matchedOn[0] === "website" ? "Same website" : "Same name");

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
  const changed = openChanged(groups, confirmed, skips, suggested);
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

  // A refused import is explained in step 4, where "Start the review again" is. Whichever button
  // started it (the summary's at the top, or step 4's), the reason is brought into view under the
  // summary and takes focus, so the press never looks like it did nothing.
  const errorId = `${id}-import-error`;
  const showError = useRef(false);
  const seeError = () => {
    const el = document.getElementById(errorId);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (pending || !importError || !showError.current) return;
    showError.current = false;
    seeError();
  });

  const importNow = (chosen: File, shown: ImportPreview) =>
    startTransition(async () => {
      setImportError(null);
      showError.current = false;
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
      if (!res.ok) {
        showError.current = true;
        return setImportError(res.error);
      }
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
          <ImportDone workspaceId={workspaceId} result={result} again={() => setResult(null)} />
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
          changed={changed}
          onJump={open.length > 0 ? () => jumpTo(open[0].key) : null}
          onImport={() => importNow(file, view)}
          disabled={!canImport}
          pending={pending}
          failed={!pending && importError !== null}
          onSeeError={seeError}
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
              <ColumnsGrid
                view={view}
                onChange={(mapping) => {
                  if (!pending) review(file, mapping);
                }}
              />
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

              <RowProblems errors={view.errors} />

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
                  onYear={() => {
                    const el = document.getElementById("smart-year");
                    el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
                    el?.querySelector("button")?.focus({ preventScroll: true });
                  }}
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
                <div className="lg-importerr mt-2" id={errorId} tabIndex={-1}>
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
