"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { formatDay } from "@/demo/dates";
import { demoRoutes } from "@/demo/routes";
import type { QueueRow } from "@/demo/selectors";
import { CHANNEL_LABELS, STAGE_LABELS, type Channel } from "@/demo/types";
import { ClaimIcon, ExternalIcon, LogIcon, StageGlyph } from "../icons";
import { ClaimChip } from "./claim-chip";
import { LogOutreachForm } from "./log-form";
import { OverdueMark } from "./overdue";
import { reducedMotionNow } from "./queue-motion";
import { Empty, type useClaimAction } from "./shared";

// One at a time. A centered ledger card for the first company in line: its name, how late it is, the
// last note quoted, who to write to, who holds it, and four actions. Up to three paper slips peek out
// beneath it. When the card is done (logged, or skipped for now) it slides out to the left and the
// next one rises from the stack. When the stack is empty it ends with the sprout and "All caught up".

type ClaimAction = ReturnType<typeof useClaimAction>;
type Latest = {
  sentAt: string;
  by: string;
  channel: string;
  note: string | null;
};

function Card({
  ws,
  row,
  latest,
  claimAction,
  logging,
  canSkip,
  onLogging,
  onLogged,
  onSkip,
  cardRef,
}: {
  ws: string;
  row: QueueRow;
  latest: Latest | undefined;
  claimAction: ClaimAction;
  logging: boolean;
  canSkip: boolean;
  onLogging: (on: boolean) => void;
  onLogged: () => void;
  onSkip: () => void;
  cardRef?: RefObject<HTMLElement | null>;
}) {
  const company = row.company;
  const claim = row.claim;
  const mine = claim.state === "mine";
  const theirs = claim.state === "theirs";
  const until = claim.expiresAt ? formatDay(claim.expiresAt) : "";
  const error = claimAction.errors[company.id];
  const form = useRef<HTMLDivElement>(null);
  const formOpen = logging && mine;

  // The log form opens at the foot of the card, which can lie below the fold on a short screen.
  useEffect(() => {
    if (!formOpen) return;
    form.current?.scrollIntoView({ block: "nearest", behavior: reducedMotionNow() ? "auto" : "smooth" });
  }, [formOpen]);
  const shaking = claimAction.shaking === company.id;
  return (
    <article ref={cardRef} className="lg-fcard lg-sheet" data-shake={shaking || undefined} aria-label={`${company.name}, ${row.timing}`}>
      <p className="lg-fcard-top">
        <span className="lg-qstage">
          <StageGlyph stage={company.stage} size={16} />
          {STAGE_LABELS[company.stage]}
        </span>
        <ClaimChip claim={claim} companyName={company.name} onClaim={() => undefined} readOnly />
      </p>
      <h2 className="lg-fcard-name">{company.name}</h2>
      <p className="lg-fcard-when">
        {row.daysOverdue !== null && company.nextFollowUpAt ? (
          <OverdueMark days={row.daysOverdue} dueOn={formatDay(company.nextFollowUpAt)} size={20} />
        ) : (
          <span className="lg-muted">{row.timing}</span>
        )}
      </p>
      {row.lastNote ? (
        <figure className="lg-fcard-quote">
          <blockquote className="lg-quote">&ldquo;{row.lastNote}&rdquo;</blockquote>
          {latest && (
            <figcaption className="lg-sc lg-muted">
              Last outreach, {formatDay(latest.sentAt)}, {CHANNEL_LABELS[latest.channel as Channel]}, {latest.by}
            </figcaption>
          )}
        </figure>
      ) : (
        <p className="lg-fcard-quote lg-muted">No outreach note on file yet.</p>
      )}
      <dl className="lg-fcard-facts">
        <div>
          <dt className="lg-sc lg-muted">Contact</dt>
          <dd>
            {row.contact ? (
              <>
                {row.contact.name}
                {row.contact.title && <span className="lg-muted">, {row.contact.title}</span>}
              </>
            ) : (
              <span className="lg-muted">No contact yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="lg-sc lg-muted">Held by</dt>
          <dd>
            {mine ? (
              <>You, until {until}</>
            ) : theirs ? (
              <>
                {claim.holderName}, until {until}
              </>
            ) : (
              <span className="lg-muted">{claim.state === "expired" ? claim.label : "Nobody yet"}</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="lg-fcard-actions">
        {(claim.state === "free" || claim.state === "expired") && (
          <button type="button" className="lg-btn lg-btn-primary" onClick={() => claimAction.claim(company.id, company.name)}>
            <ClaimIcon size={16} />
            Claim
          </button>
        )}
        {mine && (
          <button type="button" className="lg-btn lg-btn-primary" aria-expanded={logging} onClick={() => onLogging(!logging)}>
            <LogIcon size={16} />
            Log outreach
          </button>
        )}
        <Link href={demoRoutes.company(ws, company.id)} className="lg-btn">
          Open company
          <ExternalIcon size={14} />
        </Link>
        <button type="button" className="lg-btn lg-btn-quiet" disabled={!canSkip} onClick={onSkip} title={canSkip ? undefined : "This is the only card left"}>
          Skip for now
        </button>
      </div>
      {error && (
        <p className="lg-rownote lg-fcard-note" role="alert">
          {error}
        </p>
      )}
      {logging && mine && (
        <div className="lg-fform" ref={form}>
          <LogOutreachForm ws={ws} companyId={company.id} compact autoFocus onLogged={onLogged} onCancel={() => onLogging(false)} />
        </div>
      )}
    </article>
  );
}

export function FocusMode({
  ws,
  rows,
  claimAction,
  latest,
  emptyTitle,
  emptyHint,
  resetKey,
}: {
  ws: string;
  // The companies in line, most overdue first.
  rows: readonly QueueRow[];
  claimAction: ClaimAction;
  latest: ReadonlyMap<string, Latest>;
  emptyTitle: string;
  emptyHint: string;
  // Changes when the tab or filter does, so skipped and finished cards come back.
  resetKey: string;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<{
    key: string;
    skipped: string[];
    finished: string[];
  }>({ key: resetKey, skipped: [], finished: [] });
  const [logging, setLogging] = useState(false);
  const card = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  // A new tab or filter starts the stack again.
  const fresh = marks.key === resetKey ? marks : { key: resetKey, skipped: [], finished: [] };
  const ordered = useMemo(() => {
    const open = rows.filter((r) => !fresh.finished.includes(r.company.id));
    const waiting = open.filter((r) => !fresh.skipped.includes(r.company.id));
    const later = fresh.skipped.flatMap((id) => open.filter((r) => r.company.id === id));
    return [...waiting, ...later];
  }, [rows, fresh.finished, fresh.skipped]);
  const current = ordered[0] ?? null;
  const peeking = ordered.slice(1, 4);
  const currentId = current?.company.id ?? null;

  // Sends a copy of the card off to the left while the real one is already the next company. The copy
  // lives outside React's tree, so it can finish its 220 ms slide on its own.
  const flyAway = useCallback(() => {
    const el = card.current;
    const host = layer.current;
    if (!el || !host || reducedMotionNow() || typeof el.animate !== "function") return;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.removeAttribute("aria-label");
    ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    ghost.querySelector(".lg-fform")?.remove();
    const box = el.getBoundingClientRect();
    const origin = host.getBoundingClientRect();
    ghost.style.setProperty("position", "absolute");
    ghost.style.setProperty("top", `${box.top - origin.top}px`);
    ghost.style.setProperty("left", `${box.left - origin.left}px`);
    ghost.style.setProperty("width", `${box.width}px`);
    ghost.style.setProperty("margin", "0");
    ghost.style.setProperty("animation", "none");
    host.appendChild(ghost);
    const motion = ghost.animate(
      [
        { opacity: 1, transform: "translateX(0) rotate(0deg)" },
        { opacity: 0, transform: "translateX(-24px) rotate(-1.5deg)" },
      ],
      {
        duration: 220,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        fill: "forwards",
      },
    );
    motion.onfinish = () => ghost.remove();
    window.setTimeout(() => ghost.remove(), 600);
  }, []);

  const skip = useCallback(() => {
    if (!currentId || ordered.length < 2) return;
    flyAway();
    setLogging(false);
    setMarks({
      key: resetKey,
      skipped: [...fresh.skipped.filter((id) => id !== currentId), currentId],
      finished: fresh.finished,
    });
  }, [currentId, flyAway, fresh.finished, fresh.skipped, ordered.length, resetKey]);

  const logged = useCallback(() => {
    if (!currentId) return;
    flyAway();
    setLogging(false);
    setMarks({
      key: resetKey,
      skipped: fresh.skipped,
      finished: [...fresh.finished, currentId],
    });
  }, [currentId, flyAway, fresh.finished, fresh.skipped, resetKey]);

  // Keyboard: c claims, l logs, s skips, o opens the company. Not while typing, or with a dialog open.
  const keys = useRef({ row: current, skip, router });
  useEffect(() => {
    keys.current = { row: current, skip, router };
  });
  const claimRef = useRef(claimAction);
  useEffect(() => {
    claimRef.current = claimAction;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest('[role="listbox"]'))) return;
      if (document.querySelector("dialog[open]")) return;
      const { row, skip: skipCard, router: nav } = keys.current;
      if (!row) return;
      const key = event.key.toLowerCase();
      if (key === "c" && (row.claim.state === "free" || row.claim.state === "expired")) {
        event.preventDefault();
        claimRef.current.claim(row.company.id, row.company.name);
      } else if (key === "l" && row.claim.state === "mine") {
        event.preventDefault();
        setLogging(true);
      } else if (key === "s") {
        event.preventDefault();
        skipCard();
      } else if (key === "o") {
        event.preventDefault();
        nav.push(demoRoutes.company(ws, row.company.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  if (!current) {
    return (
      <div className="lg-focus">
        <div className="lg-fstack">
          <Empty kind="queue-focus">
            <p className="lg-empty-title" role="status">
              {emptyTitle}
            </p>
            <p>{emptyHint}</p>
          </Empty>
          <div ref={layer} className="lg-fghost-layer" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="lg-focus">
      <p className="lg-focus-count lg-sc lg-muted" aria-live="polite">
        {ordered.length} {ordered.length === 1 ? "company" : "companies"} left in this view
      </p>
      <div className="lg-fstack" data-peek={peeking.length}>
        <div className="lg-fwrap">
          {[...peeking].reverse().map((row, i) => (
            <div key={row.company.id} className="lg-fslip" data-i={peeking.length - i} aria-hidden="true" />
          ))}
          <div key={current.company.id} className="lg-fcard-in">
            <Card
              ws={ws}
              row={current}
              latest={latest.get(current.company.id)}
              claimAction={claimAction}
              logging={logging}
              canSkip={ordered.length > 1}
              onLogging={setLogging}
              onLogged={logged}
              onSkip={skip}
              cardRef={card}
            />
          </div>
        </div>
        <div ref={layer} className="lg-fghost-layer" aria-hidden="true" />
      </div>
      <p className="lg-keys lg-focus-keys" aria-label="Keyboard shortcuts for one at a time">
        <span>
          <kbd>c</kbd> claims
        </span>
        <span>
          <kbd>l</kbd> logs outreach
        </span>
        <span>
          <kbd>s</kbd> skips for now
        </span>
        <span>
          <kbd>o</kbd> opens the company
        </span>
      </p>
    </div>
  );
}
