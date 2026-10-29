"use client";

import { useId, useState } from "react";
import { FAQ, START } from "./copy";

// Get started and the FAQ, side by side: four numbered steps on the left and the questions on the
// right. Each answer opens like a folded page: the height animates over 220 ms.
function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <li className={`ld-faq-item ${open ? "is-open" : ""}`}>
      <h3 className="ld-faq-h">
        <button type="button" className="ld-faq-q" aria-expanded={open} aria-controls={`${id}-a`} id={`${id}-q`} onClick={onToggle}>
          <span>{q}</span>
          <span className="ld-faq-plus" aria-hidden="true" />
        </button>
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
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section id="start" className="ld-sec ld-start" aria-labelledby="start-title">
      <div className="ld-wrap ld-grid ld-start-grid">
        <div className="ld-start-col">
          <h2 id="start-title" className="ld-h2">
            {START.headline}
          </h2>
          <p className="ld-sub">{START.note}</p>
          <ol className="ld-start-steps">
            {START.steps.map((step, i) => (
              <li key={step.title}>
                <span className="ld-start-no" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="ld-h3">{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div id="faq" className="ld-faq">
          <h2 className="ld-h3">Questions, answered</h2>
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
