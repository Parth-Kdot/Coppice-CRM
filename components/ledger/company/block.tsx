"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "../company.css";
import "../templates.css";

// The company page's building blocks, in reading order: the header (header.tsx: name, one line of
// facts, the notes and the ⋯ menu), the claim ticket's buttons (claim-buttons.tsx), the contacts
// (contacts.tsx), and the outreach log and history (entries.tsx). Lists show the useful few and put
// the rest one click away (ShowMore); rare actions sit in a ⋯ menu (OverflowMenu). The forms inside
// run the real server actions. This file holds the section frame and the clamped text they share.

export function Block({
  id,
  title,
  count,
  children,
  className = "",
  "data-tour": dataTour,
}: {
  id?: string;
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
  "data-tour"?: string;
}) {
  const hid = useId();
  return (
    <section id={id} className={`lg-block ${className}`} aria-labelledby={hid} data-tour={dataTour}>
      <h2 id={hid} className="lg-bh" tabIndex={-1}>
        {title}
        {count !== undefined && count > 0 && <span className="lg-bh-count">{count.toLocaleString("en-US")}</span>}
      </h2>
      {children}
    </section>
  );
}

// Text clamped to a few lines (CSS line-clamp), with "Show more" only when it is actually cut off.
export function Clamp({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, text]);
  return (
    <div className={`lg-clampbox ${className}`}>
      <p ref={ref} className="lg-clamp lg-wrap-any" data-open={open || undefined}>
        {text}
      </p>
      {(cut || open) && (
        <button type="button" className="lg-linkbtn lg-clamp-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
