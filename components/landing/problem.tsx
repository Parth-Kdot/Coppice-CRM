"use client";

import { useEffect, useRef } from "react";
import { CheckIcon } from "../ledger/icons";
import { PROBLEM } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";
import { useReveal } from "./reveal";

// The problem, as one mock spreadsheet. As each of the five problems scrolls into view its row is
// struck through in rust ink (a line drawn left to right), and what Coppice does about it is
// written under the title. Without script or with reduced motion every row is already struck.
export function Problem() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

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
      <div className="ld-wrap ld-grid ld-problem-grid">
        <header className="ld-problem-head">
          <h2 id="problem-title" className="ld-h2">
            {PROBLEM.headline}
          </h2>
          <p className="ld-sub">{PROBLEM.subhead}</p>
          <p className="ld-problem-closing">{PROBLEM.closing}</p>
        </header>

        <div className="ld-sheetfile ld-reveal" role="list">
          <p className="ld-sheetfile-name" aria-hidden="true">
            {PROBLEM.fileName}
          </p>
          {PROBLEM.items.map((item, i) => (
            <div key={item.title} className="ld-prob" role="listitem">
              <div className="ld-sheet-row" aria-hidden="true">
                <span className="ld-sheet-num">{item.sheet.row}</span>
                {item.sheet.cells.map((cell, k) => (
                  <span key={k} className="ld-sheet-cell">
                    {cell}
                  </span>
                ))}
                <span className="ld-strike" />
              </div>
              <div className="ld-prob-title">
                <h3 className="ld-h3">
                  {i + 1}. {item.title}
                </h3>
                <p className="ld-prob-note">{item.note}</p>
              </div>
              <p className="ld-prob-body">{item.body}</p>
              <p className="ld-prob-fix">
                <CheckIcon size={18} />
                <span>{item.fix}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
