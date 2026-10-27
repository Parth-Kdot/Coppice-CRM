"use client";

import { useEffect, useRef } from "react";
import { Tick } from "../marks";
import { HOW } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// How it works, written as a ledger page. When it scrolls into view the ruling lines draw first (200 ms
// each), then each entry fades in left to right (90 ms apart), and a moss check mark lands in the
// margin of each entry, one after another, 400 ms apart.
export function How() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      el.dataset.js = "on";
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(el);
        const rules = q(".ld-step-rule");
        const bodies = q(".ld-step-body");
        const ticks = q(".ld-step .lg-tick");
        const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
        tl.fromTo(rules, { scaleX: 0 }, { scaleX: 1, duration: 0.2, stagger: 0.08, transformOrigin: "0% 50%" }, 0);
        tl.fromTo(bodies, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.09 }, 0.5);
        ticks.forEach((tick, i) => {
          tl.call(() => tick.classList.add("lg-tick-draw"), undefined, 0.95 + i * 0.4);
        });
        ScrollTrigger.create({ trigger: el.querySelector(".ld-steps"), start: "top 72%", once: true, onEnter: () => tl.play() });
        return () => undefined;
      }, el);
      return () => {
        ctx.revert();
        el.querySelectorAll(".lg-tick-draw").forEach((t) => t.classList.remove("lg-tick-draw"));
        delete el.dataset.js;
      };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="how" className="ld-sec ld-how" aria-labelledby="how-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">How it works</p>
          <h2 id="how-title" className="ld-h2">
            {HOW.headline}
          </h2>
          <p className="ld-sub">{HOW.subhead}</p>
        </header>

        <div className="ld-leaf-page lg-sheet">
          <ol className="ld-steps">
            {HOW.steps.map((step, i) => (
              <li key={step.title} className="ld-step">
                <span className="ld-step-rule" aria-hidden="true" />
                <div className="ld-step-margin">
                  <span className="ld-step-no lg-num">{i + 1}</span>
                  <Tick size={22} auto={false} />
                </div>
                <div className="ld-step-body">
                  <div className="ld-step-head">
                    <h3 className="ld-h3">{step.title}</h3>
                    <span className="ld-who lg-sc">{step.who}</span>
                  </div>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <ul className="ld-numbers">
          {HOW.numbers.map((n) => (
            <li key={n.what}>
              <p className="ld-bignum">
                {n.n}
                <span className="lg-sc"> {n.unit}</span>
              </p>
              <p className="ld-numcap">{n.what}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
