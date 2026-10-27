"use client";

import { useRef } from "react";
import {
  EngravedBoard,
  EngravedClaim,
  EngravedDraft,
  EngravedDuplicate,
  EngravedHistory,
  EngravedImport,
  EngravedLog,
  EngravedQueue,
} from "../icons";
import { FEATURES } from "./copy";
import { useReveal } from "./reveal";

const ICONS = {
  claim: EngravedClaim,
  queue: EngravedQueue,
  board: EngravedBoard,
  log: EngravedLog,
  duplicate: EngravedDuplicate,
  import: EngravedImport,
  draft: EngravedDraft,
  history: EngravedHistory,
} as const;

// Features: eight entries in a two-column index with engraved 48 px icons.
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
          {FEATURES.items.map((item, i) => {
            const Icon = ICONS[item.icon as keyof typeof ICONS];
            return (
              <li key={item.title} className="ld-entry ld-reveal">
                <span className="ld-entry-no lg-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Icon size={48} className="ld-entry-icon" />
                <div>
                  <h3 className="ld-h3">
                    {item.title}
                    {"tag" in item && item.tag ? <span className="ld-tag-chip lg-sc">{item.tag}</span> : null}
                  </h3>
                  <p className="ld-entry-short">{item.short}</p>
                  <p className="ld-entry-long">{item.long}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="ld-coming ld-reveal">
          <h3 className="ld-h3">Coming next</h3>
          <p className="ld-hint-line">These are announced and not built yet. Nothing below exists in the app today.</p>
          <ul>
            {FEATURES.coming.map((item) => (
              <li key={item.title}>
                <span className="ld-coming-tag lg-sc">{item.tag}</span>
                <div>
                  <p className="ld-coming-title">{item.title}</p>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="ld-roles ld-reveal">
          {FEATURES.roles.map((role) => (
            <div key={role.title}>
              <p className="lg-sc ld-roles-title">{role.title}</p>
              <p>{role.body}</p>
            </div>
          ))}
          <div>
            <p className="lg-sc ld-roles-title">Price</p>
            <p>{FEATURES.pricing}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
