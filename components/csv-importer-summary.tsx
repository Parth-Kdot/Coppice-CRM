"use client";

import { useEffect, useRef } from "react";

// The importer's summary, stuck at the top while the review scrolls: one line saying what the
// import will do as the choices stand, and the one Import button. When nothing can be imported the
// line says why and there is no button.

export function ImportSummary({
  importing,
  skipping,
  toReview,
  errored,
  zeroReason,
  onJump,
  onImport,
  disabled,
  pending,
}: {
  importing: number;
  skipping: number;
  toReview: number;
  errored: number;
  // Why nothing can be imported, when importing is 0.
  zeroReason: string;
  onJump: (() => void) | null;
  onImport: () => void;
  disabled: boolean;
  pending: boolean;
}) {
  // What the review scrolls to sits under the bar (scroll-margin in pages.css), so the room the bar
  // takes is measured and kept up to date.
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

  const n = (v: number) => v.toLocaleString("en-US");
  const companies = importing === 1 ? "company" : "companies";
  const parts = [`Importing ${n(importing)}`, ...(skipping > 0 ? [`Skipping ${n(skipping)}`] : [])];

  return (
    <section className="lg-importbar" aria-label="Import summary" ref={bar}>
      {importing === 0 ? (
        <p className="lg-importbar-line" role="status">
          {zeroReason}
        </p>
      ) : (
        <>
          <p className="lg-importbar-line" role="status">
            <span>{parts.join(" · ")}</span>
            {/* On a phone the bar stays one line; the problems are listed in the review. */}
            {errored > 0 && <span className="lg-importbar-long">{` · ${n(errored)} with problems`}</span>}
            {onJump && toReview > 0 && (
              <span className="lg-importbar-review">
                {" · "}
                <button type="button" className="lg-linkbtn" onClick={onJump}>
                  {n(toReview)} to review
                </button>
              </span>
            )}
          </p>
          <button type="button" className="lg-btn lg-btn-primary lg-btn-sm" disabled={disabled} onClick={onImport} data-tour="import-submit">
            {pending ? (
              "Working..."
            ) : (
              <span>
                Import {n(importing)}
                <span className="lg-importbar-long"> {companies}</span>
              </span>
            )}
          </button>
        </>
      )}
    </section>
  );
}
