"use client";

import { useEffect, useRef } from "react";
import { PROBLEM } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The problem, as two facing pages. On the left, a mock spreadsheet page; on the right, a ruled
// ledger page. As each of the five problems scrolls into view its spreadsheet row is struck through
// in rust ink (a line drawn left to right over 350 ms), a handwritten margin note appears (fade and
// 4 px slide), and the Coppice fix comes up on the facing page in moss.
export function Problem() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      el.dataset.js = "on";
      const triggers = Array.from(el.querySelectorAll<HTMLElement>(".ld-prob")).map((row) =>
        ScrollTrigger.create({
          trigger: row,
          start: "top 74%",
          once: true,
          onEnter: () => row.classList.add("is-in"),
        }),
      );
      return () => {
        triggers.forEach((t) => t.kill());
        delete el.dataset.js;
        el.querySelectorAll(".ld-prob").forEach((row) => row.classList.remove("is-in"));
      };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="problem" className="ld-sec ld-problem" aria-labelledby="problem-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">The problem</p>
          <h2 id="problem-title" className="ld-h2">
            {PROBLEM.headline}
          </h2>
          <p className="ld-sub">{PROBLEM.subhead}</p>
        </header>

        <div className="ld-spread" role="list">
          <div className="ld-spread-heads" aria-hidden="true">
            <p className="ld-page-tab ld-page-tab-sheet">
              <span className="ld-sheet-file">Sponsors 2025-26 (FINAL v3).xlsx</span>
            </p>
            <p className="ld-page-tab ld-page-tab-ledger lg-sc">In Coppice</p>
          </div>
          {PROBLEM.items.map((item, i) => (
            <div key={item.title} className="ld-prob" role="listitem">
              <div className="ld-prob-sheet">
                <div className="ld-sheet-row" aria-hidden="true">
                  <span className="ld-sheet-num">{item.sheet.row}</span>
                  {item.sheet.cells.map((cell, k) => (
                    <span key={k} className="ld-sheet-cell">
                      {cell}
                    </span>
                  ))}
                  <span className="ld-strike" />
                </div>
                <p className="ld-note-hand">
                  <span>{item.note}</span>
                </p>
                <h3 className="ld-h3">
                  <span className="ld-prob-no">{i + 1}</span> {item.title}
                </h3>
                <p className="ld-prob-body">{item.body}</p>
              </div>
              <div className="ld-prob-fix">
                <p className="lg-sc ld-fix-label">What Coppice does</p>
                <p>{item.fix}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="ld-closing">{PROBLEM.closing}</p>
      </div>
    </section>
  );
}
