import { align, LINE, PARAGRAPH, runsOf, splitUnits } from "@/lib/template-lab/check";

// What a variant changed, for the "Try a variant" panel: the sentences that were in the template and
// the sentences that took their place, so the one change is plain to see. It uses the same units and
// the same alignment as the checks (lib/template-lab/check.ts), so what the panel shows is what the
// checks proved: a single run of changed sentences, with everything around it the same.
//
// `was` is empty when the variant only adds sentences, and `now` is empty when it only removes them.
// Line and paragraph breaks inside the changed run are kept as breaks.

export type Change = { was: string; now: string };

const text = (units: readonly string[]): string => {
  let out = "";
  for (const unit of units) {
    if (unit === PARAGRAPH) out += "\n\n";
    else if (unit === LINE) out += "\n";
    else out += out === "" || out.endsWith("\n") ? unit : ` ${unit}`;
  }
  return out.trim();
};

// The changed run between a template and one of its variants, or null if they are the same text.
// A variant that passed the checks has exactly one run; if somehow there are more, the first is
// returned (the checks, not this, are what keep a variant to one change).
export function describeChange(original: string, variant: string): Change | null {
  const ops = align(splitUnits(original), splitUnits(variant));
  const [run] = runsOf(ops);
  if (!run) return null;
  return {
    was: text(run.filter((op) => op.op === "del").map((op) => op.unit)),
    now: text(run.filter((op) => op.op === "add").map((op) => op.unit)),
  };
}
