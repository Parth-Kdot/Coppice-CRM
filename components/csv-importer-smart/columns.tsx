"use client";

import { WarningIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { ErrorLine } from "@/components/ledger/shared";
import type { ImportPreview } from "@/lib/csv";
import type { SmartStart } from "@/lib/smart-import";
import { SMART_MAX_ROWS } from "@/lib/validation";
import { readingMatches, type SmartActions, type SmartState } from "./use-smart-import";
import "@/components/ledger/smart-import.css";

// Step 2 of the importer with Smart import on: the switch, the columns to read, the sheet's board
// year, and how far the reading has got.

function FreeTextColumns({ smart, view }: { smart: SmartState; view: ImportPreview }) {
  return (
    <fieldset className="lg-smart-cols">
      <legend className="lg-label">Columns to read</legend>
      {view.headers.map((header, index) => {
        // The server refuses these too (lib/smart-import/start.ts).
        const taken = index === view.mapping.name || index === view.mapping.contactEmail || index === view.mapping.website;
        return (
          <label key={index} className="lg-smart-col" data-off={taken || undefined}>
            <input
              type="checkbox"
              className="lg-check"
              disabled={taken || smart.busy}
              checked={smart.freeText.includes(index)}
              onChange={(e) => {
                smart.discardReading();
                smart.setFreeText(e.target.checked ? [...smart.freeText, index].sort((a, b) => a - b) : smart.freeText.filter((c) => c !== index));
              }}
            />
            <span>{header.trim() || `Column ${index + 1}`}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function BoardYear({ smart, actions }: { smart: SmartState; actions: SmartActions }) {
  const { options } = actions;
  return (
    <div className="lg-smart-year" id="smart-year">
      <p className="lg-maplabel" aria-hidden="true">
        The sheet is from
      </p>
      <LedgerMenu
        hideLabel
        label="The board year the sheet is from"
        value={String(smart.cycle)}
        options={options.cycles.map((c) => ({ value: String(c.start), label: c.start === options.current ? `${c.label} (this year)` : c.label }))}
        onChange={(value) => {
          smart.discardReading();
          smart.setCycle(Number(value));
        }}
      />
      {smart.cycle < options.current && (
        <p className="lg-hint">An earlier year&apos;s sheet comes back as fresh leads: Not contacted, with what the sheet said added to the notes.</p>
      )}
    </div>
  );
}

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
        <input type="checkbox" className="lg-check" checked={smart.on} disabled={smart.busy || pending} onChange={(e) => smart.turn(e.target.checked, view)} />
        <span>Read the free-text columns with AI</span>
      </label>
      <p className="lg-hint lg-smart-say">
        Coppice reads notes like &ldquo;emailed 3/2 by Sam, said reach out in Aug&rdquo; and proposes a stage, dates and a contact, each with the text it came from.
        You use, change or leave out each one. Up to {SMART_MAX_ROWS} rows with free text are read per import; the rest import the normal way.
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
            What is sent: to suggest the columns, Google&apos;s Gemini gets the headers only when they are plain spreadsheet words (otherwise their shape,
            like &ldquo;2 words&rdquo;), the company names and industries from columns plainly labeled as such (like &ldquo;Company&rdquo; or
            &ldquo;Industry&rdquo;), and for up to 15 sample rows only the shape of the other cells (like &ldquo;6 words, has a date&rdquo;), not their words. Gemini also gets the company names to spot look-alikes. The free-text
            cells, which can include names, go to Groq, with email addresses and phone numbers masked.
          </p>
          {smart.mappingNote && (
            <div className="lg-smart-mapnote" role="status">
              <p>
                {smart.mappingNote.changes.join(". ")}.
                {smart.mappingNote.why && ` ${smart.mappingNote.why}`}
              </p>
              <button type="button" className="lg-btn lg-btn-sm" disabled={smart.busy || pending} onClick={() => smart.undoMapping(view.mapping)}>
                Undo
              </button>
            </div>
          )}
          {smart.note && <p className="lg-hint">{smart.note}</p>}
          <FreeTextColumns smart={smart} view={view} />
          <BoardYear smart={smart} actions={actions} />
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
      {session.lookalikeNote && <p className="lg-hint mt-1">{session.lookalikeNote}</p>}
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
