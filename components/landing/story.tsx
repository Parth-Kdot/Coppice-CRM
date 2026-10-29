"use client";

import { useId, useState, type ReactNode } from "react";
import { SHOOTS_FIVE, Stool } from "../ledger/stool";
import { AUDIENCE, NAME, TRUST } from "./copy";

// Who it is for, then the name: four kinds of team as a ruled column, then the old woodland
// practice beside the engraved stool. Nothing here scrubs or loops.
export function WhoAndName() {
  return (
    <section id="name" className="ld-sec ld-who" aria-labelledby="audience-title">
      <div className="ld-wrap">
        <div className="ld-grid ld-who-grid">
          <header className="ld-who-head">
            <h2 id="audience-title" className="ld-h2">
              {AUDIENCE.headline}
            </h2>
          </header>
          <ol className="ld-aud">
            {AUDIENCE.items.map((item, i) => (
              <li key={item.title}>
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
        </div>

        <div className="ld-grid ld-name-grid">
          <div className="ld-name-art">
            <Stool shoots={SHOOTS_FIVE} title="An engraved coppice stool: a cut stump with five shoots rising from its rim" className="ld-stool ld-name-stool" />
          </div>
          <div className="ld-name-copy">
            <h2 id="name-title" className="ld-h2">
              {NAME.headline}
            </h2>
            <p className="ld-lede">{NAME.paragraph}</p>
            <p className="ld-said">
              Coppice is said <b>{NAME.pronunciation}</b>. The first syllable sounds like &ldquo;cop.&rdquo;
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// A closed accordion in the trust section. The panel is inert while closed, so nothing in it can take focus.
function Accordion({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="ld-priv">
      <h3 className="ld-priv-h">
        <button type="button" className="ld-priv-q" aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen((v) => !v)}>
          <span>
            {title}
            {note && <span className="ld-priv-note">{note}</span>}
          </span>
          <span className="ld-faq-plus" aria-hidden="true" />
        </button>
      </h3>
      <div className="lg-disclose" data-open={open}>
        <div className="lg-disclose-inner">
          <div id={`${id}-p`} inert={!open}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Trust, in my own voice where it is a choice I made. The two notes under it open on request so the
// section stays short.
export function Trust() {
  return (
    <section id="trust" className="ld-sec ld-trust" aria-labelledby="trust-title">
      <div className="ld-wrap">
        <div className="ld-grid ld-trust-grid">
          <header className="ld-trust-head">
            <h2 id="trust-title" className="ld-h2">
              {TRUST.headline}
            </h2>
            <p className="ld-sub">{TRUST.alsoOut}</p>
          </header>
          <ul className="ld-trust-list">
            {TRUST.items.map((item) => (
              <li key={item.title}>
                <h3 className="ld-h3">{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="ld-priv-wrap">
          <Accordion title={TRUST.privacyTitle}>
            <ul className="ld-priv-list">
              {TRUST.privacy.map((item) => (
                <li key={item.title}>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </Accordion>

          <Accordion title={TRUST.comingTitle} note={TRUST.comingNote}>
            <ul className="ld-coming">
              {TRUST.coming.map((item) => (
                <li key={item.title}>
                  <span className="ld-coming-tag">{item.tag}</span>
                  <div>
                    <p className="ld-coming-title">{item.title}</p>
                    <p>{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Accordion>
        </div>
      </div>
    </section>
  );
}
