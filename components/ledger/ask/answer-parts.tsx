"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Disclosure } from "@/components/ledger/disclosure";
import { CloseIcon, WarningIcon } from "@/components/ledger/icons";
import type { CopilotAnswer, FilterChip, Starter } from "./types";

// The small parts of an answer: the filter chips, the stats lines, the guide sections, the starter
// chips and the line a failed question leaves in the thread.

// The filter as chips. A removable chip has an x that takes just that filter off; the list is read
// again without it, with no AI call. The stage and the sort chips stay. `onRemove` is left out for a
// turn that shows no rows (its chips are only a reminder).
export function FilterChips({ chips, onRemove, busy }: { chips: FilterChip[]; onRemove?: (key: FilterChip["key"]) => void; busy: boolean }) {
  if (chips.length === 0) return null;
  return (
    <ul className="lg-askchips" aria-label="Filters" data-ask-chips>
      {chips.map((chip) => (
        <li key={chip.key} className="lg-askfilter" data-fixed={!chip.removable || !onRemove || undefined}>
          <span>{chip.label}</span>
          {chip.removable && onRemove && (
            <button type="button" className="lg-askfilter-x" aria-disabled={busy || undefined} aria-label={`Remove filter: ${chip.label}`} onClick={() => !busy && onRemove(chip.key)}>
              <CloseIcon size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// The starter chips of an empty conversation, and under an answer that is only a sentence. Each is
// a fixed question in code: no AI call.
export function StarterChips({ starters, onPick, disabled }: { starters: Starter[]; onPick: (starter: Starter) => void; disabled: boolean }) {
  return (
    <ul className="lg-askstarters" aria-label="Questions to start with">
      {starters.map((s) => (
        <li key={s.id}>
          <button type="button" className="lg-askstarter" aria-disabled={disabled || undefined} onClick={() => !disabled && onPick(s)}>
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Template stats, as a few sentences from the stats page's own numbers.
export function StatsLines({ stats }: { stats: NonNullable<CopilotAnswer["stats"]> }) {
  return (
    <div className="lg-askstats">
      <ul>
        {stats.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        <Link href={stats.href} className="lg-link">
          Open template stats
        </Link>
      </p>
    </div>
  );
}

// The guide sections an answer chose, word for word. The first is open, the rest are one click away.
export function GuideSections({ sections }: { sections: CopilotAnswer["guide"] }) {
  if (sections.length === 0) return null;
  return (
    <section className="lg-askguide" aria-label="From the Coppice guide">
      <h3 className="lg-tag">From the Coppice guide</h3>
      {sections.map((s, i) => (
        <Disclosure key={s.id} summary={s.title} variant="inline" defaultOpen={i === 0} className="lg-askguide-sect">
          {s.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </Disclosure>
      ))}
    </section>
  );
}

// Sixty seconds, the length of Groq's per-minute limit. The seconds are shown, not announced.
const WAIT_SECONDS = 60;

function useCountdown(active: boolean): number {
  const [left, setLeft] = useState(WAIT_SECONDS);
  useEffect(() => {
    if (!active || left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [active, left]);
  return active ? left : 0;
}

// A question that failed, in the thread, in plain words. "Try again" when asking again can help;
// after Groq's per-minute limit it waits out the minute first, counting the seconds like Smart import.
export function FailedLine({ message, retryable, rateLimited, busy, onRetry }: { message: string; retryable: boolean; rateLimited: boolean; busy: boolean; onRetry: () => void }) {
  const left = useCountdown(rateLimited);
  return (
    <div className="lg-askfail" role="alert">
      <p className="lg-error">
        <WarningIcon size={16} />
        <span>{message}</span>
      </p>
      {retryable && (
        <div className="lg-askfail-act">
          <button type="button" className="lg-btn lg-btn-sm" aria-disabled={busy || left > 0 || undefined} onClick={() => !busy && left <= 0 && onRetry()}>
            {left > 0 ? (
              <>
                <span aria-hidden="true">{`Try again in ${left} s`}</span>
                <span className="lg-sr">Try again in a minute</span>
              </>
            ) : (
              "Try again"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
