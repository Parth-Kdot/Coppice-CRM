"use client";

import type { ReactNode } from "react";
import { ImportChoice } from "@/components/csv-importer-choice";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import type { Quote, RowProposal } from "@/lib/smart-import";
import { STAGE_LABELS } from "@/lib/stages";
import { SMART_NOTE_MAX, SMART_STAGES } from "@/lib/limits";
import type { RowEdits, SmartState } from "./use-smart-import";

// One row's readings in Smart import's review (./review.tsx): each with the cell text it came
// from, and Use or Leave out.

export function Source({ quotes }: { quotes: Quote[] }) {
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

// "Mar 2", for the line under a date that was moved.
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function DateItem({
  label,
  row,
  kept,
  value,
  quote,
  moved,
  onKeep,
  onChange,
}: {
  label: string;
  row: number;
  kept: boolean;
  value: string;
  quote: Quote;
  // Said under the date when code moved it to another year than the sheet's.
  moved?: string;
  onKeep: (keep: boolean) => void;
  onChange: (value: string) => void;
}) {
  return (
    <Item label={label} row={row} kept={kept} onKeep={onKeep} quotes={[quote]}>
      <input type="date" className="lg-input lg-smart-date" aria-label={`${label}, row ${row}`} value={value} onChange={(ev) => onChange(ev.target.value)} />
      {moved && <p className="lg-hint lg-smart-moved">{moved}</p>}
    </Item>
  );
}

// The readings of one row. Each edit keeps the reading; Drop leaves it out of the import.
export function Readings({ smart, row, p, e }: { smart: SmartState; row: number; p: RowProposal; e: RowEdits }) {
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
          // `future` with a date kept means code moved it back: in the sheet's year it would be ahead of today.
          moved={
            p.future && e.last.value === p.lastContactedOn.date
              ? `No year was written, so this is the most recent ${shortDay(p.lastContactedOn.date)} that isn't in the future.`
              : undefined
          }
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
