"use client";

import { useActionState, useEffect, useRef } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { StageGlyph } from "@/components/ledger/icons";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, STAGES, TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  stage: Stage;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
};

// The stage control on the company page: the six stages as buttons, one click to move. The current
// stage is marked and cannot be pressed. Moving to Committed or Declined asks first, since it
// closes the pitch and releases any claim. These are plain submit buttons, not radios, so the arrow
// keys never move a company by accident. A refusal (someone else holds the company) is written
// under the buttons.
export function StageForm({ workspaceId, companyId, companyName, stage, action }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const confirm = useConfirm();
  const notify = useNotify();
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    if (state?.ok) notify("Stage moved.");
  }, [state, notify]);

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const to = submitter?.value as Stage | undefined;
        if (!to || !TERMINAL_STAGES.includes(to)) return;
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        void confirm({
          message: `Move ${companyName} to ${STAGE_LABELS[to]}? This closes the pitch and releases any claim.`,
          confirmLabel: `Move to ${STAGE_LABELS[to]}`,
        }).then((ok) => {
          if (!ok) return;
          confirmed.current = true;
          form.current?.requestSubmit(submitter);
        });
      }}
      className="lg-stagebtns"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
      <div role="group" aria-label={`Move ${companyName} to a stage`} className="lg-stagebtns-row">
        {STAGES.map((s) => {
          const here = s === stage;
          return (
            <button
              key={s}
              type="submit"
              name="stage"
              value={s}
              className="lg-stagebtn"
              aria-pressed={here}
              aria-disabled={here || pending || undefined}
              onClick={(e) => {
                if (here || pending) e.preventDefault();
              }}
            >
              <StageGlyph stage={s} size={15} />
              <span>{STAGE_LABELS[s]}</span>
              {here && <span className="lg-sr"> (current stage)</span>}
            </button>
          );
        })}
      </div>
      {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
    </form>
  );
}
