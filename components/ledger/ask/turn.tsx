"use client";

import { useCallback } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { FailedLine, FilterChips, GuideSections, StarterChips, StatsLines } from "./answer-parts";
import { CardList } from "./cards";
import { CompanyCard } from "./company-card";
import { RowList } from "./rows";
import type { ActionCard, Entry, FilterChip, Starter } from "./types";
import { useCardRunner } from "./use-card-runner";

// One question in the thread and what came back for it: the question, one sentence, then (for the
// turn whose rows are on screen) the filter chips, the code-built summary, the rows or the company
// or the stats or the guide sections, and the cards to confirm. An older turn is its question, its
// sentence and its chips, with "Show again" to read it fresh. Nothing here asks the AI anything.

export function Turn({
  entry,
  workspaceId,
  today,
  starters,
  busy,
  onShowAgain,
  onRemoveChip,
  onRetry,
  onStarter,
  onCardLeft,
  onChanged,
}: {
  entry: Entry;
  workspaceId: string;
  today: string;
  starters: Starter[];
  busy: boolean;
  onShowAgain: (entry: Entry) => void;
  onRemoveChip: (entry: Entry, key: FilterChip["key"]) => void;
  onRetry: (entry: Entry) => void;
  onStarter: (starter: Starter) => void;
  onCardLeft: (entry: Entry, card: ActionCard) => void;
  onChanged: (entry: Entry) => void;
}) {
  const { answer } = entry;
  const changed = useCallback(() => onChanged(entry), [onChanged, entry]);
  const left = useCallback((card: ActionCard) => onCardLeft(entry, card), [onCardLeft, entry]);
  const runner = useCardRunner({ workspaceId, onLeft: left, onChanged: changed });
  const cards = answer ? answer.cards.filter((c) => !entry.doneCards.includes(c.key)) : [];

  return (
    <li className="lg-askturn" data-status={entry.status} data-entry={entry.key}>
      <h2 className="lg-askq" tabIndex={-1}>
        {entry.question}
      </h2>

      {entry.status === "pending" && (
        <div className="lg-askwait" role="status">
          <span className="lg-sr">Working on it.</span>
          <span className="lg-askwait-bar" aria-hidden="true" />
        </div>
      )}

      {entry.status === "failed" && entry.error && (
        <FailedLine message={entry.error} retryable={entry.retryable} rateLimited={entry.rateLimited} busy={busy} onRetry={() => onRetry(entry)} />
      )}

      {entry.status === "answered" && (
        <div className="lg-askans">
          <p className="lg-askreply">{entry.reply}</p>
          {answer?.notes.map((note) => (
            <p key={note} className="lg-hint">
              {note}
            </p>
          ))}

          {answer ? (
            <>
              {answer.view === "companies" && (
                <>
                  <FilterChips chips={answer.chips} busy={busy} onRemove={(key) => onRemoveChip(entry, key)} />
                  {answer.summary && <p className="lg-asksummary">{answer.summary}</p>}
                  {answer.rows.length === 0 && answer.chips.some((c) => c.removable) && <p className="lg-hint">Take a filter off to widen the list.</p>}
                  <RowList rows={answer.rows} label="Companies" workspaceId={workspaceId} today={today} onChanged={changed} />
                </>
              )}
              {answer.view === "plan" && (
                <>
                  {answer.summary && <p className="lg-asksummary">{answer.summary}</p>}
                  <RowList rows={answer.rows} label="Your plan" workspaceId={workspaceId} today={today} onChanged={changed} />
                </>
              )}
              {answer.view === "company" && answer.company && <CompanyCard company={answer.company} workspaceId={workspaceId} today={today} onChanged={changed} />}
              {answer.view === "stats" && answer.stats && <StatsLines stats={answer.stats} />}
              {answer.view === "guide" && <GuideSections sections={answer.guide} />}
              <CardList cards={cards} applyAll={answer.applyAll && cards.length >= 2} runner={runner} workspaceId={workspaceId} today={today} />
              {answer.showStarters && <StarterChips starters={starters} onPick={onStarter} disabled={busy} />}
            </>
          ) : (
            <>
              {entry.chips.length > 0 && <FilterChips chips={entry.chips} busy={busy} />}
              {entry.view !== "none" && (
                <p className="lg-askagain">
                  <button type="button" className="lg-btn lg-btn-sm" aria-disabled={busy || undefined} onClick={() => !busy && onShowAgain(entry)}>
                    Show again
                    <span className="lg-sr">: {entry.question}</span>
                  </button>
                </p>
              )}
            </>
          )}
          {entry.problem && <ErrorLine>{entry.problem}</ErrorLine>}
        </div>
      )}
    </li>
  );
}
