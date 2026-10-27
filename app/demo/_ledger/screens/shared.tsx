"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDemoActions, useDemoState } from "@/demo/store";
import type { ClaimView } from "@/demo/selectors";
import { ClaimIcon, SproutIcon, UserIcon, WarningIcon } from "../icons";
import { useLedgerTools, useNotify } from "../providers";

// Small pieces every Ledger screen shares: a number that crossfades, a sprout for empty states,
// "ink settle" flashes for updated rows, the claim action (with the shake and the margin note when a
// claim is refused), and the claim badge.

export function Count({ value, className = "" }: { value: number | string; className?: string }) {
  return (
    <span key={String(value)} className={`lg-count ${className}`}>
      {value}
    </span>
  );
}

// An empty state: a small sprout that grows once, on first view only (LF-14 rhythm, 1.2 s).
const seenEmpty = new Set<string>();

export function Empty({ kind, children }: { kind: string; children: ReactNode }) {
  const [grow, setGrow] = useState(false);
  useEffect(() => {
    if (seenEmpty.has(kind)) return;
    seenEmpty.add(kind);
    const frame = requestAnimationFrame(() => setGrow(true));
    return () => cancelAnimationFrame(frame);
  }, [kind]);
  return (
    <div className="lg-empty" data-grow={grow}>
      <span className="lg-empty-art">
        <SproutIcon size={44} />
      </span>
      <div>{children}</div>
    </div>
  );
}

// "Updated rows settle": the row's paper-2 background fades out over 600 ms while its text comes up
// from 60% to full ink in 200 ms. Call flash(id) after an action; the row gets .lg-settle for a moment.
export function useFlash() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());
  const flash = useCallback((id: string) => {
    const old = timers.current.get(id);
    if (old) window.clearTimeout(old);
    setIds((current) => new Set(current).add(id));
    timers.current.set(
      id,
      window.setTimeout(() => {
        setIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        timers.current.delete(id);
      }, 700),
    );
  }, []);
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);
  return { flashing: ids, flash };
}

// Pressing Claim. On success the ribbon bookmark drops onto the row or card. When someone else got
// there first the button shakes once (4 px, 180 ms) and a rust margin note names the holder and the
// expiry. The reviewer's "A teammate wins the next Claim" tool plays that teammate first.
export function useClaimAction(ws: string, onClaimed?: (companyId: string) => void) {
  const actions = useDemoActions();
  const notify = useNotify();
  const { raceNext, setRaceNext } = useLedgerTools();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dropping, setDropping] = useState<string | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);

  const claim = useCallback(
    (companyId: string, name: string) => {
      if (raceNext) {
        actions.simulateTeammateClaim(ws, companyId);
        setRaceNext(false);
      }
      const result = actions.claimCompany(ws, companyId);
      if (!result.ok) {
        setErrors((current) => ({ ...current, [companyId]: result.error }));
        setShaking(companyId);
        window.setTimeout(() => setShaking((s) => (s === companyId ? null : s)), 240);
        return result;
      }
      setErrors((current) => {
        if (!(companyId in current)) return current;
        const next = { ...current };
        delete next[companyId];
        return next;
      });
      setDropping(companyId);
      window.setTimeout(() => setDropping((d) => (d === companyId ? null : d)), 700);
      notify(`Claimed ${name}.`);
      onClaimed?.(companyId);
      return result;
    },
    [actions, notify, onClaimed, raceNext, setRaceNext, ws],
  );

  const dismiss = useCallback(
    (companyId: string) =>
      setErrors((current) => {
        const next = { ...current };
        delete next[companyId];
        return next;
      }),
    [],
  );

  return { claim, errors, dropping, shaking, dismiss };
}

export function ClaimBadge({ claim, short = false }: { claim: ClaimView; short?: boolean }) {
  if (claim.state === "mine") {
    return (
      <span className="lg-badge lg-badge-mine">
        <ClaimIcon size={14} />
        {claim.label}
      </span>
    );
  }
  if (claim.state === "theirs") {
    return (
      <span className="lg-badge lg-badge-theirs">
        <UserIcon size={14} />
        {short ? `Held by ${claim.holderName}` : claim.label}
      </span>
    );
  }
  return null;
}

// A message under the control that caused it: rust, announced to screen readers, never color alone.
export function ErrorLine({ children, id }: { children: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p className="lg-error" role="alert" id={id}>
      <WarningIcon size={16} />
      <span>{children}</span>
    </p>
  );
}

// The latest outreach on each company of a workspace, for the queue's disclosure.
export function useLatestOutreach(ws: string) {
  const state = useDemoState();
  return useMemo(() => {
    const names = new Map(state.people.map((p) => [p.id, p.name]));
    const map = new Map<string, { sentAt: string; by: string; channel: string; note: string | null }>();
    const rows = state.outreach.filter((o) => o.workspaceId === ws).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.id.localeCompare(b.id));
    for (const o of rows) {
      if (!map.has(o.companyId)) map.set(o.companyId, { sentAt: o.sentAt, by: names.get(o.senderId) ?? "a former member", channel: o.channel, note: o.note });
    }
    return map;
  }, [state.outreach, state.people, ws]);
}

// The page title block: h1, an optional count, and actions on the right.
export function PageHead({ title, count, sub, children }: { title: string; count?: number | string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="lg-pagehead">
      <div>
        <h1 className="lg-h1">
          {title}
          {count !== undefined && <span className="lg-h1-count"> <Count value={count} /></span>}
        </h1>
        {sub && <p className="lg-sub">{sub}</p>}
      </div>
      {children && <div className="lg-actions">{children}</div>}
    </div>
  );
}
