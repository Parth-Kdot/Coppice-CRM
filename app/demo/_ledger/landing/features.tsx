"use client";

import { useRef } from "react";
import { EngravedBoard, EngravedClaim, EngravedDraft, EngravedDuplicate, EngravedLog, EngravedQueue } from "../icons";
import { FEATURES } from "./copy";
import { useReveal } from "./reveal";

const ICONS = {
  claim: EngravedClaim,
  queue: EngravedQueue,
  board: EngravedBoard,
  log: EngravedLog,
  duplicate: EngravedDuplicate,
  draft: EngravedDraft,
} as const;

// Features: a book index. Six entries in two columns, each with an engraved icon, a title that runs
// out to a page number on a dotted leader, one line in italic and two lines of detail.
export function Features() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  return (
    <section ref={root} id="features" className="ld-sec ld-features" aria-labelledby="features-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Features</p>
          <h2 id="features-title" className="ld-h2">
            {FEATURES.headline}
          </h2>
          <p className="ld-sub">{FEATURES.subhead}</p>
        </header>

        <ol className="ld-index">
          {FEATURES.items.map((item) => {
            const Icon = ICONS[item.icon as keyof typeof ICONS];
            return (
              <li key={item.title} className="ld-entry ld-reveal">
                <Icon size={48} className="ld-entry-icon" />
                <div>
                  <h3 className="ld-h3 ld-entry-title">
                    <span>
                      {item.title}
                      {"tag" in item && item.tag ? <span className="ld-tag-chip lg-sc">{item.tag}</span> : null}
                    </span>
                    <span className="ld-entry-leader" aria-hidden="true" />
                    <span className="ld-entry-page lg-num" aria-hidden="true">
                      {item.page}
                    </span>
                  </h3>
                  <p className="ld-entry-short">{item.short}</p>
                  <p className="ld-entry-long">{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
