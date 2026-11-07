"use client";

import { Count } from "@/components/ledger/shared";
import { Tick } from "@/components/ledger/marks";

// The importer's summary, at the top of the review and stuck there while the page scrolls: what
// the import will do as the choices stand, a jump to the next group to review, and an Import
// button so nobody has to scroll past every group. Groups not confirmed use the choice they show.

export function ImportSummary({
  importing,
  skipping,
  toReview,
  errored,
  unconfirmed,
  onJump,
  onImport,
  disabled,
  pending,
}: {
  importing: number;
  skipping: number;
  toReview: number;
  errored: number;
  // What the unconfirmed groups will use, or null when every group is confirmed.
  unconfirmed: string | null;
  onJump: (() => void) | null;
  onImport: () => void;
  disabled: boolean;
  pending: boolean;
}) {
  const companies = importing === 1 ? "company" : "companies";
  return (
    <section className="lg-importbar" aria-label="Import summary">
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
          {pending ? "Working..." : unconfirmed ? "Import now with suggested choices" : `Import ${importing} ${companies}`}
        </button>
      </div>
      {unconfirmed && <p className="lg-importbar-cap">{unconfirmed}</p>}
    </section>
  );
}
