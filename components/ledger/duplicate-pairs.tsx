"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { archiveDuplicate, keepSeparate } from "@/app/(app)/[workspaceId]/companies/actions";
import { ActionForm } from "@/components/action-form";
import { DuplicateIcon } from "@/components/ledger/icons";
import { Tick } from "@/components/ledger/marks";
import { ExitCollapse } from "@/components/ledger/motion";
import { completeStamp, prefersReducedMotion } from "@/components/ledger/motion-kit";
import { archivedNote, initialPairList, openPairs, pairLabel, pairListReducer, separateNote, type PairListAction, type PairListState } from "@/lib/duplicate-review";

// The pairs in the board's "Possible duplicates" sheet (app/(app)/[workspaceId]/board/page.tsx).
// The page renders the list on the server; this keeps a resolved pair on screen until it has
// slid away and its space has closed (the motion kit's removeAway, the same move as the import's
// duplicate review in components/importer/duplicates.tsx), and the last one ends on a stamp. Each pair has two answers: "Same company..." asks which
// one to keep (the one with a website, else the older one, is picked to start) and archives the
// other; "Different companies" remembers they are separate. The same server actions as always
// (archiveDuplicate, keepSeparate); a refusal leaves the pair where it is with the reason under it.

type PairCompany = { id: string; name: string; website: string | null };
type PairData = { key: string; a: PairCompany; b: PairCompany; matchedOn: string[]; keepId?: string };

// "example.com" from "https://www.example.com/about": the host is enough to compare two websites.
function siteHost(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "") + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "");
  } catch {
    return website;
  }
}

const reasonText = (matchedOn: string[]) => `Same ${matchedOn.join(" and ")}.`;

type Props = {
  workspaceId: string;
  pairs: PairData[];
  // The server stopped at its cap, so there may be more than it sent.
  more: boolean;
};

const reducer = (state: PairListState<PairData>, action: PairListAction<PairData>) => pairListReducer(state, action);

export function DuplicatePairs({ workspaceId, pairs, more }: Props) {
  const idPrefix = useId();
  const [state, dispatch] = useReducer(reducer, pairs, initialPairList);
  // Each revalidation sends a new list: fold it in during render, so a pair the server dropped is
  // still drawn (now leaving) in the same paint instead of vanishing for a frame.
  if (state.source !== pairs) dispatch({ type: "sync", pairs });

  const open = openPairs(state);
  const headingId = (key: string) => `${idPrefix}-pair-${key}`;
  const doneId = `${idPrefix}-pairs-done`;

  // Focus follows the answer: once the pair just answered is on its way out (inert), focus moves to
  // the next open pair now, and after the exit the page scrolls to it; when it was the last, focus
  // goes to the line that replaces the list. A pair that leaves on its own leaves focus alone.
  const answered = useRef<string | null>(null);
  const focusOnLeft = useRef<{ key: string; target: string } | null>(null);
  useEffect(() => {
    const key = answered.current;
    if (!key) return;
    if (!state.leaving.has(key)) {
      if (state.shown.some((p) => p.key === key)) return;
      // Already gone: the fresh list came first and the exit was instant (reduced motion).
      answered.current = null;
      const first = openPairs(state)[0];
      const el = document.getElementById(first ? headingId(first.key) : doneId);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest", behavior: "auto" });
      return;
    }
    answered.current = null;
    const at = state.shown.findIndex((p) => p.key === key);
    const next = state.shown.find((p, i) => i > at && !state.leaving.has(p.key)) ?? openPairs(state)[0] ?? null;
    focusOnLeft.current = { key, target: next ? headingId(next.key) : doneId };
    if (next) document.getElementById(headingId(next.key))?.focus({ preventScroll: true });
  });

  const resolve = (key: string) => {
    answered.current = key;
    dispatch({ type: "resolve", key });
  };

  // The line that replaces the list only exists once the last pair's exit has been drawn, so it
  // takes focus from an effect after that render, not from a frame that may come before it.
  const focusDone = useRef(false);
  const shownCount = state.shown.length;
  useEffect(() => {
    if (shownCount > 0 || !focusDone.current) return;
    focusDone.current = false;
    const el = document.getElementById(doneId);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // The last pair is settled: the line that replaces the list lands with a stamp.
    void completeStamp(el);
  }, [shownCount, doneId]);

  const onLeft = (key: string) => {
    const pending = focusOnLeft.current;
    if (pending?.key === key && pending.target === doneId) focusDone.current = true;
    dispatch({ type: "left", key });
    if (pending?.key !== key) return;
    focusOnLeft.current = null;
    if (pending.target === doneId) return;
    window.requestAnimationFrame(() => {
      const el = document.getElementById(pending.target);
      if (!el) return;
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
  };

  if (state.shown.length === 0) {
    return state.resolved > 0 ? (
      <p id={doneId} tabIndex={-1} className="lg-pairs-done">
        <Tick size={18} />
        <span>That was the last pair. Nothing on the board looks alike now.</span>
      </p>
    ) : (
      <p id={doneId} tabIndex={-1} className="lg-muted py-4">
        No look-alike pairs right now.
      </p>
    );
  }

  return (
    <ul className="lg-pairs">
      {state.shown.map((pair) => {
        const slot = state.leaving.get(pair.key);
        const label = pairLabel(slot ?? { n: open.findIndex((p) => p.key === pair.key) + 1, of: open.length }, more);
        return (
          <li key={pair.key}>
            <ExitCollapse leaving={slot !== undefined} entering={state.arrived.has(pair.key)} onLeft={() => onLeft(pair.key)}>
              <Pair workspaceId={workspaceId} pair={pair} label={label} headingId={headingId(pair.key)} onResolved={() => resolve(pair.key)} />
            </ExitCollapse>
          </li>
        );
      })}
    </ul>
  );
}

function Pair({ workspaceId, pair, label, headingId, onResolved }: { workspaceId: string; pair: PairData; label: string; headingId: string; onResolved: () => void }) {
  const { a, b, matchedOn } = pair;
  const id = useId();
  const [choosing, setChoosing] = useState(false);
  const [keep, setKeep] = useState(pair.keepId === b.id ? b.id : a.id);
  const kept = keep === a.id ? a : b;
  const dropped = keep === a.id ? b : a;
  const sameButton = useRef<HTMLButtonElement>(null);
  const sites = matchedOn.includes("website") ? [siteHost(a.website), siteHost(b.website)].filter(Boolean) : [];

  return (
    <div className="lg-pair" role="group" aria-label={`${label}: ${a.name} and ${b.name}`}>
      <p className="lg-tag lg-pair-count">{label}</p>
      <p id={headingId} tabIndex={-1} className="lg-pair-names">
        <Link href={`/${workspaceId}/companies/${a.id}`} className="lg-link lg-wrap-any">
          {a.name}
        </Link>
        <span aria-hidden="true">and</span>
        <Link href={`/${workspaceId}/companies/${b.id}`} className="lg-link lg-wrap-any">
          {b.name}
        </Link>
      </p>
      <p className="lg-pair-why">
        <DuplicateIcon size={16} /> {reasonText(matchedOn)}
        {sites.length > 0 && <span className="lg-pair-site lg-wrap-any">{[...new Set(sites)].join(" and ")}</span>}
      </p>
      {choosing ? (
        <fieldset className="lg-pair-choose">
          <legend className="lg-tag">Which one do you keep?</legend>
          {[a, b].map((c) => (
            <label key={c.id} className="lg-pair-opt">
              <input type="radio" name={`${id}-keep`} value={c.id} checked={keep === c.id} onChange={() => setKeep(c.id)} className="lg-check" autoFocus={keep === c.id} />
              <span className="lg-wrap-any">
                Keep {c.name}
                {c.id === pair.keepId && <span className="lg-muted"> (suggested)</span>}
              </span>
            </label>
          ))}
          <p className="lg-hint">The other is archived, never deleted. You can unarchive it later.</p>
          <div className="lg-actions">
            <ActionForm action={archiveDuplicate} submitLabel="Archive the other" submitAriaLabel={`Archive ${dropped.name}, keep ${kept.name}`} successMessage={archivedNote(dropped.name)} onSuccess={onResolved} small>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="keepId" value={kept.id} />
              <input type="hidden" name="archiveId" value={dropped.id} />
            </ActionForm>
            <button
              type="button"
              className="lg-btn lg-btn-sm lg-btn-quiet"
              onClick={() => {
                setChoosing(false);
                requestAnimationFrame(() => sameButton.current?.focus());
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="lg-actions">
          <button ref={sameButton} type="button" className="lg-btn lg-btn-sm" onClick={() => setChoosing(true)} aria-label={`Same company: choose which of ${a.name} and ${b.name} to keep`}>
            Same company...
          </button>
          <ActionForm action={keepSeparate} submitLabel="Different companies" submitAriaLabel={`${a.name} and ${b.name} are different companies`} successMessage={separateNote(a.name, b.name)} onSuccess={onResolved} small>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="companyId" value={a.id} />
            <input type="hidden" name="otherId" value={b.id} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}
