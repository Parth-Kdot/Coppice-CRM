"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { BoardCard, BoardColumn, DuplicatePair } from "@/demo/selectors";
import { demoRoutes } from "@/demo/routes";
import { useBoard, useBoardFilters, useDemoActions } from "@/demo/store";
import type { MatchReason, Stage } from "@/demo/types";
import { ChevronDownIcon, ChevronRightIcon, DuplicateIcon, PaperclipIcon, PlusIcon, SearchIcon, StageGlyph } from "../icons";
import { Ribbon } from "../marks";
import { useConfirm, useNotify } from "../providers";
import { FIND_EVENT } from "../shell";
import { isLongOverdue, OverdueMark } from "./overdue";
import { StageControl } from "./stage-control";
import { ClaimBadge, Count, Empty, ErrorLine, PageHead, useClaimAction, useFlash } from "./shared";

// The board: six ruled columns, one per stage, with the cards as paper slips. Search and industry
// live in the URL. Committed and Declined start collapsed. Claim a card, move it between stages,
// settle look-alike companies, and bring archived ones back.

const matchText = (reasons: MatchReason[]) => (reasons.length === 2 ? "same name and website" : reasons[0] === "website" ? "same website" : "same name");

function Card({
  ws,
  card,
  dropping,
  shaking,
  flashing,
  error,
  onClaim,
  onDismiss,
  onMoved,
}: {
  ws: string;
  card: BoardCard;
  dropping: boolean;
  shaking: boolean;
  flashing: boolean;
  error: string | undefined;
  onClaim: () => void;
  onDismiss: () => void;
  onMoved: () => void;
}) {
  const c = card.company;
  return (
    <li className={`lg-card lg-rule-row ${flashing ? "lg-settle" : ""}`} data-stage={c.stage} data-od={isLongOverdue(card.daysOverdue) ? "long" : undefined}>
      {card.claim.state === "mine" && <Ribbon size="md" drop={dropping} className="lg-cardribbon" />}
      <h3 className="lg-cardname">
        <Link href={demoRoutes.company(ws, c.id)}>{c.name}</Link>
      </h3>
      {c.industry && <p className="lg-cardind">{c.industry}</p>}
      <p className="lg-cardfollow">
        {card.followUp && card.daysOverdue !== null ? (
          <OverdueMark days={card.daysOverdue} dueOn={card.followUp} size={15} />
        ) : (
          <span className="lg-muted">No follow-up set</span>
        )}
      </p>
      {!card.closed && (
        <div className="lg-cardclaim">
          {card.claim.state === "mine" || card.claim.state === "theirs" ? (
            <ClaimBadge claim={card.claim} />
          ) : (
            <button type="button" className={`lg-btn lg-btn-primary lg-btn-sm ${shaking ? "lg-btn-shake" : ""}`} onClick={onClaim}>
              Claim
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="lg-rownote lg-cardnote" role="alert">
          <span>{error}</span>
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
      <StageControl key={c.stage} ws={ws} companyId={c.id} companyName={c.name} stage={c.stage} compact onMoved={onMoved} />
    </li>
  );
}

function Column({
  ws,
  col,
  hrefs,
  claimAction,
  flashing,
  flash,
}: {
  ws: string;
  col: BoardColumn;
  hrefs: { toggle: string | null; all: string };
  claimAction: ReturnType<typeof useClaimAction>;
  flashing: ReadonlySet<string>;
  flash: (id: string) => void;
}) {
  const heading = (
    <>
      <StageGlyph stage={col.stage} size={15} className="lg-colglyph" />
      <span className="lg-colname">{col.label}</span>
      <span className="lg-colcount">
        (<Count value={col.count} />)
      </span>
    </>
  );
  return (
    <section className="lg-col" data-open={col.open} aria-labelledby={`col-${col.stage}`}>
      <h2 id={`col-${col.stage}`} className="lg-colhead">
        {hrefs.toggle ? (
          <Link href={hrefs.toggle} scroll={false} aria-expanded={col.open} className="lg-coltoggle">
            {col.open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
            {heading}
          </Link>
        ) : (
          <span className="lg-coltoggle lg-coltoggle-static">{heading}</span>
        )}
      </h2>
      {col.open && (
        <>
          {col.cards.length === 0 ? (
            <p className="lg-colempty">Nothing in this column.</p>
          ) : (
            <ul className="lg-cards">
              {col.cards.map((card) => (
                <Card
                  key={card.company.id}
                  ws={ws}
                  card={card}
                  dropping={claimAction.dropping === card.company.id}
                  shaking={claimAction.shaking === card.company.id}
                  flashing={flashing.has(card.company.id)}
                  error={claimAction.errors[card.company.id]}
                  onClaim={() => claimAction.claim(card.company.id, card.company.name)}
                  onDismiss={() => claimAction.dismiss(card.company.id)}
                  onMoved={() => flash(card.company.id)}
                />
              ))}
            </ul>
          )}
          {col.hasMore && (
            <p className="lg-colmore">
              <Link href={hrefs.all} className="lg-link" scroll={false}>
                Show all {col.count}
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function DuplicatePairRow({ ws, pair }: { ws: string; pair: DuplicatePair }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const [error, setError] = useState<string | null>(null);

  const archive = async (keep: DuplicatePair["a"], drop: DuplicatePair["a"]) => {
    const ok = await confirm({ message: `Archive ${drop.name} and keep ${keep.name}? You can unarchive it later.`, confirmLabel: `Archive ${drop.name}` });
    if (!ok) return;
    const result = actions.archiveDuplicate(ws, keep.id, drop.id);
    if (!result.ok) setError(result.error);
    else notify(`${drop.name} archived. ${keep.name} kept.`);
  };

  return (
    <li className="lg-pair">
      <PaperclipIcon size={22} className="lg-pair-clip" />
      <div className="lg-pair-slips">
        {[pair.a, pair.b].map((side) => (
          <div key={side.id} className="lg-slip lg-pair-slip">
            <Link href={demoRoutes.company(ws, side.id)} className="lg-link font-semibold">
              {side.name}
            </Link>
            <p className="lg-muted text-sm">{side.website ?? "No website"}</p>
          </div>
        ))}
      </div>
      <p className="lg-pair-why">
        <DuplicateIcon size={16} /> Matches on {matchText(pair.matchedOn)}.
      </p>
      <div className="lg-actions">
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => archive(pair.b, pair.a)}>
          Same company: archive {pair.a.name}
        </button>
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => archive(pair.a, pair.b)}>
          Same company: archive {pair.b.name}
        </button>
        <button
          type="button"
          className="lg-btn lg-btn-sm"
          onClick={() => {
            const result = actions.keepSeparate(ws, pair.a.id, pair.b.id);
            if (!result.ok) setError(result.error);
            else notify("Kept as separate entries. They will not be flagged again.");
          }}
        >
          Separate entries
        </button>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </li>
  );
}

export function BoardScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const actions = useDemoActions();
  const notify = useNotify();
  const filters = useBoardFilters();
  const board = useBoard(ws, filters);
  const { flashing, flash } = useFlash();
  const claimAction = useClaimAction(ws, flash);
  const [q, setQ] = useState(filters.q);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);

  // The Companies tab in the spine lands here with the search box ready.
  useEffect(() => {
    const focus = () => {
      search.current?.focus();
      search.current?.select();
    };
    if (window.location.hash === "#find") focus();
    window.addEventListener(FIND_EVENT, focus);
    return () => window.removeEventListener(FIND_EVENT, focus);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = (patch: Partial<typeof filters>) => {
    startTransition(() => router.replace(demoRoutes.board(ws, { ...filters, ...patch }), { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go({ q: value.trim().slice(0, 100), all: null }), 300);
  };

  const loading = pending || q.trim() !== filters.q;
  const filtered = Boolean(filters.q || filters.industry);

  const toggleShow = (stage: Stage) => {
    const show = filters.show.includes(stage) ? filters.show.filter((s) => s !== stage) : [...filters.show, stage];
    return demoRoutes.board(ws, { ...filters, show });
  };

  return (
    <div className="lg-board">
      <PageHead title="Board" count={board.total}>
        <Link href={demoRoutes.queue(ws)} className="lg-btn">
          Back
        </Link>
        <Link href={demoRoutes.newCompany(ws)} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          Add company
        </Link>
      </PageHead>

      <form className="lg-filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="lg-search">
          <SearchIcon size={18} />
          <label className="lg-sr" htmlFor="company-search">
            Search companies
          </label>
          <input
            id="company-search"
            ref={search}
            type="search"
            className="lg-input"
            placeholder="Search companies"
            maxLength={100}
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="lg-sr" htmlFor="industry-filter">
            Industry
          </label>
          <select id="industry-filter" className="lg-select" value={filters.industry} onChange={(e) => go({ industry: e.target.value, all: null })}>
            <option value="">All industries</option>
            {board.industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <p className="lg-muted lg-loading" role="status" aria-live="polite">
          {loading ? "Loading..." : ""}
        </p>
      </form>

      {board.total === 0 && board.columns.every((c) => c.count === 0) && (
        <Empty kind="board">
          <p className="lg-empty-title">{filtered ? "No companies match." : "No companies yet."}</p>
          {!filtered && (
            <p>
              <Link href={demoRoutes.newCompany(ws)} className="lg-link">
                Add your first one.
              </Link>
            </p>
          )}
        </Empty>
      )}

      <div className="lg-cols" tabIndex={0} role="region" aria-label="Pipeline columns, scrolls sideways on small screens">
        {board.columns.map((col) => (
          <Column
            key={col.stage}
            ws={ws}
            col={col}
            hrefs={{
              toggle: col.stage === "COMMITTED" || col.stage === "DECLINED" ? toggleShow(col.stage) : null,
              all: demoRoutes.board(ws, { ...filters, all: col.stage }),
            }}
            claimAction={claimAction}
            flashing={flashing}
            flash={flash}
          />
        ))}
      </div>

      <section className="lg-boardsect" aria-labelledby="dupes-title">
        <h2 id="dupes-title" className="lg-never-title">
          <Link href={demoRoutes.board(ws, { ...filters, dupes: !filters.dupes })} scroll={false} aria-expanded={filters.dupes} className="lg-never-toggle">
            {filters.dupes ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
            <span className="lg-h2">Possible duplicates</span>
            <span className="lg-never-count">{board.duplicatePairsCapped ? "50+" : <Count value={board.duplicatePairs.length} />}</span>
          </Link>
        </h2>
        {filters.dupes && (
          <>
            <p className="lg-hint max-w-[60ch]">
              Companies that look alike (same name ignoring case and Inc/LLC/Corp, or same website). Archive the copy, or keep both as separate entries so they stop being flagged.
            </p>
            {board.duplicatePairs.length === 0 ? (
              <p className="lg-muted py-4">No look-alike pairs right now.</p>
            ) : (
              <ul className="lg-pairs">
                {board.duplicatePairs.map((pair) => (
                  <DuplicatePairRow key={`${pair.a.id}|${pair.b.id}`} ws={ws} pair={pair} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="lg-boardsect" aria-labelledby="archived-title">
        <h2 id="archived-title" className="lg-never-title">
          <Link href={demoRoutes.board(ws, { ...filters, archived: !filters.archived })} scroll={false} aria-expanded={filters.archived} className="lg-never-toggle">
            {filters.archived ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
            <span className="lg-h2">Archived</span>
            <span className="lg-never-count">
              <Count value={board.archivedCount} />
            </span>
          </Link>
        </h2>
        {filters.archived &&
          (board.archived === null ? (
            <p className="lg-muted py-4">Nothing is archived.</p>
          ) : (
            <ul className="lg-archived">
              {board.archived.map((c) => (
                <li key={c.id}>
                  <div>
                    <Link href={demoRoutes.company(ws, c.id)} className="lg-link font-semibold">
                      {c.name}
                    </Link>
                    {c.industry && <span className="lg-muted">, {c.industry}</span>}
                  </div>
                  <button
                    type="button"
                    className="lg-btn lg-btn-sm"
                    onClick={() => {
                      const result = actions.unarchiveCompany(ws, c.id);
                      if (result.ok) notify(`${c.name} is back on the board.`);
                      else notify(result.error, "error");
                    }}
                  >
                    Unarchive
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
