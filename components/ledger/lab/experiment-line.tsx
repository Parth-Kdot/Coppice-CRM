"use client";

import type { TemplateOption } from "@/lib/templates";
import "./lab.css";

// The one quiet line under a template picker (the log form, the Pitch Drafter's "Base it on") while
// an experiment runs: which of its templates has the fewest sends, with a button to pick it. Code
// decides which (lib/templates.ts activeTemplates reads the arms with a `suggested` flag). Nothing
// is ever preselected, and every other template can still be picked.

export function ExperimentLine({ templates, selectedId, onUse }: { templates: TemplateOption[]; selectedId: string; onUse: (id: string) => void }) {
  const suggested = templates.find((t) => t.arm?.suggested);
  if (!suggested) return null;
  return (
    <p className="lg-hint lg-explab-line">
      <span>
        Experiment running: <strong className="lg-wrap-any">{suggested.name}</strong> has the fewest sends.
      </span>
      {selectedId !== suggested.id && (
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => onUse(suggested.id)}>
          Use it<span className="lg-sr">: {suggested.name}</span>
        </button>
      )}
    </p>
  );
}

// Whether any template in the list takes part in a running experiment (the picker's summary says so).
export const experimentRunning = (templates: TemplateOption[]): boolean => templates.some((t) => t.arm !== undefined);
