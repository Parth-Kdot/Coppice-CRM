"use client";

import { useEffect, useRef } from "react";
import { SHOOTS_FIVE, Stool } from "../stool";
import { AUDIENCE, NAME, TRUST } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";
import { useReveal } from "./reveal";

// Who it is for, the name story and trust and boundaries.

export function Audience() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  return (
    <section ref={root} className="ld-sec ld-audience" aria-labelledby="audience-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Who it is for</p>
          <h2 id="audience-title" className="ld-h2">
            {AUDIENCE.headline}
          </h2>
          <p className="ld-sub">{AUDIENCE.subhead}</p>
        </header>
        <ul className="ld-aud">
          {AUDIENCE.items.map((item, i) => (
            <li key={item.title} className="ld-reveal">
              <p className="ld-aud-no lg-num">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="ld-h3">{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// The name story: a large engraved stool beside the explainer. The first paragraph reveals word by
// word as it scrolls through the middle of the screen (blur 2 px and 30% opacity to sharp ink, in
// reading order), and reverses when you scroll back.
export function NameStory() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const para = el.querySelector<HTMLElement>(".ld-scrollwords");
      if (!para) return;
      const words = para.querySelectorAll<HTMLElement>(".ld-sw");
      const ctx = gsap.context(() => {
        gsap.fromTo(
          words,
          { opacity: 0.3, filter: "blur(2px)" },
          {
            opacity: 1,
            filter: "blur(0px)",
            ease: "none",
            stagger: 0.12,
            scrollTrigger: { trigger: para, start: "top 82%", end: "bottom 42%", scrub: true },
          },
        );
      }, el);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  const words = NAME.lead.split(" ");
  return (
    <section ref={root} id="name" className="ld-sec ld-name" aria-labelledby="name-title">
      <div className="ld-wrap ld-name-grid">
        <div className="ld-name-art ld-reveal">
          <Stool shoots={SHOOTS_FIVE} title="An engraved coppice stool: a cut stump with five shoots rising from its rim" className="ld-stool ld-name-stool">
            <g fontFamily="var(--font-sans)" fontSize={13} fill="var(--ink-2)" stroke="none">
              <text x={398} y={52}>Stems</text>
              <text x={22} y={430}>Roots</text>
            </g>
            <g fill="none" stroke="var(--ink-2)" strokeWidth={0.9} strokeLinecap="round">
              <path d="M410 58 C408 84 404 110 398 136" />
              <path d="M40 418 C44 404 52 392 62 384" />
            </g>
          </Stool>
        </div>
        <div className="ld-name-copy">
          <p className="ld-eyebrow">The name</p>
          <h2 id="name-title" className="ld-h2">
            {NAME.headline}
          </h2>
          <p className="ld-sub">
            {NAME.subhead} <span className="ld-chip lg-sc">{NAME.pronunciation}</span>
          </p>
          <p className="ld-scrollwords ld-bodybig">
            {words.map((w, i) => (
              <span key={i}>
                <span className="ld-sw">{w}</span>
                {i < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
          {NAME.paragraphs.map((p) => (
            <p key={p} className="ld-bodybig ld-reveal">
              {p}
            </p>
          ))}
          <ul className="ld-pulls ld-reveal">
            {NAME.lines.map((line) => (
              <li key={line} className="lg-quote">
                {line}
              </li>
            ))}
          </ul>
          <dl className="ld-gloss ld-reveal">
            {NAME.glossary.map((g) => (
              <div key={g.term}>
                <dt className="lg-sc">{g.term}</dt>
                <dd>{g.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

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

        <h3 className="ld-h3 ld-priv-title">Privacy notes</h3>
        <ul className="ld-ruled-list ld-ruled-two">
          {TRUST.privacy.map((item) => (
            <li key={item.title} className="ld-reveal">
              <h4 className="lg-sc ld-ruled-head">{item.title}</h4>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
