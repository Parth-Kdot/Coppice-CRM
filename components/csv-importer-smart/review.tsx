"use client";

import type { ReactNode } from "react";
import { ChipGroup } from "@/components/ledger/chips";
import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import type { ImportPreview } from "@/lib/csv";
import type { Quote, RowProposal, SmartStart } from "@/lib/smart-import";
import { STAGE_LABELS } from "@/lib/stages";
import { SMART_NOTE_MAX, SMART_STAGES } from "@/lib/validation";
import { hasReading, readingMatches, type RowEdits, type SmartState } from "./use-smart-import";
import "@/components/ledger/smart-import.css";

// Step 3 of the importer with Smart import on: what was read, one card per row, each reading with
// the cell text it came from and Keep or Drop.

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

function DoNotContact({ smart, row, quote }: { smart: SmartState; row: number; quote: Quote }) {
  return (
    <div className="lg-smart-item lg-smart-dnc">
      <p className="lg-tag lg-late">
        <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
        Do not contact
      </p>
      <div className="lg-smart-ctl">
        <p>The sheet says not to contact them. It is skipped unless you choose to import it anyway.</p>
        <Source quotes={[quote]} />
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
            {p.dropped.length} {p.dropped.length === 1 ? "reading" : "readings"} dropped
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

function RowCard({ smart, row, p, dnc }: { smart: SmartState; row: number; p: RowProposal | undefined; dnc: Quote | null }) {
  return (
    <div className="lg-group lg-smart-row" role="group" aria-labelledby={`smart-row-${row}`}>
      <div className="lg-group-head">
        <h4 id={`smart-row-${row}`} className="lg-group-q">
          Row {row}: {smart.names.get(row) ?? ""}
        </h4>
        {smart.skipsHas(row) && <span className="lg-tag lg-muted">Skipped</span>}
      </div>
      {dnc && <DoNotContact smart={smart} row={row} quote={dnc} />}
      {p && <Readings smart={smart} row={row} p={p} e={smart.edits[row] ?? {}} />}
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
        {rows.length === 0 ? "Nothing to review yet." : `${rows.length} ${rows.length === 1 ? "row has" : "rows have"} something to review. Every reading starts as Keep and is applied when you import: drop or change any that are wrong.`}
        {nothing > 0 && ` ${nothing} ${nothing === 1 ? "row" : "rows"} said nothing Coppice could check.`}
        {dropped > 0 && ` ${dropped} ${dropped === 1 ? "reading was" : "readings were"} dropped because the quote or date didn't check out.`} Coppice never imports
        Committed or Declined, and never logs outreach or claims a company.
      </p>
      {rows.map((row) => {
        const p = byRow.get(row);
        const dnc = p?.doNotContact ?? session.doNotContact.find((d) => d.row === row) ?? null;
        return <RowCard key={row} smart={smart} row={row} p={p} dnc={dnc} />;
      })}
    </div>
  );
}
