"use client";

import { useState } from "react";
import { STAGES, STAGE_LABELS, type Stage } from "@/demo/types";
import { StageGlyph } from "../icons";
import { useMoveStage } from "../providers";
import { ErrorLine } from "./shared";

// The stage control on the company page: the six stages as buttons, one click to move. The current
// stage is marked and cannot be pressed. Committed and Declined ask first, a move to Replied or later
// asks which outreach got the reply, and a company someone else holds says so right under the buttons
// (the shared move service does the asking). These are plain buttons, not radios, so the arrow keys
// never move a company by accident.

export function StageButtons({ ws, companyId, companyName, stage }: { ws: string; companyId: string; companyName: string; stage: Stage }) {
  const moveStage = useMoveStage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async (to: Stage) => {
    if (busy || to === stage) return;
    setError(null);
    setBusy(true);
    await moveStage({ ws, companyId, companyName, to, onError: setError });
    setBusy(false);
  };

  return (
    <div className="lg-stagebtns">
      <div role="group" aria-label={`Move ${companyName} to a stage`} className="lg-stagebtns-row">
        {STAGES.map((s) => {
          const here = s === stage;
          return (
            <button key={s} type="button" className="lg-stagebtn" aria-pressed={here} aria-disabled={here || busy || undefined} onClick={() => move(s)}>
              <StageGlyph stage={s} size={15} />
              <span>{STAGE_LABELS[s]}</span>
              {here && <span className="lg-sr"> (current stage)</span>}
            </button>
          );
        })}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
