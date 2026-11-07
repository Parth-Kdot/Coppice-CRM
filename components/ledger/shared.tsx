"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SproutIcon, WarningIcon } from "./icons";

// Small pieces every Ledger screen shares: a number that crossfades when it changes, a sprout for empty states,
// and the message that sits under the control that caused it.

// The crossfade plays only when the number changes, never when the page first draws it.
export function Count({ value, className = "" }: { value: number | string; className?: string }) {
  const [first] = useState(value);
  return (
    <span key={String(value)} className={`lg-count ${className}`} data-changed={value !== first || undefined}>
      {value}
    </span>
  );
}

// An empty state: a small sprout that grows once, on first view only.
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

// The head of a page: its title (with a live count if there is one), a line under it, and the page's actions.
export function PageHead({ title, count, sub, children }: { title: string; count?: number | string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="lg-pagehead">
      <div>
        <h1 className="lg-h1" tabIndex={-1}>
          {title}
          {count !== undefined && (
            <span className="lg-h1-count">
              {" "}
              <Count value={count} />
            </span>
          )}
        </h1>
        {sub && <p className="lg-sub">{sub}</p>}
      </div>
      {children && <div className="lg-actions">{children}</div>}
    </div>
  );
}
