import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { MATURITY_DAYS, MIN_SENDS, type Interval, type Part, type Rated, type TemplateLine } from "@/lib/stats-math";
import "./pages.css";
import "./stats.css";

// The pieces of the stats page: a rate with its likely range drawn as a small ruled bar, the
// templates table (optionally split by industry or touch), and the short tables under it. Server
// components; the numbers all come from lib/stats-math.ts.

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const rangeText = (i: Interval) => `${pct(i.low)} to ${pct(i.high)}`;

// The likely range on a 0 to 100% rule: a bar from low to high and a tick at the rate. Drawn with SVG
// attributes, not inline styles, so the strict style policy allows it.
function RangeBar({ stat }: { stat: Rated }) {
  if (!stat.interval || stat.rate === null) return null;
  const x = (v: number) => Math.round(v * 1000) / 10;
  return (
    <svg className="lg-rangebar" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false" data-rated={stat.status === "rated" || undefined}>
      <line x1="0" y1="6" x2="100" y2="6" className="lg-rangebar-rule" />
      <line x1="50" y1="3" x2="50" y2="9" className="lg-rangebar-mid" />
      <rect x={x(stat.interval.low)} y="3" width={Math.max(0.8, x(stat.interval.high) - x(stat.interval.low))} height="6" className="lg-rangebar-band" />
      <line x1={x(stat.rate)} y1="0" x2={x(stat.rate)} y2="12" className="lg-rangebar-tick" />
    </svg>
  );
}

export type Standing = "best" | "worst" | null;

function standingOf(stat: Rated, standing: Standing): ReactNode {
  if (stat.status === "none") return <span className="lg-muted">No sends yet</span>;
  if (stat.status === "too_few") {
    return (
      <span className="lg-standing">
        <span className="lg-badge lg-badge-stale">Not enough data yet</span>
        <span className="lg-hint">
          {stat.counted} of {MIN_SENDS} counted sends
        </span>
      </span>
    );
  }
  if (standing === "best") return <span className="lg-badge lg-best">Best</span>;
  if (standing === "worst") return <span className="lg-badge lg-worst">Worst</span>;
  return <span className="lg-muted">Rated</span>;
}

// The cells after the name, the same for a template, a split row and the comparison tables.
function StatCells({ stat, standing = null, rated = true }: { stat: Rated; standing?: Standing; rated?: boolean }) {
  return (
    <>
      <td data-label="Counted" className="lg-num">
        <span className="lg-cell">
          {stat.counted}
          {stat.maturing > 0 && <span className="lg-cellsub">+{stat.maturing} maturing</span>}
        </span>
      </td>
      <td data-label="Replies" className="lg-num">
        {stat.replies}
      </td>
      <td data-label="Reply rate" className="lg-num">
        {stat.rate === null ? <span className="lg-muted">None yet</span> : <span className={stat.status === "rated" ? "" : "lg-muted"}>{pct(stat.rate)}</span>}
      </td>
      <td data-label="Likely range" className="lg-c-range">
        {stat.interval ? (
          <span className="lg-range">
            <span className="lg-num">{rangeText(stat.interval)}</span>
            <RangeBar stat={stat} />
          </span>
        ) : (
          <span className="lg-muted">None yet</span>
        )}
      </td>
      <td data-label="Standing">
        <span className="lg-cell">{rated ? standingOf(stat, standing) : <span className="lg-muted">Never ranked</span>}</span>
      </td>
    </>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col">Counted sends</th>
        <th scope="col">Replies</th>
        <th scope="col">Reply rate</th>
        <th scope="col">Likely range (95%)</th>
        <th scope="col">Standing</th>
      </tr>
    </thead>
  );
}

function PartRows({ parts }: { parts: Part[] }) {
  return parts.map((part) => (
    <tr key={part.label} className="lg-subrow">
      <td data-label="Split" className="lg-c-name">
        <span className="lg-subname">{part.label}</span>
      </td>
      <StatCells stat={part.stat} />
    </tr>
  ));
}

export function TemplatesTable({ lines, noTemplate, best, worst }: { lines: TemplateLine[]; noTemplate: TemplateLine; best: string | null; worst: string | null }) {
  const nameCell = (line: TemplateLine) => (
    <td data-label="Template" className="lg-c-name">
      <span className="lg-cell">
        <strong>{line.name}</strong>
        {line.archived && <span className="lg-badge lg-badge-stale lg-ml">Archived</span>}
      </span>
    </td>
  );
  return (
    <div className="lg-tablewrap">
      <table className="lg-table lg-stattable">
        <Head first="Template" />
        <tbody>
          {lines.map((line) => (
            <Fragment key={line.key}>
              <tr className="lg-mainrow">
                {nameCell(line)}
                <StatCells stat={line.stat} standing={line.key === best ? "best" : line.key === worst ? "worst" : null} />
              </tr>
              <PartRows parts={line.parts} />
            </Fragment>
          ))}
        </tbody>
        {noTemplate.stat.sent > 0 && (
          <tbody className="lg-notemplate">
            <tr className="lg-mainrow">
              <td data-label="Template" className="lg-c-name">
                <span className="lg-cell">
                  <strong>No template</strong>
                  <span className="lg-cellsub">Logged without one</span>
                </span>
              </td>
              <StatCells stat={noTemplate.stat} rated={false} />
            </tr>
            <PartRows parts={noTemplate.parts} />
          </tbody>
        )}
      </table>
    </div>
  );
}

// A small table for one comparison (AI-drafted against hand-written, or touch by touch).
export function CompareTable({ first, rows }: { first: string; rows: { label: string; stat: Rated; standing?: Standing }[] }) {
  return (
    <div className="lg-tablewrap">
      <table className="lg-table lg-stattable">
        <Head first={first} />
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="lg-mainrow">
              <td data-label={first} className="lg-c-name">
                <strong>{row.label}</strong>
              </td>
              <StatCells stat={row.stat} standing={row.standing ?? null} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The All / By industry / By touch switch: links, so the view lives in the URL.
export function SplitSwitch({ base, current }: { base: string; current: "none" | "industry" | "touch" }) {
  const options = [
    { value: "none", label: "All", href: base },
    { value: "industry", label: "By industry", href: `${base}?by=industry` },
    { value: "touch", label: "By touch", href: `${base}?by=touch` },
  ] as const;
  return (
    <nav className="lg-splits" aria-label="Split each template">
      {options.map((o) => (
        <Link key={o.value} href={o.href} scroll={false} className="lg-split" aria-current={o.value === current ? "page" : undefined}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

export const RULES_NOTE = [
  `A send counts once it is ${MATURITY_DAYS} days old, so a recent email with no answer yet isn't held against its template. Younger sends show as maturing.`,
  `A template is rated only after ${MIN_SENDS} counted sends. Below that it says "not enough data yet" and isn't ranked.`,
  "The likely range is a 95% Wilson interval: where the true reply rate probably sits. Small samples give wide ranges.",
  "Best and worst are named only when one template's whole range sits above (or below) every other rated template's range. Overlapping ranges mean the data can't tell them apart yet, so nothing is called.",
  'A reply counts when someone marks which outreach got it (asked when a company moves to Replied or later, or "This got the reply" on the company page).',
  "An AI draft based on a template is counted under AI-drafted, not under that template, so a template's sends are only the emails logged with it by hand.",
];
