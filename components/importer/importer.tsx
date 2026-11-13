"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import "@/components/ledger/zod-jitless";
import { fileProblem } from "@/lib/csv-file";
import { DuplicateGroups, groupHeadingId } from "@/components/importer/duplicates";
import { ImportDone, type Done } from "@/components/importer/result";
import { SampleRows } from "@/components/importer/sample";
import { ColumnsGrid, ColumnsLine, Entry, RowProblems, RowWarnings, swapColumn, UnusedColumns } from "@/components/importer/steps";
import { ImportSummary } from "@/components/importer/summary";
import { SmartColumns } from "@/components/importer/smart/columns";
import { SmartReview } from "@/components/importer/smart/review";
import { readingMatches, useSmartImport, type SmartActions } from "@/components/importer/smart/use-smart-import";
import { Disclosure } from "@/components/ledger/disclosure";
import { focusSoon } from "@/components/ledger/focus";
import { ImportIcon, WarningIcon } from "@/components/ledger/icons";
import { prefersReducedMotion } from "@/components/ledger/motion-kit";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import type { ImportPreview, ImportResult } from "@/lib/csv";
import { CONTAINED_WHY, carryDecisions, generations, mergeGroups, previewSources, type ReviewGroup, type ReviewSource } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";
import type { ActionResult, ImportField, ImportMapping } from "@/lib/validation";
import "@/components/ledger/company.css";
import "@/components/ledger/pages.css";
import "@/components/ledger/import.css";

type Props = {
  workspaceId: string;
  preview: (prev: ActionResult<ImportPreview> | null, form: FormData) => Promise<ActionResult<ImportPreview>>;
  run: (prev: ActionResult<ImportResult> | null, form: FormData) => Promise<ActionResult<ImportResult>>;
  // Smart import, offered only while AI is on for the workspace.
  smart?: SmartActions;
};

// A problem the server reported (a refusal) reads as is; one it couldn't answer (the network, a
// crash) gets a Try again.
type Problem = { text: string; retry: boolean };
const UNREACHABLE = "Coppice couldn't check the file just now. Try again.";

// The CSV import screen: drop or choose a file, check the columns, review problems and look-alikes,
// import. Every step sends the file to the server, which parses and checks it again (lib/csv.ts);
// this component only shows what the server sends back and remembers the person's choices.
//
// Each chosen file gets a generation number. A preview, a Smart import suggestion or a reading
// chunk that comes back for an older file is dropped, so the page never mixes two files.
export function CsvImporter({ workspaceId, preview, run, smart }: Props) {
  const notify = useNotify();
  const [file, setFile] = useState<File | null>(null);
  const [view, setView] = useState<ImportPreview | null>(null);
  // Rows the person chose to skip, starting from the suggested ones.
  const [skips, setSkips] = useState<Set<number>>(new Set());
  // Duplicate groups the person confirmed. Only for the screen: the server gets the skips.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  // The group shown in the one-at-a-time review.
  const [current, setCurrent] = useState<string | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<Problem | null>(null);
  const [importError, setImportError] = useState<Problem | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const inputId = `${id}-file`;
  const errorId = `${id}-import-error`;

  const [gens] = useState(generations);
  const fileNow = useRef<File | null>(null);
  // What the review looked like at the last render, so a new preview can keep its decisions.
  const latest = useRef<{ groups: ReviewGroup[]; skips: Set<number>; confirmed: Set<string> }>({ groups: [], skips: new Set(), confirmed: new Set() });

  const send = (chosen: File, fields: Record<string, string>) => {
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("file", chosen);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  };

  const choose = (row: number, skip: boolean) =>
    setSkips((now) => {
      if (now.has(row) === skip) return now;
      const next = new Set(now);
      if (skip) next.add(row);
      else next.delete(row);
      return next;
    });
  const chooseMany = (effects: { row: number; skip: boolean }[]) =>
    setSkips((now) => {
      const next = new Set(now);
      for (const e of effects) {
        if (e.skip) next.add(e.row);
        else next.delete(e.row);
      }
      return next;
    });

  // Smart import's calls, guarded: a throw becomes a message, and an answer for a file that is no
  // longer chosen is dropped (as an empty refusal, which the panel shows as nothing).
  const guardedSmart = useMemo<SmartActions | undefined>(() => {
    if (!smart) return undefined;
    const guard = gens.guard;
    const refusal = (error: string) => ({ ok: false as const, error });
    return {
      options: smart.options,
      suggest: guard(smart.suggest, refusal(""), refusal(UNREACHABLE)),
      start: guard(smart.start, refusal(""), refusal(UNREACHABLE)),
      read: guard(smart.read, { ...refusal(""), rateLimited: false }, { ...refusal(UNREACHABLE), rateLimited: false, retryable: true as const }),
      run: guard(smart.run, refusal(""), refusal(UNREACHABLE)),
    };
  }, [smart, gens]);

  // Asks the server for a preview, with the guessed columns (mapping null) or the chosen ones. With
  // `carry`, groups that didn't change keep their choices and their Confirm.
  const review = (chosen: File, mapping: ImportMapping | null, carry: boolean) => {
    const at = gens.current();
    startTransition(async () => {
      setPreviewError(null);
      setImportError(null);
      let res: ActionResult<ImportPreview>;
      try {
        res = await preview(null, send(chosen, mapping ? { mapping: JSON.stringify(mapping) } : {}));
      } catch {
        if (at === gens.current()) setPreviewError({ text: UNREACHABLE, retry: true });
        return;
      }
      if (at !== gens.current()) return;
      if (!res.ok) {
        setPreviewError({ text: res.error, retry: false });
        if (mapping) setGridOpen(true);
        return;
      }
      const data = res.data;
      const extra = readingMatches(smartState, data.mapping) ? lookalikeSources(smartState.session!.lookalikes) : [];
      const groups = mergeGroups(previewSources(data, extra));
      const suggested = [...data.defaultSkips, ...smartState.heldRows(data.mapping)];
      const kept = carry ? carryDecisions(latest.current, { groups, suggested }) : { skips: new Set(suggested), confirmed: new Set<string>(), lost: 0 };
      setView(data);
      setSkips(kept.skips);
      setConfirmed(kept.confirmed);
      if (kept.lost > 0) notify(`${kept.lost} decided ${kept.lost === 1 ? "group" : "groups"} changed and need${kept.lost === 1 ? "s" : ""} another look.`);
      if (!carry) {
        setCurrent(null);
        setGridOpen(data.nameAssumed);
      }
    });
  };

  const smartState = useSmartImport({
    actions: guardedSmart,
    // Nothing for a file that is no longer chosen, which also stops a reading in progress.
    send: (fields) => (file && file === fileNow.current ? send(file, fields) : null),
    applyMapping: (mapping) => {
      if (file && file === fileNow.current) review(file, mapping, true);
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
  const smartLookalikes = smartReady ? smartState.session!.lookalikes : null;
  const groups = view ? mergeGroups(previewSources(view, smartLookalikes ? lookalikeSources(smartLookalikes) : [])) : [];
  useLayoutEffect(() => {
    latest.current = { groups, skips, confirmed };
  });
  const doNotContact = new Map<number, Quote>(
    smartReady
      ? [...smartState.session!.doNotContact.map((d) => [d.row, d] as const), ...smartState.proposals.flatMap((p) => (p.doNotContact ? [[p.row, p.doNotContact] as const] : []))]
      : [],
  );
  const suggested = new Set([...(view?.defaultSkips ?? []), ...doNotContact.keys()]);
  const open = groups.filter((g) => !confirmed.has(g.key));
  const importing = view ? view.rowCount - view.errors.length - skips.size : 0;

  // Picking a file: checked here first (name and size), so a wrong file is refused at once.
  // A refused file leaves whatever is on the page as it was.
  const pick = (chosen: File | null) => {
    if (!chosen) return;
    const problem = fileProblem(chosen);
    if (problem) {
      setPickError(problem);
      return;
    }
    gens.next();
    smartState.reset();
    setResult(null);
    setPreviewError(null);
    setImportError(null);
    setPickError(null);
    fileNow.current = chosen;
    setFile(chosen);
    setView(null);
    setSkips(new Set());
    setConfirmed(new Set());
    setCurrent(null);
    setGridOpen(false);
    review(chosen, null, false);
  };

  const busy = pending || smartState.busy;
  // The drop zone (and the input in it) gives way to the review, or the review to the drop zone:
  // focus that fell to <body> goes to the file input, so the keyboard carries on from there.
  const reviewing = Boolean(view);
  useEffect(() => {
    if (!busy && (!document.activeElement || document.activeElement === document.body)) document.getElementById(inputId)?.focus({ preventScroll: true });
  }, [reviewing, busy, inputId]);

  const jumpTo = (key: string) => {
    if (confirmed.has(key)) setConfirmed((now) => new Set([...now].filter((k) => k !== key)));
    setCurrent(key);
    focusSoon(`#${CSS.escape(groupHeadingId(id, key))}`);
  };

  const importNow = (chosen: File, shown: ImportPreview) => {
    const at = gens.current();
    startTransition(async () => {
      setImportError(null);
      const fields = { mapping: JSON.stringify(shown.mapping), skip: JSON.stringify([...skips]), seen: JSON.stringify(shown.seen) };
      const nameOf = new Map(shown.names.map((n) => [n.row, n.name]));
      const names = {
        imported: shown.names.filter((n) => !skips.has(n.row)),
        skipped: [...skips].sort((a, b) => a - b).map((row) => ({ row, name: nameOf.get(row) ?? `Row ${row}` })),
        failed: shown.errors.map((e) => ({ row: e.row, name: e.name, reason: e.messages.join(" ") })),
      };
      let res: ActionResult<ImportResult>;
      try {
        res =
          guardedSmart && smartReady
            ? await guardedSmart.run(null, send(chosen, { ...fields, sessionId: smartState.session!.sessionId, decisions: JSON.stringify(smartState.decisions()) }))
            : await run(null, send(chosen, fields));
      } catch {
        res = { ok: false, error: "Coppice couldn't finish the import just now. Nothing was imported. Try again." };
      }
      if (at !== gens.current()) return;
      if (!res.ok) {
        setImportError({ text: res.error, retry: /review/i.test(res.error) });
        focusSoon(`#${CSS.escape(errorId)}`);
        return;
      }
      setResult({ data: res.data, ...names, file: chosen });
      gens.next();
      fileNow.current = null;
      setView(null);
      setFile(null);
      setConfirmed(new Set());
      smartState.reset();
    });
  };

  // The one file input, shared by the drop zone and "Choose another file". Its value is cleared
  // once read, so choosing the same file again (fixed and re-exported) is read again.
  const input = (
    <input
      id={inputId}
      type="file"
      accept=".csv,text/csv"
      className="lg-file"
      autoComplete="off"
      disabled={busy}
      onChange={(e) => {
        const chosen = e.target.files?.[0] ?? null;
        e.target.value = "";
        pick(chosen);
      }}
    />
  );

  if (result) {
    return (
      <div className="lg-importer">
        <ImportDone
          workspaceId={workspaceId}
          result={result}
          again={() => {
            setResult(null);
            focusSoon(`#${CSS.escape(inputId)}`);
          }}
        />
      </div>
    );
  }

  if (!file || !view) {
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (busy) return;
      pick(event.dataTransfer.files?.[0] ?? null);
    };
    return (
      <div className="lg-importer">
        <div
          className="lg-dropzone"
          data-dragging={dragging || undefined}
          data-tour="import-drop"
          onDragOver={(event) => {
            event.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <ImportIcon size={28} className="lg-dropzone-icon" />
          <p className="lg-dropzone-text">
            {pending && file ? (
              <span role="status">Reading {file.name}...</span>
            ) : (
              <>
                Drop a .csv here or{" "}
                <span className="lg-filerow">
                  {input}
                  <label htmlFor={inputId} className="lg-btn lg-btn-primary">
                    Choose a CSV file
                  </label>
                </span>
              </>
            )}
          </p>
          {smart && !(pending && file) && (
            <p className="lg-hint lg-dropzone-hint">Messy notes or a status column? Smart import can read them once you choose a file.</p>
          )}
          <ErrorLine>{pickError ?? previewError?.text}</ErrorLine>
          {previewError?.retry && file && (
            <button type="button" className="lg-btn lg-btn-sm" onClick={() => review(file, null, false)}>
              Try again
            </button>
          )}
        </div>
        <Disclosure variant="inline" summary="How to export from Sheets or Excel" className="mt-3">
          <ul className="lg-howto">
            <li>Google Sheets: File, Download, Comma-separated values (.csv).</li>
            <li>Excel: File, Save As, CSV UTF-8 (Comma delimited).</li>
            <li>Keep the header row. Up to 2,000 rows and 3 MB.</li>
            <li>Each company is added as Not contacted, with at most one contact.</li>
          </ul>
          <p className="mt-2">
            <a href="/coppice-import-template.csv" download className="lg-link">
              Download a template
            </a>{" "}
            <span className="lg-muted">(Company, Industry, Website, Notes, Contact name, Contact email)</span>
          </p>
        </Disclosure>
      </div>
    );
  }

  // When nothing can be imported, the bar says why instead of offering a button.
  const validRows = view.rowCount - view.errors.length;
  const existingRows = new Set(groups.filter((g) => g.existing.length > 0).flatMap((g) => g.rows.map((r) => r.row)));
  const zeroReason =
    validRows === 0
      ? "Nothing to import: every row has a problem (see below)."
      : [...skips].every((row) => existingRows.has(row))
        ? "Nothing to import: every row is already in Coppice."
        : "Nothing to import: every row is set to skip.";

  return (
    <div className="lg-importer">
      <ImportSummary
        importing={importing}
        skipping={skips.size}
        toReview={open.length}
        errored={view.errors.length}
        zeroReason={zeroReason}
        onJump={open.length > 0 ? () => jumpTo(open.find((g) => g.key === current)?.key ?? open[0].key) : null}
        onImport={() => importNow(file, view)}
        disabled={busy || importing <= 0}
        pending={pending}
      />
      {importError && !pending && (
        <div className="lg-importerr" id={errorId} tabIndex={-1}>
          <ErrorLine>{importError.text}</ErrorLine>
          {importError.retry && (
            <button type="button" onClick={() => review(file, view.mapping, true)} className="lg-btn lg-btn-sm mt-2">
              Start the review again
            </button>
          )}
        </div>
      )}
      <ol className="lg-entries lg-impsteps" aria-label="Import steps">
        <Entry n={1} done title="File">
          <div className="lg-filerow">
            <span className="lg-filename lg-wrap-any">
              <strong>{file.name}</strong> · {view.rowCount.toLocaleString("en-US")} {view.rowCount === 1 ? "row" : "rows"}
            </span>
            {input}
            <label htmlFor={inputId} className="lg-linkbtn lg-filelabel">
              Choose another file
            </label>
          </div>
          {view.encodingGuess && (
            <p className="lg-impwarn" role="note">
              <WarningIcon size={14} />
              <span>This file isn&apos;t UTF-8; Coppice read it as Windows (Western). Check the names below look right.</span>
            </p>
          )}
          <ErrorLine>{pickError}</ErrorLine>
        </Entry>

        <Entry n={2} done={!gridOpen && !previewError} title="Columns">
          <p className="lg-colsrow">
            <ColumnsLine view={view} />{" "}
            <button type="button" className="lg-linkbtn" aria-expanded={gridOpen} aria-controls={`${id}-grid`} onClick={() => setGridOpen((v) => !v)}>
              {gridOpen ? "Done" : "Change"}
            </button>
          </p>
          <UnusedColumns view={view} read={smartState.on ? smartState.freeText : []} smartOffered={Boolean(smart && guardedSmart)} />
          {view.nameAssumed && gridOpen && <p className="lg-hint">No header looked like a company name, so the first free column was used. Check it.</p>}
          <div id={`${id}-grid`} hidden={!gridOpen}>
            <ColumnsGrid
              view={view}
              disabled={busy}
              onChange={(field: ImportField, column) => {
                if (busy) return;
                const swapped = swapColumn(view.mapping, view.headers, field, column);
                if ("error" in swapped) return notify(swapped.error, "error");
                if (swapped.note) notify(swapped.note);
                review(file, swapped.mapping, true);
              }}
            />
          </div>
          {pending && (
            <p className="lg-hint mt-2" role="status">
              Working...
            </p>
          )}
          {previewError && !pending && (
            <div className="mt-2">
              <ErrorLine>{previewError.text}</ErrorLine>
              {previewError.retry && (
                <button type="button" onClick={() => review(file, view.mapping, true)} className="lg-btn lg-btn-sm mt-2">
                  Try again
                </button>
              )}
            </div>
          )}
          {smart && guardedSmart && (
            <div data-tour="smart-switch" className="lg-smartentry">
              <Disclosure variant="inline" summary="Smart import: read notes with AI" defaultOpen={smartState.on || smartState.session !== null}>
                <SmartColumns smart={smartState} actions={guardedSmart} view={view} pending={pending} />
              </Disclosure>
            </div>
          )}
        </Entry>

        <Entry n={3} done={open.length === 0} title="Review">
          <RowProblems errors={view.errors} allFail={validRows === 0} />
          <RowWarnings warnings={view.warnings} />
          <SampleRows sample={view.sample} defaultOpen={Boolean(view.encodingGuess)} />
          <DuplicateGroups
            idPrefix={id}
            workspaceId={workspaceId}
            groups={groups}
            skips={skips}
            suggested={suggested}
            choose={choose}
            chooseMany={chooseMany}
            confirmed={confirmed}
            confirm={(keys) => setConfirmed((now) => new Set([...now, ...keys]))}
            reopen={(key) => setConfirmed((now) => new Set([...now].filter((k) => k !== key)))}
            current={current}
            setCurrent={setCurrent}
            doNotContact={doNotContact}
          />
          {smart && (
            <SmartReview
              smart={smartState}
              view={view}
              choose={choose}
              onYear={() => {
                const el = document.getElementById("smart-year");
                const fold = el?.closest("details");
                if (fold) fold.open = true;
                el?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
                el?.querySelector("button")?.focus({ preventScroll: true });
              }}
              groupOf={(row) => {
                const at = groups.findIndex((g) => g.rows.some((r) => r.row === row));
                return at < 0 ? undefined : { index: at + 1, jump: () => jumpTo(groups[at].key) };
              }}
            />
          )}
        </Entry>
      </ol>
    </div>
  );
}

const lookalikeSources = (lookalikes: { reason: string; why: string; existing: ReviewSource["existing"]; rows: ReviewSource["rows"] }[]): ReviewSource[] =>
  lookalikes.map((g) => ({ reason: g.reason === "contained" ? CONTAINED_WHY : g.why, existing: g.existing, rows: g.rows }));
