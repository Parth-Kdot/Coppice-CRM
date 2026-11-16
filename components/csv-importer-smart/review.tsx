"use client";

import { ImportChoice } from "@/components/csv-importer-choice";
import { WarningIcon } from "@/components/ledger/icons";
import { useNotify } from "@/components/ledger/providers";
import type { ImportPreview } from "@/lib/csv";
import type { Quote, RowProposal, SmartStart } from "@/lib/smart-import";
import { futureHint } from "@/lib/smart-import/dates";
import { Readings, Source } from "./readings";
import { hasReading, readingMatches, type SmartState } from "./use-smart-import";
import "@/components/ledger/smart-import.css";

// Step 3 of the importer with Smart import on: what was read, one card per row, each reading with
// the cell text it came from and Use or Leave out. A row's import choice lives in one place: in
// its duplicate group when it has one, otherwise here for a do-not-contact row. A skipped row's
// readings are folded away, since nothing of a skipped row is imported.

// Where a row's import choice is decided, when it is in a duplicate group.
export type GroupRef = { index: number; jump: () => void };

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

// This board year's sheet says they committed or declined: skipped unless the person imports it
// anyway (as Not contacted, with the note), so nobody pitches them again by mistake.
function Outcome({ smart, row, outcome }: { smart: SmartState; row: number; outcome: NonNullable<RowProposal["outcome"]> }) {
  const skipped = smart.skipsHas(row);
  return (
    <div className="lg-smart-item lg-smart-dnc">
      <p className="lg-tag">{outcome.value === "committed" ? "Committed" : "Declined"}</p>
      <div className="lg-smart-ctl">
        <p>The sheet says they {outcome.value}, so it is skipped unless you import it anyway.</p>
        <Source quotes={[outcome]} />
      </div>
      <ImportChoice
        className="lg-smart-choice"
        question="Import it anyway?"
        value={skipped ? "skip" : "import"}
        onChange={(value) => smart.accept(row, value === "import")}
        caption={skipped ? "Not imported." : "Imported as Not contacted, with the line below in its notes."}
        options={[
          { value: "skip", label: "Skip", ariaLabel: `Skip row ${row}` },
          { value: "import", label: "Import anyway", ariaLabel: `Import row ${row} anyway` },
        ]}
      />
    </div>
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
  const outcome = !dnc && p?.outcome ? p.outcome : null;
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
          {dnc ? "The sheet says not to contact them. " : outcome ? `The sheet says they ${outcome.value}. ` : ""}Import or skip it in{" "}
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
      {outcome && !group && <Outcome smart={smart} row={row} outcome={outcome} />}
      {readings &&
        (skipped ? (
          <div className="lg-smart-skipped">
            <p>This row won&apos;t be imported, so what was read from it isn&apos;t used.</p>
            {/* In a group, the group is where it is imported or skipped; for a do-not-contact row, the line above. */}
            {!dnc && !outcome && !group && (
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
  onYear,
}: {
  smart: SmartState;
  view: ImportPreview;
  // The duplicate group each row is in, if any.
  groupOf: (row: number) => GroupRef | undefined;
  choose: (row: number, skip: boolean) => void;
  // Goes to the board year menu in step 2, from the hint that the sheet may be from the year before.
  onYear: () => void;
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
  const hint = futureHint(smart.proposals, session.cycleStart);

  return (
    <div className="lg-groups">
      <h3 className="lg-h3">What Smart import read</h3>
      <p className="lg-hint mb-3">
        {rows.length === 0
          ? "Nothing to review yet."
          : `${rows.length} ${rows.length === 1 ? "row has" : "rows have"} something to review. Every reading starts as Use and is applied when you import: leave out or change any that are wrong.`}
        {nothing > 0 && ` ${nothing} ${nothing === 1 ? "row" : "rows"} said nothing Coppice could check.`}
        {dropped > 0 && ` ${dropped} ${dropped === 1 ? "reading" : "readings"} Coppice couldn't verify ${dropped === 1 ? "is" : "are"} listed under ${dropped === 1 ? "its row" : "their rows"} and won't be imported.`}{" "}
        Coppice never imports Committed or Declined, and never logs outreach or claims a company.
      </p>
      {hint && (
        <p className="lg-smart-yearhint" role="note">
          <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
          {hint}{" "}
          <a
            href="#"
            className="lg-link"
            onClick={(event) => {
              event.preventDefault();
              onYear();
            }}
          >
            Change the sheet&apos;s year
          </a>
        </p>
      )}
      {rows.map((row) => {
        const p = byRow.get(row);
        const dnc = p?.doNotContact ?? session.doNotContact.find((d) => d.row === row) ?? null;
        return <RowCard key={row} smart={smart} row={row} p={p} dnc={dnc} group={groupOf(row)} choose={choose} />;
      })}
    </div>
  );
}
