"use client";

import type { ReactNode } from "react";
import { ImportChoice } from "@/components/csv-importer-choice";
import { WarningIcon } from "@/components/ledger/icons";
import { useNotify } from "@/components/ledger/providers";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import type { ImportPreview } from "@/lib/csv";
import type { Quote, RowProposal, SmartStart } from "@/lib/smart-import";
import { futureHint } from "@/lib/smart-import/dates";
import { STAGE_LABELS } from "@/lib/stages";
import { SMART_NOTE_MAX, SMART_STAGES } from "@/lib/validation";
import { hasReading, readingMatches, type RowEdits, type SmartState } from "./use-smart-import";
import "@/components/ledger/smart-import.css";

// Step 3 of the importer with Smart import on: what was read, one card per row, each reading with
// the cell text it came from and Use or Leave out. A row's import choice lives in one place: in
// its duplicate group when it has one, otherwise here for a do-not-contact row. A skipped row's
// readings are folded away, since nothing of a skipped row is imported.

// Where a row's import choice is decided, when it is in a duplicate group.
export type GroupRef = { index: number; jump: () => void };

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

const QUESTIONS: Record<string, string> = {
  Stage: "Use this stage?",
  "Last contacted": "Use this date?",
  "Follow up": "Use this date?",
  Contact: "Use this contact?",
  "Add to notes": "Add this line?",
};

function Item({ label, row, kept, onKeep, quotes, children }: { label: string; row: number; kept: boolean; onKeep: (keep: boolean) => void; quotes: Quote[]; children: ReactNode }) {
  return (
    <div className="lg-smart-item" data-dropped={!kept || undefined}>
      <p className="lg-tag">{label}</p>
      <div className="lg-smart-ctl">
        {children}
        <Source quotes={quotes} />
      </div>
      <ImportChoice
        className="lg-smart-choice"
        question={QUESTIONS[label] ?? "Use it?"}
        value={kept ? "use" : "leave"}
        onChange={(value) => onKeep(value === "use")}
        caption={kept ? "Used when you import." : "Left out of the import."}
        options={[
          { value: "use", label: "Use", ariaLabel: `Use ${label.toLowerCase()} for row ${row}` },
          { value: "leave", label: "Leave out", ariaLabel: `Leave out ${label.toLowerCase()} for row ${row}` },
        ]}
      />
    </div>
  );
}

function DoNotContact({ smart, row, quote }: { smart: SmartState; row: number; quote: Quote }) {
  const skipped = smart.skipsHas(row);
  return (
    <div className="lg-smart-item lg-smart-dnc">
      <p className="lg-tag lg-late">
        <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
        Do not contact
      </p>
      <div className="lg-smart-ctl">
        <p>The sheet says not to contact them, so it is skipped unless you import it anyway.</p>
        <Source quotes={[quote]} />
      </div>
      <ImportChoice
        className="lg-smart-choice"
        question="Import it anyway?"
        value={skipped ? "skip" : "import"}
        onChange={(value) => smart.accept(row, value === "import")}
        caption={skipped ? "Not imported." : "Imported, though the sheet says not to contact them."}
        options={[
          { value: "skip", label: "Skip", ariaLabel: `Skip row ${row}` },
          { value: "import", label: "Import anyway", ariaLabel: `Import row ${row} anyway` },
        ]}
      />
    </div>
  );
}

function DateItem({ label, row, kept, value, quote, onKeep, onChange }: { label: string; row: number; kept: boolean; value: string; quote: Quote; onKeep: (keep: boolean) => void; onChange: (value: string) => void }) {
  return (
    <Item label={label} row={row} kept={kept} onKeep={onKeep} quotes={[quote]}>
      <input type="date" className="lg-input lg-smart-date" aria-label={`${label}, row ${row}`} value={value} onChange={(ev) => onChange(ev.target.value)} />
    </Item>
  );
}

// The readings of one row. Each edit keeps the reading; Drop leaves it out of the import.
function Readings({ smart, row, p, e }: { smart: SmartState; row: number; p: RowProposal; e: RowEdits }) {
  const edit = (change: Partial<RowEdits>) => smart.edit(row, change);
  return (
    <>
      {p.stage && e.stage && (
        <Item label="Stage" row={row} kept={e.stage.keep} onKeep={(keep) => edit({ stage: { ...e.stage!, keep } })} quotes={[p.stage]}>
          <LedgerMenu
            hideLabel
            label={`Stage for row ${row}`}
            value={e.stage.value}
            options={SMART_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            onChange={(value) => edit({ stage: { keep: true, value } })}
          />
        </Item>
      )}
      {p.lastContactedOn && e.last && (
        <DateItem
          label="Last contacted"
          row={row}
          kept={e.last.keep}
          value={e.last.value}
          quote={p.lastContactedOn}
          onKeep={(keep) => edit({ last: { ...e.last!, keep } })}
          onChange={(value) => edit({ last: { keep: true, value } })}
        />
      )}
      {p.followUpOn && e.follow && (
        <DateItem
          label="Follow up"
          row={row}
          kept={e.follow.keep}
          value={e.follow.value}
          quote={p.followUpOn}
          onKeep={(keep) => edit({ follow: { ...e.follow!, keep } })}
          onChange={(value) => edit({ follow: { keep: true, value } })}
        />
      )}
      {p.contact && e.contact && (
        <Item label="Contact" row={row} kept={e.contact.keep} onKeep={(keep) => edit({ contact: { ...e.contact!, keep } })} quotes={[p.contact]}>
          <div className="lg-smart-pair">
            <input
              className="lg-input"
              aria-label={`Contact name, row ${row}`}
              value={e.contact.value.name}
              maxLength={120}
              onChange={(ev) => edit({ contact: { keep: true, value: { ...e.contact!.value, name: ev.target.value } } })}
            />
            <input
              className="lg-input"
              aria-label={`Contact title, row ${row}`}
              placeholder="Title"
              value={e.contact.value.title}
              maxLength={120}
              onChange={(ev) => edit({ contact: { keep: true, value: { ...e.contact!.value, title: ev.target.value } } })}
            />
          </div>
        </Item>
      )}
      {p.note && e.note && (
        <Item label="Add to notes" row={row} kept={e.note.keep} onKeep={(keep) => edit({ note: { ...e.note!, keep } })} quotes={p.note.quotes}>
          <textarea
            className="lg-textarea lg-smart-note"
            aria-label={`Line added to the notes, row ${row}`}
            value={e.note.value}
            maxLength={SMART_NOTE_MAX}
            onChange={(ev) => edit({ note: { keep: true, value: ev.target.value } })}
          />
        </Item>
      )}
      {p.dropped.length > 0 && (
        <details className="lg-smart-dropped">
          <summary>
            {p.dropped.length} {p.dropped.length === 1 ? "reading" : "readings"} Coppice couldn&apos;t verify
          </summary>
          <ul>
            {p.dropped.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function RowCard({
  smart,
  row,
  p,
  dnc,
  group,
  choose,
}: {
  smart: SmartState;
  row: number;
  p: RowProposal | undefined;
  dnc: Quote | null;
  group: GroupRef | undefined;
  choose: (row: number, skip: boolean) => void;
}) {
  const notify = useNotify();
  const skipped = smart.skipsHas(row);
  const name = smart.names.get(row) ?? "";
  const readings = p && hasReading({ ...p, doNotContact: null });
  return (
    <div className="lg-group lg-smart-row" role="group" aria-labelledby={`smart-row-${row}`}>
      <div className="lg-group-head">
        <h4 id={`smart-row-${row}`} className="lg-group-q">
          Row {row}: {name}
        </h4>
        <span className="lg-dupstate" data-on={!skipped || undefined}>
          {skipped ? "Will skip" : "Will import"}
        </span>
      </div>
      {group && (
        <p className="lg-hint lg-smart-where">
          {dnc ? "The sheet says not to contact them. " : ""}Import or skip it in{" "}
          <a
            href="#"
            className="lg-link"
            onClick={(event) => {
              event.preventDefault();
              group.jump();
            }}
          >
            group {group.index} of the possible duplicates
          </a>
          .
        </p>
      )}
      {dnc && !group && <DoNotContact smart={smart} row={row} quote={dnc} />}
      {readings &&
        (skipped ? (
          <div className="lg-smart-skipped">
            <p>This row won&apos;t be imported, so what was read from it isn&apos;t used.</p>
            {!dnc && (
              <button
                type="button"
                className="lg-btn lg-btn-sm"
                onClick={() => {
                  choose(row, false);
                  notify(`${name || `Row ${row}`} will be imported after all.`);
                }}
              >
                Import it after all
              </button>
            )}
          </div>
        ) : (
          <Readings smart={smart} row={row} p={p} e={smart.edits[row] ?? {}} />
        ))}
    </div>
  );
}

export function SmartReview({
  smart,
  view,
  groupOf,
  choose,
}: {
  smart: SmartState;
  view: ImportPreview;
  // The duplicate group each row is in, if any.
  groupOf: (row: number) => GroupRef | undefined;
  choose: (row: number, skip: boolean) => void;
}) {
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
        {rows.length === 0
          ? "Nothing to review yet."
          : `${rows.length} ${rows.length === 1 ? "row has" : "rows have"} something to review. Every reading starts as Use and is applied when you import: leave out or change any that are wrong.`}
        {nothing > 0 && ` ${nothing} ${nothing === 1 ? "row" : "rows"} said nothing Coppice could check.`}
        {dropped > 0 && ` ${dropped} ${dropped === 1 ? "reading" : "readings"} Coppice couldn't verify ${dropped === 1 ? "is" : "are"} listed under ${dropped === 1 ? "its row" : "their rows"} and won't be imported.`}{" "}
        {futureHint(smart.proposals, session.cycleStart)} Coppice never imports Committed or Declined, and never logs outreach or claims a
        company.
      </p>
      {rows.map((row) => {
        const p = byRow.get(row);
        const dnc = p?.doNotContact ?? session.doNotContact.find((d) => d.row === row) ?? null;
        return <RowCard key={row} smart={smart} row={row} p={p} dnc={dnc} group={groupOf(row)} choose={choose} />;
      })}
    </div>
  );
}
