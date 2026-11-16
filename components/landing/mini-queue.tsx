import { STAGE_LABELS } from "@/lib/stages";
import { BoardIcon, FactsIcon, ImportIcon, QueueIcon, SearchIcon, SettingsIcon, StageGlyph } from "../ledger/icons";
import { LogoMark } from "../brand/logo";
import { Ribbon } from "../ledger/marks";
import { OverdueMark, overdueLevel } from "../ledger/overdue";
import { MINI_NEVER, MINI_ROWS, MINI_TOTAL, type MiniRow } from "./mini-data";

// A small queue built from the same pieces as the real one: the spine, the ruled table with its
// board-year margin, the overdue levels, the three claim states and the status line. It is drawn
// once, in its finished state, from made-up rows, and labeled as an example wherever it appears.
// The whole window is decoration (aria-hidden); the caption beside it says what it is.

export function MiniQueue({ rows = MINI_ROWS, name = "Example workspace" }: { rows?: MiniRow[]; name?: string }) {
  const overdue = rows.filter((r) => r.days > 0).length;
  const week = rows.filter((r) => r.days <= 0 && r.days >= -7).length;
  const mine = rows.filter((r) => r.claim.kind === "mine").length;
  return (
    <div className="ldm" aria-hidden="true">
      <div className="ldm-spine">
        <LogoMark size={26} className="ldm-spine-logo" />
        {[QueueIcon, BoardIcon, ImportIcon, FactsIcon, SettingsIcon].map((Icon, i) => (
          <span key={i} className="ldm-tab" data-active={i === 0}>
            <Icon size={17} />
          </span>
        ))}
      </div>
      <div className="ldm-page">
        <header className="ldm-head">
          <p className="ldm-title">
            {name}, <span className="ldm-vol">Volume 2026-27</span>
          </p>
          <span className="ldm-search">
            <SearchIcon size={16} />
            <span className="ldm-search-text">Search companies or pages</span>
          </span>
        </header>
        <div className="lg-double-rule ldm-rule" />

        <p className="ldm-totals">
          <span>
            Overdue <b>{overdue}</b>
          </span>
          <span>
            Due this week <b>{week}</b>
          </span>
          <span>
            Held by you <b>{mine}</b>
          </span>
          <span className="ldm-totals-never">
            Never contacted <b>{MINI_NEVER}</b>
          </span>
        </p>

        <div className="ldm-colhead lg-sc">
          <span className="ldm-c-margin">Board</span>
          <span>Follow-up</span>
          <span>Company</span>
          <span className="ldm-c-stage">Stage</span>
          <span>Claim</span>
        </div>

        <ul className="ldm-rows">
          {rows.map((row) => (
            <li key={row.id} className="ldm-row" data-od={overdueLevel(row.days)}>
              <span className="ldm-margin">26-27</span>
              <span className="ldm-od">
                <OverdueMark days={row.days} dueOn={row.dueOn} size={16} />
              </span>
              <span className="ldm-name">
                <span className="ldm-name-main">{row.name}</span>
                <span className="ldm-note lg-quote">{row.note}</span>
              </span>
              <span className="ldm-stage">
                <StageGlyph stage={row.stage} size={14} />
                {STAGE_LABELS[row.stage]}
              </span>
              <span className="ldm-claim">
                {row.claim.kind === "free" ? (
                  <span className="ldm-chip ldm-chip-free">Claim</span>
                ) : row.claim.kind === "mine" ? (
                  <span className="ldm-chip ldm-chip-mine">
                    <Ribbon size="sm" className="ldm-chip-ribbon" />
                    Yours until {row.claim.until}
                  </span>
                ) : (
                  <span className="ldm-chip ldm-chip-theirs">
                    {row.claim.who} until {row.claim.until}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <footer className="ldm-status">
          <span>{MINI_TOTAL} companies</span>
          <span className="ldm-status-sep">&middot;</span>
          <span>{rows.filter((r) => r.days >= 0).length} due</span>
          <span className="ldm-status-sep">&middot;</span>
          <span>claim window 14 days</span>
          <span className="ldm-status-sep ldm-status-extra">&middot;</span>
          <span className="ldm-status-extra">Officer view</span>
        </footer>
      </div>
    </div>
  );
}
