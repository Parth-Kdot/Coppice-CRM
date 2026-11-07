"use client";

import { useEffect, useRef } from "react";
import { WarningIcon } from "@/components/ledger/icons";
import { Count } from "@/components/ledger/shared";
import { Tick } from "@/components/ledger/marks";

// The importer's summary, at the top of the review and stuck there while the page scrolls: what
// the import will do as the choices stand, a jump to the next group to review, and an Import
// button so nobody has to scroll past every group. Groups not confirmed use the choice they show.
// A refused import says so here too, with a link to the reason in step 4.

export function ImportSummary({
  importing,
  skipping,
  toReview,
  errored,
  unconfirmed,
  changed,
  onJump,
  onImport,
  disabled,
  pending,
  failed,
  onSeeError,
}: {
  importing: number;
  skipping: number;
  toReview: number;
  errored: number;
  // What the unconfirmed groups will use, or null when every group is confirmed.
  unconfirmed: string | null;
  // Whether a group not confirmed yet shows a choice other than its suggested one.
  changed: boolean;
  onJump: (() => void) | null;
  onImport: () => void;
  disabled: boolean;
  pending: boolean;
  // The last import was refused; its reason is in step 4.
  failed: boolean;
  onSeeError: () => void;
}) {
  const companies = importing === 1 ? "company" : "companies";
  // What the review scrolls to sits under the bar (scroll-margin in pages.css), so the room the bar
  // takes is measured and kept up to date as it wraps or grows.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    const host = el?.closest<HTMLElement>(".lg-importer");
    if (!el || !host) return;
    const measure = () => host.style.setProperty("--importbar-room", `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--importbar-room");
    };
  }, []);

  const label = pending ? "Working..." : !unconfirmed ? `Import ${importing} ${companies}` : changed ? "Import now with the choices shown" : "Import now with suggested choices";
  return (
    <section className="lg-importbar" aria-label="Import summary" ref={bar}>
      <p className="lg-importbar-line">
        Will import <Count value={importing} className="lg-importbar-n" />, will skip <Count value={skipping} className="lg-importbar-n" />
        {toReview > 0 ? (
          <>
            , <Count value={toReview} className="lg-importbar-n" /> {toReview === 1 ? "group" : "groups"} to review
          </>
        ) : (
          <span className="lg-importbar-ok">
            , every group decided <Tick size={14} auto={false} />
          </span>
        )}
        {errored > 0 && <>, {errored} can&apos;t be imported</>}
      </p>
      <div className="lg-importbar-acts">
        {onJump && toReview > 0 && (
          <a
            href="#"
            className="lg-link"
            aria-label="Next group to review"
            onClick={(event) => {
              event.preventDefault();
              onJump();
            }}
          >
            <span className="lg-importbar-long">Next group to review</span>
            <span className="lg-importbar-short">Next group</span>
          </a>
        )}
        <button type="button" className="lg-btn lg-btn-primary lg-btn-sm" disabled={disabled} onClick={onImport}>
          {label}
        </button>
      </div>
      {unconfirmed && (
        <p className="lg-importbar-cap">
          <span className="lg-importbar-long">{unconfirmed}</span>
          {/* On a phone, one short line. */}
          <span className="lg-importbar-short">
            {toReview} open {toReview === 1 ? "group uses" : "groups use"} {changed ? "the choice shown" : "the suggested choice"}.
          </span>
        </p>
      )}
      {failed && (
        <p className="lg-importbar-err">
          <WarningIcon size={14} />
          <span>Couldn&apos;t import.</span>
          <a
            href="#"
            className="lg-link"
            onClick={(event) => {
              event.preventDefault();
              onSeeError();
            }}
          >
            See why in step 4
          </a>
        </p>
      )}
    </section>
  );
}
