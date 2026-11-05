"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChipGroup } from "@/components/ledger/chips";
import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { ErrorLine } from "@/components/ledger/shared";
import type { ImportPreview, ImportResult } from "@/lib/csv";
import type { ColumnSuggestion, Lookalike, Quote, RowProposal, SmartChunkResult, SmartOptions, SmartStart } from "@/lib/smart-import";
import { STAGE_LABELS } from "@/lib/stages";
import { SMART_MAX_ROWS, SMART_STAGES, type ActionResult, type ImportMapping, type SmartDecision } from "@/lib/validation";
import "@/components/ledger/smart-import.css";

// Smart import, the optional half of the CSV importer (components/csv-importer.tsx). The AI only
// proposes: every reading shows the cell text it came from, and the person keeps, edits or drops
// each one before anything is imported. The browser sends the free-text rows one chunk at a time
// (lib/smart-import.ts), so a long sheet never needs one long server call; a rate limit stops the
// reading until the person presses Continue, and nothing is retried on its own.

type Action<T> = (prev: T | null, form: FormData) => Promise<T>;

export type SmartActions = {
  options: SmartOptions;
  suggest: Action<ActionResult<ColumnSuggestion>>;
  start: Action<ActionResult<SmartStart>>;
  read: Action<SmartChunkResult>;
  run: Action<ActionResult<ImportResult>>;
};

type ProposedStage = (typeof SMART_STAGES)[number];
type Kept<T> = { keep: boolean; value: T };
type RowEdits = {
  stage?: Kept<ProposedStage>;
  last?: Kept<string>;
  follow?: Kept<string>;
  contact?: Kept<{ name: string; title: string }>;
  note?: Kept<string>;
};

const editsFor = (p: RowProposal): RowEdits => ({
  stage: p.stage ? { keep: true, value: p.stage.value } : undefined,
  last: p.lastContactedOn ? { keep: true, value: p.lastContactedOn.date } : undefined,
  follow: p.followUpOn ? { keep: true, value: p.followUpOn.date } : undefined,
  contact: p.contact ? { keep: true, value: { name: p.contact.name, title: p.contact.title ?? "" } } : undefined,
  note: p.note ? { keep: true, value: p.note.text } : undefined,
});

const hasReading = (p: RowProposal) => Boolean(p.stage || p.lastContactedOn || p.followUpOn || p.contact || p.note || p.doNotContact);

// Everything Smart import keeps between steps. `send` builds a form with the file in it, like the
// importer's own steps; `applyMapping` asks the importer for a new preview with other columns.
export function useSmartImport({
  actions,
  send,
  applyMapping,
  skips,
  choose,
}: {
  // Undefined when Smart import isn't offered (AI off): the hook then does nothing.
  actions: SmartActions | undefined;
  send: (fields: Record<string, string>) => FormData | null;
  applyMapping: (mapping: ImportMapping) => void;
  skips: Set<number>;
  choose: (row: number, skip: boolean) => void;
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<number[]>([]);
  const [cycle, setCycle] = useState(actions?.options.current ?? 0);
  const [session, setSession] = useState<(SmartStart & { mapping: string }) | null>(null);
  const [next, setNext] = useState(0);
  const [readError, setReadError] = useState<{ error: string; rateLimited: boolean } | null>(null);
  const [proposals, setProposals] = useState<RowProposal[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [edits, setEdits] = useState<Record<number, RowEdits>>({});
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  const clearReading = () => {
    setSession(null);
    setNext(0);
    setReadError(null);
    setProposals([]);
    setEdits({});
    setAccepted(new Set());
  };

  const reset = () => {
    setOn(false);
    setNote(null);
    setError(null);
    setFreeText([]);
    clearReading();
  };

  // Turning it on asks for column suggestions and applies them; the person can still change any.
  const turn = async (value: boolean) => {
    setOn(value);
    setError(null);
    clearReading();
    if (!value || !actions?.options.groq) return;
    const form = send({});
    if (!form) return;
    setBusy(true);
    const res = await actions.suggest(null, form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFreeText(res.data.freeText);
    setNote(res.data.note);
    applyMapping(res.data.mapping);
  };

  // Reads chunks one after another from `from`, until done or one fails. A failure stops here;
  // Continue picks up from the same chunk, and chunks already read are kept on the server.
  const readFrom = async (started: SmartStart, from: number) => {
    if (!actions) return;
    setBusy(true);
    setReadError(null);
    for (let index = from; index < started.chunkCount; index++) {
      const form = send({ sessionId: started.sessionId, index: String(index) });
      if (!form) break;
      const res = await actions.read(null, form);
      if (!res.ok) {
        setReadError({ error: res.error, rateLimited: res.rateLimited });
        setNext(index);
        setBusy(false);
        return;
      }
      setNames((current) => new Map([...current, ...res.data.names.map((n) => [n.row, n.name] as const)]));
      setProposals((current) => [...current.filter((p) => !res.data.proposals.some((q) => q.row === p.row)), ...res.data.proposals].sort((a, b) => a.row - b.row));
      setEdits((current) => ({ ...current, ...Object.fromEntries(res.data.proposals.map((p) => [p.row, editsFor(p)])) }));
      for (const p of res.data.proposals) if (p.doNotContact) choose(p.row, true);
      setNext(index + 1);
    }
    setBusy(false);
  };

  const startReading = async (mapping: ImportMapping) => {
    if (!actions) return;
    setError(null);
    clearReading();
    const form = send({ mapping: JSON.stringify(mapping), freeText: JSON.stringify(freeText), cycleStart: String(cycle) });
    if (!form) return;
    setBusy(true);
    const res = await actions.start(null, form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSession({ ...res.data, mapping: JSON.stringify(mapping) });
    setNames(new Map(res.data.doNotContact.map((d) => [d.row, d.name])));
    // Do-not-contact rows start skipped; the person can choose to import them anyway.
    for (const d of res.data.doNotContact) choose(d.row, true);
    await readFrom(res.data, 0);
  };

  // What the person kept, for the import. Skipped rows send nothing.
  const decisions = (): SmartDecision[] => {
    const rows = new Set([...proposals.map((p) => p.row), ...(session?.doNotContact ?? []).map((d) => d.row)]);
    return [...rows].flatMap((row) => {
      if (skips.has(row)) return [];
      const e = edits[row] ?? {};
      const kept = <T,>(k: Kept<T> | undefined) => (k?.keep ? k.value : null);
      const contact = kept(e.contact);
      const decision: SmartDecision = {
        row,
        stage: kept(e.stage),
        lastContactedOn: kept(e.last) || null,
        followUpOn: kept(e.follow) || null,
        contact: contact && contact.name.trim() ? { name: contact.name.trim(), title: contact.title.trim() || null } : null,
        note: kept(e.note)?.trim() || null,
        dncAccepted: accepted.has(row),
      };
      const any = decision.stage || decision.lastContactedOn || decision.followUpOn || decision.contact || decision.note || decision.dncAccepted;
      return any ? [decision] : [];
    });
  };

  const edit = (row: number, change: Partial<RowEdits>) => setEdits((current) => ({ ...current, [row]: { ...current[row], ...change } }));
  const accept = (row: number, value: boolean) => {
    setAccepted((current) => {
      const nextSet = new Set(current);
      if (value) nextSet.add(row);
      else nextSet.delete(row);
      return nextSet;
    });
    choose(row, !value);
  };

  return {
    skipsHas: (row: number) => skips.has(row),
    on,
    busy,
    note,
    error,
    freeText,
    setFreeText,
    cycle,
    setCycle,
    session,
    next,
    readError,
    proposals,
    names,
    edits,
    accepted,
    turn,
    reset,
    startReading,
    readFrom,
    decisions,
    edit,
    accept,
    clearReading,
  };
}

export type SmartState = ReturnType<typeof useSmartImport>;

// Whether the reading was done with the columns the preview shows now.
export const readingMatches = (smart: SmartState, mapping: ImportMapping) => smart.session !== null && smart.session.mapping === JSON.stringify(mapping);

// ---------------------------------------------------------------------------------------------
// Step 2: the switch, the columns to read and the sheet's board year.

export function SmartColumns({ smart, actions, view, pending }: { smart: SmartState; actions: SmartActions; view: ImportPreview; pending: boolean }) {
  const { options } = actions;
  const stale = smart.session !== null && !readingMatches(smart, view.mapping);
  const done = smart.session !== null && smart.next >= smart.session.chunkCount;
  return (
    <section className="lg-smart" aria-labelledby="smart-h">
      <h3 id="smart-h" className="lg-h3">
        Smart import
      </h3>
      <label className="lg-switch">
        <input type="checkbox" className="lg-check" checked={smart.on} disabled={smart.busy || pending} onChange={(e) => smart.turn(e.target.checked)} />
        <span>Read the free-text columns with AI</span>
      </label>
      <p className="lg-hint lg-smart-say">
        Coppice reads notes like &ldquo;emailed 3/2 by Sam, said reach out in Aug&rdquo; and proposes a stage, dates and a contact, each with the text it came from.
        You keep, change or drop each one. Up to {SMART_MAX_ROWS} rows with free text are read per import; the rest import the normal way.
      </p>
      {smart.on && !options.groq && (
        <p className="lg-error" role="status">
          <WarningIcon size={16} />
          <span>Smart import needs a Groq key on this server (GROQ_API_KEY), and it isn&apos;t set. The normal import below still works.</span>
        </p>
      )}
      {smart.on && options.groq && (
        <div className="lg-smart-body">
          <p className="lg-hint">
            What is sent: the headers and up to 15 sample rows go to Google&apos;s Gemini to suggest the columns, and the company names to spot look-alikes.
            The free-text cells, which can include names, go to Groq. Email addresses and phone numbers are masked in both.
          </p>
          {smart.note && <p className="lg-hint">{smart.note}</p>}
          <fieldset className="lg-smart-cols">
            <legend className="lg-label">Columns to read</legend>
            {view.headers.map((header, index) => {
              const taken = index === view.mapping.name || index === view.mapping.contactEmail || index === view.mapping.website;
              return (
                <label key={index} className="lg-smart-col" data-off={taken || undefined}>
                  <input
                    type="checkbox"
                    className="lg-check"
                    disabled={taken || smart.busy}
                    checked={smart.freeText.includes(index)}
                    onChange={(e) => {
                      smart.clearReading();
                      smart.setFreeText(e.target.checked ? [...smart.freeText, index].sort((a, b) => a - b) : smart.freeText.filter((c) => c !== index));
                    }}
                  />
                  <span>{header.trim() || `Column ${index + 1}`}</span>
                </label>
              );
            })}
          </fieldset>
          <div className="lg-smart-year">
            <p className="lg-maplabel" aria-hidden="true">
              The sheet is from
            </p>
            <LedgerMenu
              hideLabel
              label="The board year the sheet is from"
              value={String(smart.cycle)}
              options={options.cycles.map((c) => ({ value: String(c.start), label: c.start === options.current ? `${c.label} (this year)` : c.label }))}
              onChange={(value) => {
                smart.clearReading();
                smart.setCycle(Number(value));
              }}
            />
            {smart.cycle < options.current && (
              <p className="lg-hint">
                An earlier year&apos;s sheet comes back as fresh leads: Not contacted, with what the sheet said added to the notes.
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="lg-btn lg-btn-primary"
              disabled={smart.busy || pending || smart.freeText.length === 0}
              onClick={() => smart.startReading(view.mapping)}
            >
              {smart.session && !stale ? "Read again" : "Read the free-text cells"}
            </button>
            {smart.busy && (
              <span className="lg-hint" role="status">
                Working...
              </span>
            )}
          </div>
          {stale && <p className="lg-hint mt-2">The columns changed since the cells were read. Read them again to use Smart import.</p>}
          {smart.session && !stale && <SmartProgress smart={smart} done={done} />}
          <ErrorLine>{smart.error}</ErrorLine>
        </div>
      )}
    </section>
  );
}

const METER_CELLS = 20;

function SmartProgress({ smart, done }: { smart: SmartState; done: boolean }) {
  const session = smart.session as SmartStart;
  const read = Math.min(session.rowsToRead, smart.next * session.chunkRows);
  const filled = session.chunkCount === 0 ? METER_CELLS : Math.round((smart.next / session.chunkCount) * METER_CELLS);
  return (
    <div className="lg-usage">
      <p className="lg-usage-line" role="status">
        {session.rowsToRead === 0
          ? "No row has free text in those columns."
          : done
            ? `Read all ${session.rowsToRead} rows with free text.`
            : `Read ${read} of ${session.rowsToRead} rows with free text.`}
        {session.overCap > 0 && ` ${session.overCap} more ${session.overCap === 1 ? "row is" : "rows are"} past the ${SMART_MAX_ROWS}-row limit and will import the normal way.`}
      </p>
      {session.rowsToRead > 0 && (
        <div className="lg-meter" aria-hidden="true">
          {Array.from({ length: METER_CELLS }, (_, i) => (
            <span key={i} data-on={i < filled || undefined} />
          ))}
        </div>
      )}
      {smart.readError && (
        <div className="mt-2">
          <ErrorLine>{smart.readError.error}</ErrorLine>
          <button type="button" className="lg-btn lg-btn-sm mt-2" disabled={smart.busy} onClick={() => smart.readFrom(session, smart.next)}>
            Continue
          </button>
          <p className="lg-hint mt-1">Or import now: rows not read yet import the normal way.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 3: what was read, for the person to keep, edit or drop.

function Source({ quotes }: { quotes: Quote[] }) {
  return (
    <p className="lg-smart-src">
      {quotes.map((q, i) => (
        <span key={i}>
          {i > 0 && " "}From {q.header}: <q className="lg-quote">{q.quote}</q>
        </span>
      ))}
    </p>
  );
}

function Item({ label, row, kept, onKeep, quotes, children }: { label: string; row: number; kept: boolean; onKeep: (keep: boolean) => void; quotes: Quote[]; children: ReactNode }) {
  return (
    <div className="lg-smart-item" data-dropped={!kept || undefined}>
      <p className="lg-tag">{label}</p>
      <div className="lg-smart-ctl">
        {children}
        <Source quotes={quotes} />
      </div>
      <ChipGroup
        legend={`${label}, row ${row}`}
        hideLegend
        value={kept ? "keep" : "drop"}
        onChange={(value) => onKeep(value === "keep")}
        options={[
          { value: "keep", label: "Keep", ariaLabel: `Keep ${label.toLowerCase()} for row ${row}` },
          { value: "drop", label: "Drop", ariaLabel: `Drop ${label.toLowerCase()} for row ${row}` },
        ]}
      />
    </div>
  );
}

export function SmartReview({ smart, view }: { smart: SmartState; view: ImportPreview }) {
  if (!readingMatches(smart, view.mapping)) return null;
  const session = smart.session as SmartStart;
  const errored = new Set(view.errors.map((e) => e.row));
  const byRow = new Map(smart.proposals.map((p) => [p.row, p]));
  // Rows with something to review: readings, or a do-not-contact line code found.
  const rows = [...new Set([...smart.proposals.filter(hasReading).map((p) => p.row), ...session.doNotContact.map((d) => d.row)])]
    .filter((row) => !errored.has(row))
    .sort((a, b) => a - b);
  const dropped = smart.proposals.reduce((n, p) => n + p.dropped.length, 0);
  const nothing = smart.proposals.filter((p) => !hasReading(p)).length;

  return (
    <div className="lg-groups">
      <h3 className="lg-h3">What Smart import read</h3>
      <p className="lg-hint mb-3">
        {rows.length === 0 ? "Nothing to review yet." : `${rows.length} ${rows.length === 1 ? "row has" : "rows have"} something to review.`}
        {nothing > 0 && ` ${nothing} ${nothing === 1 ? "row" : "rows"} said nothing Coppice could check.`}
        {dropped > 0 && ` ${dropped} ${dropped === 1 ? "reading was" : "readings were"} dropped because the quote or date didn't check out.`} Coppice never imports
        Committed or Declined, and never logs outreach or claims a company.
      </p>
      {rows.map((row) => {
        const p = byRow.get(row);
        const e = smart.edits[row] ?? {};
        const dnc = p?.doNotContact ?? session.doNotContact.find((d) => d.row === row) ?? null;
        const skipped = smart.skipsHas(row);
        return (
          <div key={row} className="lg-group lg-smart-row" role="group" aria-labelledby={`smart-row-${row}`}>
            <div className="lg-group-head">
              <h4 id={`smart-row-${row}`} className="lg-group-q">
                Row {row}: {smart.names.get(row) ?? ""}
              </h4>
              {skipped && <span className="lg-tag lg-muted">Skipped</span>}
            </div>
            {dnc && (
              <div className="lg-smart-item lg-smart-dnc">
                <p className="lg-tag lg-late">
                  <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
                  Do not contact
                </p>
                <div className="lg-smart-ctl">
                  <p>The sheet says not to contact them. It is skipped unless you choose to import it anyway.</p>
                  <Source quotes={[dnc]} />
                </div>
                <ChipGroup
                  legend={`Row ${row}, do not contact`}
                  hideLegend
                  value={smart.accepted.has(row) ? "import" : "skip"}
                  onChange={(value) => smart.accept(row, value === "import")}
                  options={[
                    { value: "skip", label: "Skip", ariaLabel: `Skip row ${row}` },
                    { value: "import", label: "Import anyway", ariaLabel: `Import row ${row} anyway` },
                  ]}
                />
              </div>
            )}
            {p?.stage && e.stage && (
              <Item label="Stage" row={row} kept={e.stage.keep} onKeep={(keep) => smart.edit(row, { stage: { ...e.stage!, keep } })} quotes={[p.stage]}>
                <LedgerMenu
                  hideLabel
                  label={`Stage for row ${row}`}
                  value={e.stage.value}
                  options={SMART_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
                  onChange={(value) => smart.edit(row, { stage: { keep: true, value } })}
                />
              </Item>
            )}
            {p?.lastContactedOn && e.last && (
              <Item label="Last contacted" row={row} kept={e.last.keep} onKeep={(keep) => smart.edit(row, { last: { ...e.last!, keep } })} quotes={[p.lastContactedOn]}>
                <input
                  type="date"
                  className="lg-input lg-smart-date"
                  aria-label={`Last contacted, row ${row}`}
                  value={e.last.value}
                  onChange={(ev) => smart.edit(row, { last: { keep: true, value: ev.target.value } })}
                />
              </Item>
            )}
            {p?.followUpOn && e.follow && (
              <Item label="Follow up" row={row} kept={e.follow.keep} onKeep={(keep) => smart.edit(row, { follow: { ...e.follow!, keep } })} quotes={[p.followUpOn]}>
                <input
                  type="date"
                  className="lg-input lg-smart-date"
                  aria-label={`Follow up, row ${row}`}
                  value={e.follow.value}
                  onChange={(ev) => smart.edit(row, { follow: { keep: true, value: ev.target.value } })}
                />
              </Item>
            )}
            {p?.contact && e.contact && (
              <Item label="Contact" row={row} kept={e.contact.keep} onKeep={(keep) => smart.edit(row, { contact: { ...e.contact!, keep } })} quotes={[p.contact]}>
                <div className="lg-smart-pair">
                  <input
                    className="lg-input"
                    aria-label={`Contact name, row ${row}`}
                    value={e.contact.value.name}
                    maxLength={120}
                    onChange={(ev) => smart.edit(row, { contact: { keep: true, value: { ...e.contact!.value, name: ev.target.value } } })}
                  />
                  <input
                    className="lg-input"
                    aria-label={`Contact title, row ${row}`}
                    placeholder="Title"
                    value={e.contact.value.title}
                    maxLength={120}
                    onChange={(ev) => smart.edit(row, { contact: { keep: true, value: { ...e.contact!.value, title: ev.target.value } } })}
                  />
                </div>
              </Item>
            )}
            {p?.note && e.note && (
              <Item label="Add to notes" row={row} kept={e.note.keep} onKeep={(keep) => smart.edit(row, { note: { ...e.note!, keep } })} quotes={p.note.quotes}>
                <textarea
                  className="lg-textarea lg-smart-note"
                  aria-label={`Line added to the notes, row ${row}`}
                  value={e.note.value}
                  maxLength={600}
                  onChange={(ev) => smart.edit(row, { note: { keep: true, value: ev.target.value } })}
                />
              </Item>
            )}
            {p && p.dropped.length > 0 && (
              <details className="lg-smart-dropped">
                <summary>
                  {p.dropped.length} {p.dropped.length === 1 ? "reading" : "readings"} dropped
                </summary>
                <ul>
                  {p.dropped.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Look-alike names, flagged with a reason next to the exact duplicates. Import or Skip per row.
export function SmartLookalikes({
  smart,
  view,
  workspaceId,
  skips,
  choose,
}: {
  smart: SmartState;
  view: ImportPreview;
  workspaceId: string;
  skips: Set<number>;
  choose: (row: number, skip: boolean) => void;
}) {
  if (!readingMatches(smart, view.mapping)) return null;
  const session = smart.session as SmartStart;
  if (session.lookalikes.length === 0 && !session.lookalikeNote) return null;
  const name = (row: number) => smart.names.get(row) ?? view.labels.find((l) => l.row === row)?.name ?? "";
  return (
    <div className="lg-groups">
      <h3 className="lg-h3">Look-alike names</h3>
      <p className="lg-hint mb-3">
        These don&apos;t match exactly but may be the same company. Nothing is merged: choose Import or Skip for each row.
        {session.lookalikeNote && ` ${session.lookalikeNote}`}
      </p>
      {session.lookalikes.map((pair: Lookalike, gi) => (
        <div key={`${pair.rows.join("-")}-${pair.existing.map((c) => c.id).join("-")}`} className="lg-group" role="group" aria-labelledby={`smart-l${gi}`}>
          <div className="lg-group-head">
            <h4 id={`smart-l${gi}`} className="lg-group-q">
              Same company?
            </h4>
            <span className="lg-tag lg-muted">{pair.reason}</span>
          </div>
          <div className="lg-group-cols">
            {pair.existing.map((company) => (
              <div key={company.id} className="lg-dupcard lg-dupcard-have">
                <p className="lg-tag lg-muted">Already in the workspace</p>
                <p className="lg-dupname">
                  <Link href={`/${workspaceId}/companies/${company.id}`} className="lg-link">
                    {company.name}
                  </Link>
                </p>
                <p className="lg-dupsite">
                  {company.website || "No website"}
                  {company.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                </p>
              </div>
            ))}
            {pair.rows.map((row) => {
              const skipped = skips.has(row);
              return (
                <div key={row} className="lg-dupcard" data-skipped={skipped || undefined}>
                  <p className="lg-tag lg-muted">In your file, row {row}</p>
                  <p className="lg-dupname">
                    <span className="lg-nametext">
                      Row {row}: {name(row)}
                    </span>
                  </p>
                  <ChipGroup
                    legend={`Row ${row}`}
                    hideLegend
                    value={skipped ? "skip" : "import"}
                    onChange={(value) => choose(row, value === "skip")}
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
  );
}
