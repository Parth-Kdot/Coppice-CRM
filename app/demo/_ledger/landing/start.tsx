"use client";

import { useId, useRef, useState } from "react";
import { FAQ, START } from "./copy";
import { useReveal } from "./reveal";

// Get started (four numbered entries) and the FAQ. Each answer opens like a folded page: the height
// animates over 220 ms and the rule under the question draws across.
function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <li className={`ld-faq-item ${open ? "is-open" : ""}`}>
      <h3 className="ld-faq-h">
        <button type="button" className="ld-faq-q" aria-expanded={open} aria-controls={`${id}-a`} id={`${id}-q`} onClick={onToggle}>
          <span>{q}</span>
          <span className="ld-faq-plus" aria-hidden="true" />
        </button>
        <span className="ld-faq-rule" aria-hidden="true" />
      </h3>
      <div className="lg-disclose" data-open={open}>
        <div className="lg-disclose-inner">
          <div id={`${id}-a`} role="region" aria-labelledby={`${id}-q`} className="ld-faq-a" inert={!open}>
            <p>{a}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

export function GetStarted() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section ref={root} id="start" className="ld-sec ld-start" aria-labelledby="start-title">
      <div className="ld-wrap">
        <header className="ld-sec-head">
          <p className="ld-eyebrow">Get started</p>
          <h2 id="start-title" className="ld-h2">
            {START.headline}
          </h2>
          <p className="ld-sub">{START.subhead}</p>
        </header>
        <ol className="ld-start-steps">
          {START.steps.map((step, i) => (
            <li key={step.title} className="ld-reveal">
              <span className="ld-start-no">{i + 1}</span>
              <h3 className="ld-h3">{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div id="faq" className="ld-faq">
          <h2 className="ld-h2">Questions, answered</h2>
          <ul>
            {FAQ.map((item, i) => (
              <FaqItem key={item.q} q={item.q} a={item.a} open={open.has(i)} onToggle={() => toggle(i)} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
