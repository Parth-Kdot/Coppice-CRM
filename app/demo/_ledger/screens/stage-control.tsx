"use client";

import { useId, useState } from "react";
import { formatDay } from "@/demo/dates";
import { STAGES, STAGE_LABELS, isTerminalStage, type Stage } from "@/demo/types";
import { useDemoActions, useReplyChoice } from "@/demo/store";
import { useConfirm, useNotify } from "../providers";
import { ErrorLine } from "./shared";

// The stage dropdown and Move button, on the board cards and on the company page. Move stays
// disabled until a different stage is chosen. Committed and Declined ask first. Replied or later
// asks which outreach got the reply (the prototype's addition), so reply rates per template are
// right. Cancelling puts the control back to the company's real stage.
export function StageControl({
  ws,
  companyId,
  companyName,
  stage,
  compact = false,
  onMoved,
}: {
  ws: string;
  companyId: string;
  companyName: string;
  stage: Stage;
  compact?: boolean;
  onMoved?: () => void;
}) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const id = useId();
  const [selected, setSelected] = useState<Stage>(stage);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pick, setPick] = useState<string>("none");
  const reply = useReplyChoice(ws, companyId, selected);
  const changed = selected !== stage;

  const finish = (replyOutreachId?: string | null) => {
    const result = actions.moveStage(ws, companyId, selected, replyOutreachId === undefined ? undefined : { replyOutreachId });
    setAsking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    notify(`${companyName} moved to ${STAGE_LABELS[selected]}.`);
    onMoved?.();
  };

  const move = async () => {
    setError(null);
    if (isTerminalStage(selected)) {
      const ok = await confirm({
        message: `Move to ${STAGE_LABELS[selected]}? This closes the pitch and releases any claim.`,
        confirmLabel: `Move to ${STAGE_LABELS[selected]}`,
      });
      if (!ok) {
        setSelected(stage);
        return;
      }
    }
    if (reply.needed) {
      setPick("none");
      setAsking(true);
      return;
    }
    finish();
  };

  const cancelAsk = () => {
    setAsking(false);
    setSelected(stage);
  };

  return (
    <div className={`lg-stage ${compact ? "lg-stage-compact" : ""}`}>
      <div className="lg-stage-row">
        <label className="lg-sr" htmlFor={`${id}-stage`}>
          Stage of {companyName}
        </label>
        <select
          id={`${id}-stage`}
          className="lg-select"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value as Stage);
            setError(null);
          }}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="button" className="lg-btn" disabled={!changed} onClick={move}>
          Move
        </button>
      </div>
      <ErrorLine>{error}</ErrorLine>

      {asking && (
        <dialog
          className="lg-dialog"
          aria-labelledby={`${id}-reply`}
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onCancel={(e) => {
            e.preventDefault();
            cancelAsk();
          }}
        >
          <form
            className="p-5"
            onSubmit={(e) => {
              e.preventDefault();
              finish(pick === "none" ? null : pick);
            }}
          >
            <fieldset>
              <legend id={`${id}-reply`} className="font-display text-[1.15rem] font-medium leading-snug">
                Which outreach got the reply?
              </legend>
              <p className="lg-hint mt-1">This helps the next board see which messages work. {companyName} is moving to {STAGE_LABELS[selected]}.</p>
              <div className="lg-reply-list">
                {reply.options.map((o) => (
                  <label key={o.id} className="lg-reply-opt">
                    <input type="radio" className="lg-check" name={`${id}-pick`} value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
                    <span>
                      <strong>
                        {formatDay(o.sentAt)}, {o.channelLabel}
                      </strong>{" "}
                      by {o.senderName}
                      {o.note ? <span className="lg-muted lg-quote">: {o.note.length > 80 ? `${o.note.slice(0, 80)}...` : o.note}</span> : null}
                    </span>
                  </label>
                ))}
                <label className="lg-reply-opt">
                  <input type="radio" className="lg-check" name={`${id}-pick`} value="none" checked={pick === "none"} onChange={() => setPick("none")} />
                  <span>None of these (the reply was a phone call, for example)</span>
                </label>
              </div>
            </fieldset>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="lg-btn" onClick={cancelAsk} autoFocus>
                Cancel
              </button>
              <button type="submit" className="lg-btn lg-btn-primary">
                Move to {STAGE_LABELS[selected]}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
