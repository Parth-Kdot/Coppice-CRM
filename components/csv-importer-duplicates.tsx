"use client";

import Link from "next/link";
import { ChipGroup } from "@/components/ledger/chips";
import type { ExistingMatch } from "@/lib/csv";

// The import's duplicate review (components/csv-importer.tsx): each group of rows that may be the
// same company as each other or as one already saved, with why, and Import or Skip per row. The
// exact matches from lib/csv.ts and Smart import's look-alikes (lib/smart-import/lookalikes.ts)
// share it. Nothing is merged: importing a look-alike keeps both as separate companies.

export type ShownGroup = {
  key: string;
  reason: string;
  existing: ExistingMatch[];
  rows: { row: number; name: string; website: string | null }[];
};

function ExistingCard({ workspaceId, company }: { workspaceId: string; company: ExistingMatch }) {
  return (
    <div className="lg-dupcard lg-dupcard-have">
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
  );
}

function RowCard({ entry, skipped, choose }: { entry: ShownGroup["rows"][number]; skipped: boolean; choose: (row: number, skip: boolean) => void }) {
  const { row } = entry;
  return (
    <div className="lg-dupcard" data-skipped={skipped || undefined}>
      <p className="lg-tag lg-muted">In your file, row {row}</p>
      <p className="lg-dupname">
        <span className="lg-nametext">
          Row {row}: {entry.name}
        </span>
      </p>
      <p className="lg-dupsite">{entry.website ? `(${entry.website})` : "No website"}</p>
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
}

export function DuplicateGroups({
  idPrefix,
  workspaceId,
  groups,
  skips,
  choose,
}: {
  idPrefix: string;
  workspaceId: string;
  groups: ShownGroup[];
  skips: Set<number>;
  choose: (row: number, skip: boolean) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="lg-groups">
      <h3 className="lg-h3">Possible duplicates</h3>
      <p className="lg-hint mb-3">Choose Import or Skip for each row. Importing a look-alike keeps both as separate companies.</p>
      {groups.map((group, gi) => (
        <div key={group.key} className="lg-group" role="group" aria-labelledby={`${idPrefix}-g${gi}`}>
          <div className="lg-group-head">
            <h4 id={`${idPrefix}-g${gi}`} className="lg-group-q">
              Same company?
            </h4>
            <span className="lg-tag lg-muted">{group.reason}</span>
          </div>
          <div className="lg-group-cols">
            {group.existing.map((company) => (
              <ExistingCard key={company.id} workspaceId={workspaceId} company={company} />
            ))}
            {group.rows.map((entry) => (
              <RowCard key={entry.row} entry={entry} skipped={skips.has(entry.row)} choose={choose} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
