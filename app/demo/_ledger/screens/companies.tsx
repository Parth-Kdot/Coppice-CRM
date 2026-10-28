"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { demoRoutes, type CompanySort } from "@/demo/routes";
import { useCompaniesFilters, useCompanyList } from "@/demo/store";
import { STAGES, STAGE_LABELS, type Stage } from "@/demo/types";
import { PlusIcon, SearchIcon, StageGlyph } from "../icons";
import { TurnoverRule, YearMargin, boardYear } from "../marks";
import { ClaimChip } from "./claim-chip";
import { LedgerMenu, type MenuOption } from "./ledger-menu";
import { isLongOverdue, OverdueMark } from "./overdue";
import { Count, Empty, PageHead, useClaimAction, useFlash } from "./shared";

// Companies: the whole workspace as one ruled ledger table. Search, a stage filter and a sort live
// in the URL, so a view can be bookmarked. The board-year margin and the double rule at turnover
// follow the last outreach date, so they read in order when the table is sorted that way.

const SORTS: readonly MenuOption<CompanySort>[] = [
  { value: "recent", label: "Last outreach", hint: "newest first" },
  { value: "followup", label: "Next follow-up", hint: "most overdue first" },
  { value: "name", label: "Company", hint: "A to Z" },
  { value: "stage", label: "Stage", hint: "first to last" },
];

export function CompaniesScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const filters = useCompaniesFilters();
  const list = useCompanyList(ws, filters);
  const { flashing, flash } = useFlash();
  const claimAction = useClaimAction(ws, flash);
  const [q, setQ] = useState(filters.q);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = (patch: Partial<typeof filters>) => {
    startTransition(() => router.replace(demoRoutes.companies(ws, { ...filters, ...patch }), { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go({ q: value.trim().slice(0, 100) }), 250);
  };

  const filtered = Boolean(filters.q || filters.stage);
  const loading = pending || q.trim() !== filters.q;
  const showTurnover = filters.sort === "recent";

  const stageChip = (stage: Stage | null, label: string, count: number) => {
    const on = filters.stage === stage;
    return (
      <button key={stage ?? "all"} type="button" className="lg-fchip" aria-pressed={on} onClick={() => go({ stage })}>
        {stage && <StageGlyph stage={stage} size={14} />}
        <span>{label}</span>
        <span className="lg-fchip-n">
          <Count value={count} />
        </span>
      </button>
    );
  };

  return (
    <div className="lg-companies">
      <PageHead
        title="Companies"
        count={list.rows.length}
        sub={
          filtered ? (
            <>
              {list.rows.length} of {list.workspaceTotal} match.
            </>
          ) : (
            <>Every company in the book, one line each.</>
          )
        }
      >
        <Link href={demoRoutes.newCompany(ws)} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          New company
        </Link>
      </PageHead>

      <form className="lg-filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="lg-search">
          <SearchIcon size={18} />
          <label className="lg-sr" htmlFor="companies-search">
            Search these companies by name, industry, website or contact
          </label>
          <input
            id="companies-search"
            ref={search}
            type="search"
            className="lg-input"
            placeholder="Search by name, website or contact"
            maxLength={100}
            value={q}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <LedgerMenu label="Sort" value={filters.sort} options={SORTS} onChange={(sort) => go({ sort })} align="right" />
        <p className="lg-muted lg-loading" role="status" aria-live="polite">
          {loading ? "Loading..." : ""}
        </p>
      </form>

      <div className="lg-fchips" role="group" aria-label="Filter by stage">
        {stageChip(null, "All", list.matchTotal)}
        {STAGES.map((stage) => stageChip(stage, STAGE_LABELS[stage], list.stageCounts[stage]))}
      </div>

      <div className="lg-chead" aria-hidden="true">
        <span className="lg-cm lg-sc">Board</span>
        <span className="lg-cn lg-sc">Company</span>
        <span className="lg-cs lg-sc">Stage</span>
        <span className="lg-cc lg-sc">Holder</span>
        <span className="lg-cf lg-sc">Next follow-up</span>
        <span className="lg-cl lg-sc">Last outreach</span>
      </div>

      {list.rows.length === 0 ? (
        <Empty kind="companies">
          <p className="lg-empty-title">{filtered ? "No company matches." : "No companies yet."}</p>
          <p>
            {filtered ? (
              <button
                type="button"
                className="lg-btn lg-btn-quiet"
                onClick={() => {
                  setQ("");
                  go({ q: "", stage: null });
                }}
              >
                Clear the search and the stage filter
              </button>
            ) : (
              <Link href={demoRoutes.newCompany(ws)} className="lg-link">
                Add your first one.
              </Link>
            )}
          </p>
        </Empty>
      ) : (
        <ul className="lg-clist" aria-label="Companies">
          {list.rows.map((row, i) => {
            const c = row.company;
            const next = list.rows[i + 1];
            const crosses = showTurnover && next && boardYear(next.datedAt).start !== boardYear(row.datedAt).start;
            return (
              <Fragment key={c.id}>
                <li className={`lg-crow lg-rule-row ${flashing.has(c.id) ? "lg-settle" : ""}`} data-od={isLongOverdue(row.daysOverdue) ? "long" : undefined}>
                  <span className="lg-cm">
                    <YearMargin iso={row.datedAt} />
                  </span>
                  <span className="lg-cn">
                    <Link href={demoRoutes.company(ws, c.id)} className="lg-qlink">
                      {c.name}
                    </Link>
                  </span>
                  <span className="lg-cs" title={STAGE_LABELS[c.stage]}>
                    <StageGlyph stage={c.stage} size={15} />
                    <span className="lg-cs-label">{STAGE_LABELS[c.stage]}</span>
                  </span>
                  <span className="lg-cc">
                    {row.closed ? (
                      <span className="lg-muted">Closed</span>
                    ) : (
                      <ClaimChip
                        claim={row.claim}
                        companyName={c.name}
                        onClaim={() => claimAction.claim(c.id, c.name)}
                        shaking={claimAction.shaking === c.id}
                      />
                    )}
                  </span>
                  <span className="lg-cf">
                    {row.daysOverdue !== null && row.followUpOn ? (
                      <OverdueMark days={row.daysOverdue} dueOn={row.followUpOn} />
                    ) : (
                      <span className="lg-muted">{row.closed ? "Closed" : "No follow-up set"}</span>
                    )}
                  </span>
                  <span className="lg-cl lg-num">{row.lastOutreachOn ?? <span className="lg-muted">Never</span>}</span>
                  {claimAction.errors[c.id] && (
                    <span className="lg-rownote lg-crownote" role="alert">
                      <span>{claimAction.errors[c.id]}</span>
                      <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => claimAction.dismiss(c.id)}>
                        Dismiss
                      </button>
                    </span>
                  )}
                </li>
                {crosses && (
                  <li>
                    <TurnoverRule endsYear={boardYear(next.datedAt).long} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
