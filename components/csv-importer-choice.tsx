"use client";

import { useEffect, useRef, useState } from "react";
import { ChipGroup } from "@/components/ledger/chips";
import { replayAck } from "@/components/ledger/motion";

// A choice in the importer's review, drawn as one joined switch (two options side by side) or a
// short list (a group's answers), on ChipGroup's real radio inputs. It reads as a state, not as
// buttons: a visible question above, a check on the chosen side, and one line under it saying
// what will happen. A checked radio sends no change when clicked again (or on Space), so that
// click or key is caught here and answered: the chosen side settles and "Already set" is shown
// and read out.

export type ImportChoiceOption<T extends string> = { value: T; label: string; ariaLabel?: string; suggested?: boolean };

export function ImportChoice<T extends string>({
  question,
  value,
  options,
  onChange,
  caption,
  layout = "switch",
  className = "",
}: {
  question: string;
  value: T;
  options: readonly ImportChoiceOption<T>[];
  onChange: (value: T) => void;
  caption: string;
  layout?: "switch" | "list";
  className?: string;
}) {
  const [ack, setAck] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const acknowledge = (el: Element | null) => {
    replayAck(el);
    setAck((n) => n + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAck(0), 2000);
  };
  const chosen = options.find((o) => o.value === value);

  return (
    <div className={`lg-choice ${className}`} data-layout={layout}>
      <ChipGroup
        legend={question}
        className={layout === "list" ? "lg-seg lg-seg-list" : "lg-seg"}
        value={value}
        onChange={(next) => {
          setAck(0);
          onChange(next);
        }}
        options={options.map((o) => ({
          value: o.value,
          ariaLabel: o.ariaLabel,
          label: (
            <>
              <span className="lg-seg-text">{o.label}</span>
              {o.suggested && <span className="lg-seg-sugg">Suggested</span>}
            </>
          ),
          onClick: (event) => {
            if (o.value === value) acknowledge(event.currentTarget.nextElementSibling);
          },
          // Space (or Enter) on the chosen side sends no click either: answered the same way.
          onKeyDown: (event) => {
            if (o.value !== value || (event.key !== " " && event.key !== "Enter")) return;
            event.preventDefault();
            acknowledge(event.currentTarget.nextElementSibling);
          },
        }))}
      />
      <p className="lg-seg-cap" aria-live="polite">
        {ack > 0 && (
          <span key={ack} className="lg-seg-ack">
            Already set{chosen && <span className="lg-sr">: {chosen.label}</span>}.{" "}
          </span>
        )}
        <span>{caption}</span>
      </p>
    </div>
  );
}
