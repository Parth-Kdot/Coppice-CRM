"use client";

import { useEffect, useRef } from "react";
import { SEASONS } from "./copy";
import { MiniQueue } from "./mini-queue";
import { PIN_OK, setupGsap } from "./motion";
import { Captions, RightPage } from "./seasons-book";
import { Scene } from "./seasons-scene";
import { PIN_END, buildSeasonsTimeline, seasonAt } from "./seasons-timeline";
import "./seasons.css";

// How it works, as one pinned scene (wide screens only; a phone gets the static page), scrubbed by the
// scroll position. The timeline is 8 units: four seasons of 1.6 units, then the queue for the last 1.6.
// The pin is as long as that needs at the pace of the first version (about 241 px of scroll per unit at
// 900 px tall), and seasons-timeline.ts derives it from the length, so the two cannot drift apart.
// Four seasons of a board, each one a step of the product, each with three beats that tick off on the
// left page while they happen on the right:
//   Autumn, Import: three rows of the old sheet are read and a shoot grows with each, the columns are
//     mapped, a look-alike pair is flagged and skipped, and the summary lands.
//   Winter, Claim: company names hang from the stems; the ticket's Claim button becomes the solid
//     "Yours until" chip as the gilt ribbon drops on Kestrel; a second officer is held off and the
//     held tag shakes.
//   Spring, Log and follow up: a log entry fills in and is saved into the first ledger row; the
//     company comes back as due today and its stage glyph fills from Contacted to Replied.
//   Summer, Turnover: a clean cut sweeps down, the leaves fall as slips, the old chair line is struck
//     through, a double rule closes the board year, the new chair is written under it, and five
//     shoots regrow from the same roots, the names hanging from them again. Every row above stays.
// Then the scene settles into a framed render of the real queue page, which is where the work happens.
// Without motion (or script) the section is a plain page: the scene in summer, the four steps as
// captions with their beats, the finished panes of the right page, and the framed queue below.

export function Seasons() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();

    mm.add(PIN_OK, () => {
      el.dataset.motion = "on";
      el.dataset.season = "0";
      const ctx = gsap.context(() => {
        const tl = buildSeasonsTimeline(el, gsap);
        ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: PIN_END,
          pin: true,
          scrub: true,
          animation: tl,
          anticipatePin: 1,
          onUpdate: (self) => {
            const season = String(seasonAt(self.progress));
            if (el.dataset.season !== season) el.dataset.season = season;
          },
        });
      }, el);
      return () => {
        ctx.revert();
        delete el.dataset.motion;
        el.dataset.season = "3";
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="how" className="ld-seasons" data-season="3" aria-labelledby="seasons-title">
      <div className="ld-tints" aria-hidden="true">
        <i className="ld-tint ld-tint-0" />
        <i className="ld-tint ld-tint-1" />
        <i className="ld-tint ld-tint-2" />
        <i className="ld-tint ld-tint-3" />
      </div>
      <div className="ld-wrap ld-seasons-in">
        <header className="ld-seasons-head">
          <div className="ld-seasons-title">
            <p className="ld-eyebrow">How it works</p>
            <h2 id="seasons-title" className="ld-h2 ld-seasons-h2">
              {SEASONS.headline}
            </h2>
            <p className="ld-sub ld-seasons-sub">{SEASONS.subhead}</p>
          </div>
          <ol className="ld-season-tabs" aria-hidden="true">
            {SEASONS.steps.map((s, i) => (
              <li key={s.season} className="ld-stab" data-i={i}>
                <span className="lg-sc ld-stab-season">{s.season}</span>
                <span className="ld-stab-step">{s.tab}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className="ld-stage">
          <div className="ld-book">
            <div className="ld-page ld-page-left">
              <Captions />
            </div>

            <div className="ld-scene-wrap">
              <Scene />
            </div>

            <div className="ld-page ld-page-right">
              <RightPage />
            </div>
          </div>

          <figure className="ld-frame">
            <div className="ld-frame-win ldm-wrap">
              <MiniQueue />
            </div>
            <figcaption>
              <span className="ld-frame-title">{SEASONS.queue.title}</span>
              <span className="ld-frame-body">{SEASONS.queue.body}</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
