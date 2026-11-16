"use client";

import Link, { useLinkStatus } from "next/link";
import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatCount } from "@/lib/format";
import { focusSoon } from "./focus";

// Caps every list.
//
//   <ShowMore initial={5} label="outreach entries">{entries.map(...)}</ShowMore>
//     Renders the first `initial` children, then a "Show all 12 outreach entries" link-button
//     (.lg-linkbtn). Expanding is client-side, no round trip; with focusOnExpand (default true) focus
//     moves to the first newly shown item (its first link or button, else the item itself), so it
//     never falls to <body>. Each child should render one element.
//     Inside a list, pass as="ul" | "ol" (and listClassName): ShowMore then draws the list itself and
//     puts the button after it, so the markup stays valid. Without `as` it renders the children as
//     they are, followed by the button in a <div>.
//     Optional: `moreText` replaces the button's words (the queue says "Show 40 more" when the
//     server holds more than was loaded); `after` (usually a MoreLink) is drawn only once nothing is
//     hidden, so "Show all" and "Show 50 more" never sit side by side. `listLabel` names the list.
//
//   <MoreLink href="?upto=100" shown={50} total={362} />
//     Asks the server for the next page through the URL: "Show 50 more (312 left)", "Loading..."
//     while the navigation is pending (useLinkStatus). At the cap (200 by default) it reads "Showing
//     200 of 362. Use search or filters to narrow." Nothing when everything is shown. The caller
//     builds `href` (usually upto = shown + step). If the link it was focused on goes away after
//     the load, focus moves to that closing line instead of <body>.

export function showMoreSplit(count: number, initial: number): { shown: number; hidden: number } {
  const shown = Math.max(0, Math.min(count, Math.floor(initial)));
  return { shown, hidden: count - shown };
}

export function showAllLabel(count: number, label: string): string {
  return `Show all ${formatCount(count)} ${label}`.trim();
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex='-1'])";

export function ShowMore({
  initial,
  label,
  children,
  focusOnExpand = true,
  as,
  listClassName,
  listLabel,
  moreText,
  after,
}: {
  initial: number;
  label: string;
  children: ReactNode[];
  focusOnExpand?: boolean;
  as?: "ul" | "ol";
  listClassName?: string;
  listLabel?: string;
  moreText?: string;
  after?: ReactNode;
}) {
  // The items as given, not through Children.toArray: a server-rendered list arrives as lazy
  // elements whose keys toArray can't read (it would key them by position), and React would then
  // reuse a removed row's node, still hidden by its exit, for the row after it.
  const items = Array.isArray(children)
    ? (children.flat(Infinity) as ReactNode[]).filter((c) => c !== null && c !== undefined && typeof c !== "boolean")
    : Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = showMoreSplit(items.length, initial);
  const visible = expanded ? items : items.slice(0, shown);
  const list = useRef<HTMLUListElement & HTMLOListElement>(null);
  const toggle = useRef<HTMLDivElement>(null);
  // The element just before the first hidden item, read before expanding.
  const before = useRef<Element | null>(null);
  const parent = useRef<Element | null>(null);
  const wantFocus = useRef(false);

  useLayoutEffect(() => {
    if (!expanded || !wantFocus.current) return;
    wantFocus.current = false;
    const first = before.current ? before.current.nextElementSibling : (parent.current?.children[shown] ?? null);
    if (!(first instanceof HTMLElement)) return;
    const inner = first.matches(FOCUSABLE) ? first : first.querySelector<HTMLElement>(FOCUSABLE);
    focusSoon(inner ?? first);
  }, [expanded, shown]);

  const button =
    hidden > 0 && !expanded ? (
      <div ref={toggle} className="lg-showmore">
        <button
          type="button"
          className="lg-linkbtn"
          onClick={() => {
            if (as) {
              parent.current = list.current;
              before.current = shown > 0 ? (list.current?.children[shown - 1] ?? null) : null;
            } else {
              parent.current = toggle.current?.parentElement ?? null;
              const prev = toggle.current?.previousElementSibling ?? null;
              before.current = shown > 0 ? prev : null;
            }
            wantFocus.current = focusOnExpand;
            setExpanded(true);
          }}
        >
          {moreText ?? showAllLabel(items.length, label)}
        </button>
      </div>
    ) : (
      (after ?? null)
    );

  if (as === "ol")
    return (
      <>
        <ol ref={list} className={listClassName} aria-label={listLabel}>
          {visible}
        </ol>
        {button}
      </>
    );
  if (as === "ul")
    return (
      <>
        <ul ref={list} className={listClassName} aria-label={listLabel}>
          {visible}
        </ul>
        {button}
      </>
    );
  return (
    <>
      {visible}
      {button}
    </>
  );
}

export type MoreLinkState = { kind: "none" } | { kind: "cap"; text: string } | { kind: "more"; next: number; left: number; text: string };

export function moreLinkState(shown: number, total: number, step = 50, cap = 200): MoreLinkState {
  if (shown >= total) return { kind: "none" };
  if (shown >= cap) return { kind: "cap", text: `Showing ${formatCount(shown)} of ${formatCount(total)}. Use search or filters to narrow.` };
  const left = total - shown;
  const next = Math.min(step, left, cap - shown);
  return { kind: "more", next, left, text: next === left ? `Show ${formatCount(next)} more` : `Show ${formatCount(next)} more (${formatCount(left)} left)` };
}

function MoreLinkLabel({ text }: { text: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className={pending ? "lg-sr" : undefined}>{text}</span>
      {pending && <span aria-hidden="true">Loading...</span>}
    </>
  );
}

export function MoreLink({ href, shown, total, step = 50, cap = 200 }: { href: string; shown: number; total: number; step?: number; cap?: number }) {
  const state = moreLinkState(shown, total, step, cap);
  const line = useRef<HTMLParagraphElement>(null);
  // Set when the person used the link; if the next render has no link, the closing line takes focus.
  const [used, setUsed] = useState(false);

  useLayoutEffect(() => {
    if (used && state.kind !== "more") focusSoon(line.current);
  }, [used, state.kind]);

  if (state.kind === "none" && !used) return null;
  if (state.kind !== "more")
    return (
      <p ref={line} className="lg-morelink lg-muted" tabIndex={used ? -1 : undefined}>
        {state.kind === "cap" ? state.text : `Showing all ${formatCount(total)}.`}
      </p>
    );
  return (
    <p className="lg-morelink">
      <Link href={href} scroll={false} className="lg-link" onClick={() => setUsed(true)}>
        <MoreLinkLabel text={state.text} />
      </Link>
    </p>
  );
}
