import { Fragment, type ReactNode } from "react";
import { formatCount, formatPct, formatRange, MATURITY_DAYS, MIN_SENDS, topParts, type Part, type Rated, type TemplateLine } from "@/lib/stats-math";
import { Disclosure } from "./disclosure";
import "./pages.css";
import "./stats.css";

// The pieces of the stats page: a rate with its likely range drawn as a small ruled bar, the
// templates table (optionally split by industry or touch) and the small comparison table. Server
// components; the numbers all come from lib/stats-math.ts.
//
// Four columns: the name, the reply rate, the likely range (a bar, with the counts in its tooltip
// and for screen readers) and the standing. On a phone a row shows the name, the rate and the bar,
// and "Details" opens the counts.

// The likely range on a 0 to 100% rule: a bar from low to high and a tick at the rate. Drawn with SVG
// attributes, not inline styles, so the strict style policy allows it.
export function RangeBar({ stat }: { stat: Rated }) {
  if (!stat.interval || stat.rate === null) return null;
  const x = (v: number) => Math.round(v * 1000) / 10;
  return (
    <svg
      className="lg-rangebar"
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-rated={stat.status === "rated" || undefined}
    >
      <line x1="0" y1="6" x2="100" y2="6" className="lg-rangebar-rule" />
      <line x1="50" y1="3" x2="50" y2="9" className="lg-rangebar-mid" />
      <rect x={x(stat.interval.low)} y="3" width={Math.max(0.8, x(stat.interval.high) - x(stat.interval.low))} height="6" className="lg-rangebar-band" />
      <line x1={x(stat.rate)} y1="0" x2={x(stat.rate)} y2="12" className="lg-rangebar-tick" />
    </svg>
  );
}

export type Standing = "best" | "worst" | null;

// "880 counted sends, 264 replies, 12 still maturing".
function countsText(stat: Rated): string {
  const parts = [
    `${formatCount(stat.counted)} counted ${stat.counted === 1 ? "send" : "sends"}`,
    `${formatCount(stat.replies)} ${stat.replies === 1 ? "reply" : "replies"}`,
  ];
  if (stat.maturing > 0) parts.push(`${formatCount(stat.maturing)} still maturing`);
  return parts.join(", ");
}

function standingOf(stat: Rated, standing: Standing): ReactNode {
  if (stat.status === "none") return <span className="lg-muted">No sends yet</span>;
  if (stat.status === "too_few") {
    return (
      <span className="lg-standing">
        <span className="lg-badge lg-badge-stale">Too few yet</span>
        <span className="lg-hint">
          {formatCount(stat.counted)} of {MIN_SENDS} sends
        </span>
      </span>
    );
  }
  if (standing === "best") return <span className="lg-badge lg-best">Best</span>;
  if (standing === "worst") return <span className="lg-badge lg-worst">Worst</span>;
  return <span className="lg-muted">Rated</span>;
}

// The cells after the name, the same for a template, a split row and the comparison table.
function StatCells({ stat, standing = null, rated = true }: { stat: Rated; standing?: Standing; rated?: boolean }) {
  const counts = stat.sent > 0 ? countsText(stat) : "No sends yet";
  return (
    <>
      <td data-label="Reply rate" className="lg-num lg-c-rate">
        {stat.rate === null ? (
          <span className="lg-muted">
            <span aria-hidden="true">-</span>
            <span className="lg-sr">None yet</span>
          </span>
        ) : (
          <span className={stat.status === "rated" ? "" : "lg-muted"}>{formatPct(stat.rate)}</span>
        )}
      </td>
      <td data-label="Likely range" className="lg-c-range" title={stat.interval ? `${formatRange(stat.interval)}. ${counts}.` : counts}>
        {stat.interval ? (
          <span className="lg-range">
            <span className="lg-num lg-range-text">{formatRange(stat.interval)}</span>
            <RangeBar stat={stat} />
            <span className="lg-sr">{counts}</span>
          </span>
        ) : (
          <span className="lg-muted">None yet</span>
        )}
      </td>
      <td data-label="Standing" className="lg-c-standing">
        <span className="lg-cell">{rated ? standingOf(stat, standing) : <span className="lg-muted">Never ranked</span>}</span>
      </td>
    </>
  );
}

// The same column widths in the table and in an industry list folded inside it, so they line up.
function Cols() {
  return (
    <colgroup>
      <col className="lg-col-name" />
      <col className="lg-col-rate" />
      <col className="lg-col-range" />
      <col className="lg-col-standing" />
    </colgroup>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Reply rate</th>
        <th scope="col">Likely range</th>
        <th scope="col">Standing</th>
      </tr>
    </thead>
  );
}

// The name cell: the name, and on a phone a "Details" line that opens the counts.
function NameCell({ label, children, stat, sub = false }: { label: string; children: ReactNode; stat: Rated; sub?: boolean }) {
  return (
    <td data-label={label} className="lg-c-name">
      <span className="lg-cell">
        {sub ? <span className="lg-subname">{children}</span> : children}
        {stat.sent > 0 && (
          <span className="lg-statdetails">
            <Disclosure variant="inline" summary="Details">
              <span className="lg-cellsub">{countsText(stat)}</span>
            </Disclosure>
          </span>
        )}
      </span>
    </td>
  );
}

const SHOWN_PARTS = 5;

function PartRows({ parts, split, owner }: { parts: Part[]; split: "industry" | "touch"; owner: string }) {
  const row = (part: Part) => (
    <tr key={part.label} className="lg-subrow">
      <NameCell label="Split" stat={part.stat} sub>
        {part.label}
      </NameCell>
      <StatCells stat={part.stat} />
    </tr>
  );
  if (split === "touch" || parts.length <= SHOWN_PARTS) return parts.map(row);
  // By industry: the five with the most counted sends, by rate; the rest one click away.
  const { top, rest } = topParts(parts, SHOWN_PARTS);
  return (
    <>
      {top.map(row)}
      <tr className="lg-subrow lg-subrow-more">
        <td colSpan={4}>
          <Disclosure variant="inline" summary={`Show all ${parts.length} industries for ${owner}`}>
            <table className="lg-table lg-stattable lg-stattable-inner">
              <Cols />
              <tbody>{rest.map(row)}</tbody>
            </table>
          </Disclosure>
        </td>
      </tr>
    </>
  );
}

export function TemplatesTable({
  lines,
  noTemplate,
  best,
  worst,
  split,
  rowMenu,
}: {
  lines: TemplateLine[];
  noTemplate: TemplateLine;
  best: string | null;
  worst: string | null;
  split: "none" | "industry" | "touch";
  // A menu after a template's name (owners' "Try a variant"), or nothing.
  rowMenu?: (line: TemplateLine) => ReactNode;
}) {
  const nameCell = (line: TemplateLine) => (
    <NameCell label="Template" stat={line.stat}>
      <strong className="lg-wrap-any">{line.name}</strong>
      {line.archived && <span className="lg-badge lg-badge-stale lg-ml">Retired</span>}
      {rowMenu?.(line)}
    </NameCell>
  );
  return (
    <div className="lg-tablewrap">
      <table className="lg-table lg-stattable">
        <Cols />
        <Head first="Template" />
        <tbody>
          {lines.map((line) => (
            <Fragment key={line.key}>
              <tr className="lg-mainrow">
                {nameCell(line)}
                <StatCells stat={line.stat} standing={line.key === best ? "best" : line.key === worst ? "worst" : null} />
              </tr>
              {split !== "none" && <PartRows parts={line.parts} split={split} owner={line.name} />}
            </Fragment>
          ))}
        </tbody>
        {noTemplate.stat.sent > 0 && (
          <tbody className="lg-notemplate">
            <tr className="lg-mainrow">
              <NameCell label="Template" stat={noTemplate.stat}>
                <strong>No template</strong>
              </NameCell>
              <StatCells stat={noTemplate.stat} rated={false} />
            </tr>
            {split !== "none" && <PartRows parts={noTemplate.parts} split={split} owner="No template" />}
          </tbody>
        )}
      </table>
    </div>
  );
}

// A small table for one comparison (AI-drafted against hand-written).
export function CompareTable({ first, rows }: { first: string; rows: { label: string; stat: Rated; standing?: Standing }[] }) {
  return (
    <div className="lg-tablewrap">
      <table className="lg-table lg-stattable">
        <Cols />
        <Head first={first} />
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="lg-mainrow">
              <NameCell label={first} stat={row.stat}>
                <strong>{row.label}</strong>
              </NameCell>
              <StatCells stat={row.stat} standing={row.standing ?? null} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const RULES_NOTE = [
  `A send counts once it is ${MATURITY_DAYS} days old, so a recent email with no answer yet isn't held against its template. Younger sends show as maturing.`,
  `A template is rated only after ${MIN_SENDS} counted sends. Below that it says "too few yet" and isn't ranked.`,
  "The likely range is a 95% Wilson interval: where the true reply rate probably sits. Small samples give wide ranges.",
  "Best and worst are named only when one template's whole range sits above (or below) every other rated template's range. Overlapping ranges mean the data can't tell them apart yet, so nothing is called. Retired templates are never named.",
  'A reply counts when someone marks which outreach got it (asked when a company moves to Replied or later, or "This got the reply" on the company page).',
  "An AI draft based on a template is counted under AI-drafted, not under that template, so a template's sends are only the emails logged with it by hand.",
];
