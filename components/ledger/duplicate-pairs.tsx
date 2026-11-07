"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef } from "react";
import { archiveDuplicate, keepSeparate } from "@/app/(app)/[workspaceId]/companies/actions";
import { ActionForm } from "@/components/action-form";
import { DuplicateIcon } from "@/components/ledger/icons";
import { Tick } from "@/components/ledger/marks";
import { ExitCollapse, reducedMotion } from "@/components/ledger/motion";
import { archivedNote, initialPairList, openPairs, pairLabel, pairListReducer, separateNote, type PairListAction, type PairListState } from "@/lib/duplicate-review";

// The pairs in the board's "Possible duplicates" sheet (app/(app)/[workspaceId]/board/page.tsx).
// The page renders the list on the server; this keeps a resolved pair on screen until it has
// faded and slid out and its space has closed, the same motion as the import's duplicate review
// (components/csv-importer-duplicates.tsx). The buttons are the same server actions as before:
// "Same company: archive ..." (after the page's confirm dialog) and "Separate entries". A refusal
// leaves the pair where it is with the reason under its buttons.

export type PairCompany = { id: string; name: string; website: string | null };
export type PairData = { key: string; a: PairCompany; b: PairCompany; matchedOn: string[] };

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
    el?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
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
      el.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
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
      {state.shown.map(({ key, a, b, matchedOn }) => {
        const slot = state.leaving.get(key);
        const label = pairLabel(slot ?? { n: open.findIndex((p) => p.key === key) + 1, of: open.length }, more);
        return (
          <li key={key}>
            <ExitCollapse leaving={slot !== undefined} entering={state.arrived.has(key)} onLeft={() => onLeft(key)}>
              <div className="lg-pair" role="group" aria-label={`${label}: ${a.name} and ${b.name}`}>
                <p className="lg-tag lg-pair-count">{label}</p>
                <p id={headingId(key)} tabIndex={-1} className="lg-pair-names">
                  <Link href={`/${workspaceId}/companies/${a.id}`} className="lg-link">
                    {a.name}
                  </Link>
                  <span aria-hidden="true">and</span>
                  <Link href={`/${workspaceId}/companies/${b.id}`} className="lg-link">
                    {b.name}
                  </Link>
                </p>
                <p className="lg-pair-site">{[a.website, b.website].filter(Boolean).join(" and ") || "No website on either"}</p>
                <p className="lg-pair-why">
                  <DuplicateIcon size={16} /> Same {matchedOn.join(" and ")}.
                </p>
                <div className="lg-actions">
                  {[
                    [b, a],
                    [a, b],
                  ].map(([keep, drop]) => (
                    <ActionForm
                      key={drop.id}
                      action={archiveDuplicate}
                      submitLabel={`Same company: archive ${drop.name}`}
                      confirmMessage={`Archive ${drop.name} and keep ${keep.name}? You can unarchive it later.`}
                      successMessage={archivedNote(drop.name)}
                      onSuccess={() => resolve(key)}
                    >
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="keepId" value={keep.id} />
                      <input type="hidden" name="archiveId" value={drop.id} />
                    </ActionForm>
                  ))}
                  <ActionForm action={keepSeparate} submitLabel="Separate entries" successMessage={separateNote(a.name, b.name)} onSuccess={() => resolve(key)}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="companyId" value={a.id} />
                    <input type="hidden" name="otherId" value={b.id} />
                  </ActionForm>
                </div>
              </div>
            </ExitCollapse>
          </li>
        );
      })}
    </ul>
  );
}
