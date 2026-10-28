import { Ribbon, Tick, TurnoverRule } from "../marks";
import { SEASONS } from "./copy";

// The two pages of the book in How it works. Captions (with their beats) on the left page, one pane
// per step on the right page: the old sheet, the claim ticket, the ledger with the log entry and the
// chair line. The markup is the finished state of every beat; seasons-timeline.ts plays it from empty.
// Every part the timeline moves has an ld- class named for the part, not for the season.

// A chip that is selected shows its label twice: the quiet one underneath, and an ink layer on top
// that the timeline fades in when the chip is picked.
function Chip({ label, on, className = "" }: { label: string; on: boolean; className?: string }) {
  return (
    <span className={`ld-pick ${className}`} data-on={on}>
      {label}
      {on && (
        <>
          <span className="ld-pick-on" aria-hidden="true">
            {label}
          </span>
          <span className="sr-only">, selected</span>
        </>
      )}
    </span>
  );
}

// Kestrel's stage glyph: a ring with the first quarter filled (Contacted) and the second quarter
// added when the reply is logged (Replied).
function DueGlyph() {
  return (
    <svg className="ld-due-glyph" width={18} height={18} viewBox="-8 -8 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle r={5.2} />
      <path d="M0 0V-5.2A5.2 5.2 0 0 1 5.2 0z" fill="currentColor" />
      <path className="ld-glyph-q2" d="M0 0H5.2A5.2 5.2 0 0 1 0 5.2z" fill="currentColor" />
    </svg>
  );
}

export function Captions() {
  return (
    <ol className="ld-captions">
      {SEASONS.steps.map((s, i) => (
        <li key={s.season} className="ld-caption" data-i={i}>
          <p className="lg-sc ld-caption-season">
            {s.season}, step {i + 1} of 4
          </p>
          <h3 className="ld-h3">{s.title}</h3>
          <p>{s.body}</p>
          <ul className="ld-beats">
            {s.beats.map((beat) => (
              <li key={beat} className="ld-beat">
                <span className="ld-beat-mark">
                  <Tick size={14} auto={false} className="ld-tick" />
                </span>
                <span>{beat}</span>
              </li>
            ))}
          </ul>
          <p className="ld-caption-who lg-sc">{s.who}</p>
        </li>
      ))}
    </ol>
  );
}

export function RightPage() {
  const { sheet, lookalike, imported, claim, log, due, chair, kept, rows } = SEASONS;
  return (
    <>
      {/* Autumn: the old sheet is read, its columns are mapped, a look-alike pair is decided, the summary lands. */}
      <section className="ld-pane ld-pane-import" data-i="0">
        <p className="lg-sc ld-ledger-title">{sheet.title}</p>
        <div className="ld-old">
          <div className="ld-old-head">
            {sheet.headers.map((h, i) => (
              <span key={h} className="ld-old-h">
                {h}
                <Tick size={16} auto={false} className="ld-tick ld-map-tick" />
                <span className="sr-only">, filled into {sheet.mapped[i]}</span>
              </span>
            ))}
          </div>
          <ul className="ld-old-rows">
            {sheet.rows.map((cells) => (
              <li key={cells[0]} className="ld-old-row">
                {cells.map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </li>
            ))}
          </ul>
          <p className="ld-old-more">{sheet.more}</p>
        </div>
        <div className="ld-lookalike">
          <p className="lg-sc ld-lookalike-title">{lookalike.title}</p>
          <ul>
            {lookalike.rows.map((r) => (
              <li key={r.row} className="ld-look-row" data-pick={r.pick}>
                <span className="ld-look-no">{r.row}</span>
                <span className="ld-look-name">
                  {r.name}
                  {r.pick === "Skip" && <i className="ld-pen" aria-hidden="true" />}
                </span>
                <span className="ld-look-choices">
                  {lookalike.choices.map((c) => (
                    <Chip key={c} label={c} on={c === r.pick} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ld-import-card">
          <p className="lg-sc ld-ledger-title">{imported.title}</p>
          <p className="ld-import-line">
            <Tick size={20} auto={false} className="ld-tick ld-import-tick" />
            <span>{imported.body}</span>
          </p>
        </div>
      </section>

      {/* Winter: the claim ticket for Kestrel, then a second officer's attempt. */}
      <section className="ld-pane ld-pane-claim" data-i="1">
        <p className="lg-sc ld-ledger-title">{claim.title}</p>
        <div className="ld-ticket">
          <Ribbon size="lg" className="ld-ticket-ribbon" />
          <p className="ld-ticket-company">{claim.company}</p>
          <p className="ld-ticket-status">
            <span className="ld-ticket-free" aria-hidden="true">
              {claim.free}
            </span>
            <span className="ld-ticket-mine">{claim.mine}</span>
          </p>
          <div className="ld-claim-slot">
            <span className="ld-claim-btn" aria-hidden="true">
              {claim.button}
            </span>
            <span className="ld-claim-chip">{claim.chip}</span>
          </div>
        </div>
        <div className="ld-attempt">
          <p className="ld-attempt-line">{claim.attempt}</p>
          <p className="ld-attempt-note">{claim.refusal}</p>
        </div>
      </section>

      {/* Spring and summer: the log entry becomes the first ledger row, the company comes back when it
          is due, and at turnover the chair line changes while every row above stays. */}
      <section className="ld-pane ld-pane-ledger" data-i="2">
        <div className="ld-log">
          <p className="lg-sc ld-ledger-title">{log.title}</p>
          <div className="ld-picks ld-log-channels">
            {log.channels.map((c, i) => (
              <Chip key={c} label={c} on={i === log.channelPicked} />
            ))}
          </div>
          <p className="ld-log-note">
            <span className="ld-log-ink">{log.note}</span>
          </p>
          <div className="ld-picks ld-log-follow">
            <span className="ld-log-follow-label">{log.followLabel}</span>
            {log.follows.map((c, i) => (
              <Chip key={c} label={c} on={i === log.followPicked} />
            ))}
          </div>
          <span className="ld-log-save">
            {log.save}
            <span className="ld-pick-on" aria-hidden="true">
              {log.save}
            </span>
          </span>
        </div>

        <div className="ld-due">
          <p className="lg-sc ld-ledger-title">{due.title}</p>
          <p className="ld-due-name">{due.company}</p>
          <p className="ld-due-when">
            <span className="ld-due-before" aria-hidden="true">
              {due.before}
            </span>
            <span className="ld-due-after">{due.after}</span>
          </p>
          <p className="ld-due-stage">
            <DueGlyph />
            <span className="ld-due-labels">
              <span className="ld-due-before" aria-hidden="true">
                {due.stageBefore}
              </span>
              <span className="ld-due-after">{due.stageAfter}</span>
            </span>
          </p>
        </div>

        <div className="ld-ledger">
          <p className="lg-sc ld-ledger-title ld-kept-title">{kept}</p>
          <ul className="ld-ledger-rows">
            {rows.map((row, i) => (
              <li key={row.what} className="ld-ledger-row">
                <span className="lg-margin">26-27</span>
                <span className="ld-ledger-what">
                  <strong>{row.who}</strong> {row.what}
                  {i === 0 && <Tick size={18} auto={false} className="ld-tick ld-row-tick" />}
                </span>
                <span className="ld-ledger-when lg-num">{row.when}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ld-chair">
          <p className="ld-chair-old">
            <span>{chair.old}</span>
            <i className="ld-pen" aria-hidden="true" />
          </p>
          <div className="ld-turnover-wrap">
            <TurnoverRule endsYear="2026-27" />
          </div>
          <p className="ld-chair-new">
            <span className="ld-chair-ink">{chair.next}</span>
          </p>
        </div>
      </section>
    </>
  );
}
