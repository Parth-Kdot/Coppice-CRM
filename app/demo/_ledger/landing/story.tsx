"use client";

import { useId, useRef, useState } from "react";
import { SHOOTS_FIVE, Stool } from "../stool";
import { AUDIENCE, NAME, TRUST } from "./copy";
import { useReveal } from "./reveal";

// Who it is for and the name, in one section. Four kinds of team as ruled ledger entries, then the
// coppicing story as plain text beside the engraved stool. Nothing here scrubs or loops.
export function WhoAndName() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  return (
    <section ref={root} id="name" className="ld-sec ld-who" aria-labelledby="audience-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Who it is for</p>
          <h2 id="audience-title" className="ld-h2">
            {AUDIENCE.headline}
          </h2>
          <p className="ld-sub">{AUDIENCE.subhead}</p>
        </header>
        <ol className="ld-aud">
          {AUDIENCE.items.map((item, i) => (
            <li key={item.title} className="ld-reveal">
              <span className="ld-aud-no lg-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="ld-h3">{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="ld-name-grid">
          <div className="ld-name-art ld-reveal">
            <Stool shoots={SHOOTS_FIVE} title="An engraved coppice stool: a cut stump with five shoots rising from its rim" className="ld-stool ld-name-stool">
              <g fontFamily="var(--font-sans)" fontSize={16} fill="var(--ink-2)" stroke="none">
                <text x={384} y={52}>Stems</text>
                <text x={22} y={430}>Roots</text>
              </g>
              <g fill="none" stroke="var(--ink-2)" strokeWidth={0.9} strokeLinecap="round">
                <path d="M410 58 C408 84 404 110 398 136" />
                <path d="M40 418 C44 404 52 392 62 384" />
              </g>
            </Stool>
          </div>
          <div className="ld-name-copy ld-reveal">
            <p className="ld-eyebrow">The name</p>
            <h2 id="name-title" className="ld-h2">
              {NAME.headline}
            </h2>
            <p className="ld-sub">
              {NAME.subhead} <span className="ld-chip lg-sc">{NAME.pronunciation}</span>
            </p>
            <p className="ld-bodybig">{NAME.lead}</p>
            {NAME.paragraphs.map((p) => (
              <p key={p} className="ld-bodybig">
                {p}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="ld-priv">
      <h3 className="ld-priv-h">
        <button type="button" className="ld-priv-q" aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen((v) => !v)}>
          <span>Privacy notes</span>
          <span className="ld-faq-plus" aria-hidden="true" />
        </button>
      </h3>
      <div className="lg-disclose" data-open={open}>
        <div className="lg-disclose-inner">
          <ul id={`${id}-p`} className="ld-ruled-list ld-ruled-two" inert={!open}>
            {TRUST.privacy.map((item) => (
              <li key={item.title}>
                <h4 className="lg-sc ld-ruled-head">{item.title}</h4>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Trust: what Coppice will never do, what is coming next (and clearly not built), and the privacy
// notes, which open on request so the section stays short.
export function Trust() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  return (
    <section ref={root} id="trust" className="ld-sec ld-trust" aria-labelledby="trust-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Trust and boundaries</p>
          <h2 id="trust-title" className="ld-h2">
            {TRUST.headline}
          </h2>
          <p className="ld-sub">{TRUST.subhead}</p>
        </header>
        <ul className="ld-ruled-list">
          {TRUST.items.map((item) => (
            <li key={item.title} className="ld-reveal">
              <h3 className="lg-sc ld-ruled-head">{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
        <p className="ld-also">{TRUST.alsoOut}</p>

        <Privacy />

        <div className="ld-coming ld-reveal">
          <h3 className="ld-h3">{TRUST.comingTitle}</h3>
          <p className="ld-hint-line">{TRUST.comingNote}</p>
          <ul>
            {TRUST.coming.map((item) => (
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
      </div>
    </section>
  );
}
