"use client";

import { useId, useRef } from "react";
import { endExperiment } from "@/app/(app)/[workspaceId]/stats/actions";
import { ActionForm } from "@/components/action-form";
import { LazyDisclosure } from "@/components/ledger/disclosure";
import { completeStamp, removeAway } from "@/components/ledger/motion-kit";
import "./lab.css";

// "End experiment", for owners: pick the arm to keep, and the others are archived (never deleted, so
// the table keeps their history). Nothing is preselected: ending is a choice, and the browser holds
// the form until one is picked. The finish moment: the kept arm is stamped and the arms that are
// leaving slide away before the page draws the ended experiment.

type Arm = { templateId: string; label: string; name: string };

export function EndExperiment({ workspaceId, experimentId, arms }: { workspaceId: string; experimentId: string; arms: Arm[] }) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);

  // The arm cards are drawn by the server (lab-section.tsx), each marked with its template id.
  const finishMoment = async () => {
    const kept = wrap.current?.querySelector<HTMLInputElement>('input[name="keepTemplateId"]:checked')?.value;
    const card = (templateId: string) => document.querySelector<HTMLElement>(`.lg-arm[data-arm="${templateId}"]`);
    await Promise.all(
      arms.map((arm) => (arm.templateId === kept ? completeStamp(card(arm.templateId)) : removeAway(card(arm.templateId), { collapse: false }))),
    );
  };

  return (
    <div ref={wrap} className="lg-endexp">
      <LazyDisclosure variant="inline" summary="End experiment" className="lg-endexp-disc">
        <ActionForm
          action={endExperiment}
          submitLabel="End experiment"
          successMessage="Experiment ended."
          confirmMessage="End the experiment? The templates you don't keep are archived. Their history stays in the stats."
          onSuccess={finishMoment}
          focusAfter="#template-lab > summary"
          className="lg-endexp-form"
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="experimentId" value={experimentId} />
          <fieldset className="lg-endexp-pick">
            <legend className="lg-label">Keep which one?</legend>
            {arms.map((arm) => (
              <label key={arm.templateId} className="lg-endexp-opt">
                <input type="radio" name="keepTemplateId" value={arm.templateId} required className="lg-check" aria-describedby={`${id}-hint`} />
                <span className="lg-arm-letter" aria-hidden="true">
                  {arm.label}
                </span>
                <span className="lg-wrap-any">
                  <span className="lg-sr">Arm {arm.label}: </span>
                  {arm.name}
                </span>
              </label>
            ))}
          </fieldset>
          <p id={`${id}-hint`} className="lg-hint">
            The others are archived, not deleted. Anything logged against them keeps counting in the table.
          </p>
        </ActionForm>
      </LazyDisclosure>
    </div>
  );
}
