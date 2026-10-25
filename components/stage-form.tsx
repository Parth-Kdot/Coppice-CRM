"use client";

import { useActionState, useState } from "react";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, STAGES, TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";

type Props = {
  workspaceId: string;
  companyId: string;
  stage: Stage;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
};

// Stage dropdown. Moving to Committed or Declined asks first, since it closes the pitch and
// releases any claim.
export function StageForm({ workspaceId, companyId, stage, action }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const [selected, setSelected] = useState(stage);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const closing = TERMINAL_STAGES.includes(selected);
        if (closing && !window.confirm(`Move to ${STAGE_LABELS[selected]}? This closes the pitch and releases any claim.`)) {
          e.preventDefault();
          // Cancelled, so show the stage the company is actually in.
          setSelected(stage);
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
      <select
        name="stage"
        value={selected}
        onChange={(e) => setSelected(e.target.value as Stage)}
        aria-label="Stage"
        className="rounded border px-2 py-1"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending || selected === stage} className="rounded border px-3 py-1 disabled:opacity-50">
        {pending ? "Moving..." : "Move"}
      </button>
      {state && !state.ok && (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
