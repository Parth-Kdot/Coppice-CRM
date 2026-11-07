"use client";

import { Fragment } from "react";
import { ImportChoice } from "@/components/csv-importer-choice";
import { ExternalIcon, WarningIcon } from "@/components/ledger/icons";
import type { ExistingMatch } from "@/lib/csv";
import { nameIn, type ReviewGroup } from "@/lib/import-review";
import type { Quote } from "@/lib/smart-import";

// The cards inside a duplicate group (components/csv-importer-duplicates.tsx): a company already
// in Coppice, and a row of the file with its own switch when the group is decided row by row.

// A website that can break after its dots and slashes, so a long one wraps between its parts.
function Site({ url }: { url: string | null }) {
  if (!url) return <>No website</>;
  return (
    <>
      {url.split(/(?<=[./])/).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function ExistingCard({ workspaceId, company }: { workspaceId: string; company: ExistingMatch }) {
  return (
    <div className="lg-dupcard lg-dupcard-have">
      <p className="lg-tag lg-muted">Already in Coppice</p>
      <p className="lg-dupname">
        <a href={`/${workspaceId}/companies/${company.id}`} target="_blank" rel="noopener noreferrer" className="lg-link">
          {company.name}
          <ExternalIcon size={13} className="ml-1 inline-block align-[-1px]" aria-hidden="true" />
          <span className="lg-sr"> (opens in a new tab)</span>
        </a>
      </p>
      <p className="lg-dupsite">
        <Site url={company.website} />
        {company.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
      </p>
    </div>
  );
}

function DoNotContactLine({ quote }: { quote: Quote }) {
  return (
    <p className="lg-dupdnc">
      <WarningIcon size={14} className="mr-1 inline-block align-[-2px]" />
      The sheet says not to contact them: <q className="lg-quote">{quote.quote}</q>. Importing it means you accept that.
    </p>
  );
}

export function RowCard({
  group,
  entry,
  skipped,
  choose,
  dnc,
  withSwitch,
}: {
  group: ReviewGroup;
  entry: ReviewGroup["rows"][number];
  skipped: boolean;
  choose: (row: number, skip: boolean) => void;
  dnc: Quote | undefined;
  withSwitch: boolean;
}) {
  const { row } = entry;
  return (
    <div className="lg-dupcard" data-skipped={skipped || undefined}>
      <p className="lg-dupcard-top">
        <span className="lg-tag lg-muted">In your file, row {row}</span>
        {/* With its own switch the switch says it; otherwise one tag does. */}
        {!withSwitch && (
          <span className="lg-dupstate" data-on={!skipped || undefined}>
            {skipped ? "Will skip" : "Will import"}
          </span>
        )}
      </p>
      <p className="lg-dupname">
        <span className="lg-nametext">{nameIn(group, row)}</span>
      </p>
      <p className="lg-dupsite">
        <Site url={entry.website} />
      </p>
      {dnc && <DoNotContactLine quote={dnc} />}
      {withSwitch && (
        <ImportChoice
          className="lg-dupchoice"
          question="Import this row?"
          value={skipped ? "skip" : "import"}
          onChange={(value) => choose(row, value === "skip")}
          options={[
            { value: "import", label: "Will import", ariaLabel: `Import row ${row}` },
            { value: "skip", label: "Will skip", ariaLabel: `Skip row ${row}` },
          ]}
        />
      )}
    </div>
  );
}
