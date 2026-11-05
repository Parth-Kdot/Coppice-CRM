import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS } from "@/lib/stages";

// A slim route map under the company's name: a ruled line through the five stages of a pitch, a dot
// for each. Stages already passed are filled in ink, the current one is ringed in moss, and the
// ones ahead are empty. Declined is a branch that drops off the line at the stage the company left
// from; it is drawn dashed and empty until it happens. Every dot has its state in words for screen
// readers, so the fill is never the only signal. It is drawn from the company's own stage and its
// stage history, nothing else.

const LINE: Stage[] = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "IN_CONVERSATION", "COMMITTED"];

type Move = { fromStage: Stage; toStage: Stage };

// Where the branch leaves the line: the stage the company was in when it was declined, from the
// stage history, or the start of the line when the history does not say.
function branchFrom(changes: Move[], hasOutreach: boolean): number {
  const move = changes.find((s) => s.toStage === "DECLINED");
  const from = move ? LINE.indexOf(move.fromStage) : -1;
  if (from >= 0) return from;
  return hasOutreach ? 1 : 0;
}

export function RouteMap({ stage, stageChanges, hasOutreach }: { stage: Stage; stageChanges: Move[]; hasOutreach: boolean }) {
  const declined = stage === "DECLINED";
  const current = declined ? -1 : LINE.indexOf(stage);
  const leave = declined ? branchFrom(stageChanges, hasOutreach) : 3;

  const state = (i: number): "passed" | "current" | "ahead" => {
    if (declined) return i <= leave ? "passed" : "ahead";
    return i < current ? "passed" : i === current ? "current" : "ahead";
  };
  const words = { passed: "Passed", current: "Current stage", ahead: "Not reached" } as const;

  return (
    <nav className="lg-route" aria-label={`Route map. ${STAGE_LABELS[stage]} is the current stage.`}>
      <ol className="lg-route-line">
        {LINE.map((s, i) => {
          const st = state(i);
          return (
            <li key={s} className="lg-route-stop" data-state={st}>
              <span className="lg-route-dot" aria-hidden="true" />
              <span className="lg-route-label">
                {STAGE_LABELS[s]}
                <span className="lg-sr">, {words[st]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <ol className="lg-route-branchrow" aria-label="Branch">
        <li className="lg-route-branch" data-state={declined ? "current" : "ahead"} data-col={leave}>
          <span className="lg-route-elbow" aria-hidden="true" />
          <span className="lg-route-dot" aria-hidden="true" />
          <span className="lg-route-label">
            Declined
            <span className="lg-sr">, {declined ? "Current stage" : "Not reached"}</span>
          </span>
        </li>
      </ol>
    </nav>
  );
}
