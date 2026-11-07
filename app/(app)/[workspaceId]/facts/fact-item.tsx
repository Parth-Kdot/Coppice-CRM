"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { focusSoon } from "@/components/ledger/focus";
import { CheckIcon, WarningIcon } from "@/components/ledger/icons";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { ErrorLine } from "@/components/ledger/shared";
import { FACT_MAX, type ActionResult } from "@/lib/validation";
import { groupByPage } from "./fact-groups";

// One fact on the fact sheet, everything about it at a glance: the fact in the display serif, the
// quote it was read from in italics, and whether that quote was found on its page (the page is the
// group heading above it). The owner verifies, unverifies and edits in place with one click; Delete
// waits in the ⋯ menu. Verified facts are set quieter. The moves (the stamp, the flight to the
// other section, the exit) belong to the board (fact-board.tsx), which owns the lists.

export type FactView = {
  id: string;
  text: string;
  fromPdf: boolean;
  quote: string | null;
  pageNumber: number | null;
  fileName: string | null;
  quoteFound: boolean;
  verified: boolean;
  verifiedLine: string | null;
  stale: boolean;
  masked: boolean;
};

export const MASKED_REASON = "It holds [email] or [phone], so drafts can't use it. Edit it first.";
export const factDomId = (id: string) => `fact-${id}`;
const short = (text: string) => (text.length > 48 ? `${text.slice(0, 47)}…` : text);

// What the owner can do to a fact; the board runs each one (and its move) on the row element.
export type FactHandlers = {
  verify: (fact: FactView, row: HTMLElement) => void;
  unverify: (fact: FactView, row: HTMLElement) => void;
  remove: (fact: FactView, row: HTMLElement) => void;
  // Resolves with the server's answer; `closed` runs as soon as it is ok, before any move plays,
  // so the new text is on the row when it is stamped.
  save: (fact: FactView, row: HTMLElement, text: string, closed: () => void) => Promise<ActionResult<unknown>>;
};

function QuoteLines({ fact, owner }: { fact: FactView; owner: boolean }) {
  const check =
    // A masked fact can't be used whatever its quote says, so only its reason is shown, not a tick.
    owner && fact.fromPdf && !(fact.masked && fact.quoteFound) ? (
      <span key="check" className={`lg-quotecheck ${fact.quoteFound ? "lg-ok" : "lg-late"}`}>
        {fact.quoteFound ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
        <span>{fact.quoteFound ? "Quote found on that page" : "Quote not found on that page, or it doesn't match the fact. Check the PDF."}</span>
      </span>
    ) : null;
  const meta = [
    check,
    owner && fact.verifiedLine ? <span key="by">{fact.verifiedLine}</span> : null,
    fact.stale ? (
      <span key="stale" className="lg-badge lg-badge-stale">
        Over a year old
      </span>
    ) : null,
    owner && fact.masked ? (
      <span key="masked" className="lg-late">
        {MASKED_REASON}
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <>
      {fact.fromPdf && fact.quote && (
        <p className="lg-factquote lg-quote lg-wrap-any">
          &ldquo;{fact.quote}&rdquo;
        </p>
      )}
      {meta.length > 0 && <p className="lg-factline">{meta}</p>}
    </>
  );
}

export function FactRow({ fact, busy, handlers }: { fact: FactView; busy: boolean; handlers: FactHandlers }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domId = factDomId(fact.id);
  const row = () => document.getElementById(domId);
  const canVerify = !fact.masked && (!fact.fromPdf || fact.quoteFound);
  const label = short(fact.text);
  const run = (fn: (fact: FactView, el: HTMLElement) => void) => () => {
    const el = row();
    if (el && !busy) fn(fact, el);
  };

  const openEditor = () => {
    if (busy) return;
    setError(null);
    setEditing(true);
    focusSoon(`#${domId}-edit`);
  };
  const closeEditor = () => {
    setEditing(false);
    setError(null);
    focusSoon(`#${domId}`);
  };
  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const el = row();
    if (!el || saving) return;
    const text = String(new FormData(event.currentTarget).get("text") ?? "");
    setSaving(true);
    setError(null);
    const result = await handlers.save(fact, el, text, closeEditor);
    setSaving(false);
    if (!result.ok) setError(result.error);
  };

  const btn = "lg-btn lg-btn-sm";
  let acts: ReactNode;
  if (fact.verified) {
    acts = (
      <>
        <button type="button" className={`${btn} lg-btn-quiet`} aria-label={`Edit: ${label}`} onClick={openEditor} aria-disabled={busy || undefined}>
          Edit
        </button>
        <button type="button" className={`${btn} lg-btn-quiet`} aria-label={`Unverify: ${label}`} onClick={run(handlers.unverify)} aria-disabled={busy || undefined}>
          Unverify
        </button>
      </>
    );
  } else if (canVerify) {
    acts = (
      <>
        <button type="button" className={`${btn} lg-btn-primary`} aria-label={`Verify: ${label}`} onClick={run(handlers.verify)} aria-disabled={busy || undefined}>
          Verify
        </button>
        <button type="button" className={btn} aria-label={`Edit: ${label}`} onClick={openEditor} aria-disabled={busy || undefined}>
          Edit
        </button>
      </>
    );
  } else {
    // Edit is the next step here, so it is the filled one; it keeps the second slot, as on every row.
    acts = (
      <>
        {!fact.masked && (
          <button type="button" className={btn} aria-label={`Verify anyway: ${label}`} onClick={run(handlers.verify)} aria-disabled={busy || undefined}>
            Verify anyway
          </button>
        )}
        <button type="button" className={`${btn} lg-btn-primary`} aria-label={`Edit: ${label}`} onClick={openEditor} aria-disabled={busy || undefined}>
          Edit
        </button>
      </>
    );
  }

  return (
    <li id={domId} className="lg-fact" data-verified={fact.verified || undefined} data-editing={editing || undefined} tabIndex={-1} aria-busy={busy || undefined}>
      <span className="lg-factmark" aria-hidden="true">
        <CheckIcon size={16} />
      </span>
      <div className="lg-factbody">
        {editing ? (
          <form className="lg-facteditor" onSubmit={onSave}>
            <label className="lg-sr" htmlFor={`${domId}-edit`}>
              Fact
            </label>
            <textarea
              id={`${domId}-edit`}
              name="text"
              required
              maxLength={FACT_MAX}
              rows={2}
              defaultValue={fact.text}
              className="lg-textarea lg-facteditor-input"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeEditor();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="lg-facteditor-acts">
              <button type="submit" className="lg-btn lg-btn-sm lg-btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button type="button" className="lg-btn lg-btn-sm lg-btn-quiet" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              {fact.fromPdf && <span className="lg-facteditor-note">Saving verifies it while the quote still supports it.</span>}
            </div>
            {error && <ErrorLine>{error}</ErrorLine>}
          </form>
        ) : (
          <p className="lg-facttext">{fact.text}</p>
        )}
        <QuoteLines fact={fact} owner />
      </div>
      {!editing && (
        <div className="lg-fact-acts">
          {acts}
          <OverflowMenu
            label={`More actions for: ${label}`}
            items={[{ key: "delete", label: "Delete", danger: true, disabled: busy, disabledReason: "Working...", onSelect: run(handlers.remove) }]}
          />
        </div>
      )}
    </li>
  );
}

// The officers' view: the verified facts, grouped the same way, with their quotes. No actions.
export function ReadOnlyFacts({ facts, showFile }: { facts: FactView[]; showFile: boolean }) {
  return (
    <>
      {groupByPage(facts, showFile).map((group) => (
        <section key={group.key} className="lg-factgroup" aria-label={group.title}>
          <h3 className="lg-factgroup-h lg-tag">{group.title}</h3>
          <ul className="lg-facts-list">
            {group.facts.map((fact) => (
              <li key={fact.id} className="lg-fact" data-verified="">
                <span className="lg-factmark" aria-hidden="true">
                  <CheckIcon size={16} />
                </span>
                <div className="lg-factbody">
                  <p className="lg-facttext">{fact.text}</p>
                  <QuoteLines fact={fact} owner={false} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
