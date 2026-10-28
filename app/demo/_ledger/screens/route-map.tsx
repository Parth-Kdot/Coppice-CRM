import type { CompanyDetail } from "@/demo/selectors";
import { STAGES, STAGE_LABELS, type Stage } from "@/demo/types";

// A slim route map under the company's name: a ruled line through the five stages of a pitch, a dot
// for each. Stages already passed are filled in ink, the current one is ringed in moss, and the
// ones ahead are empty. Declined is a branch that drops off the line at the stage the company left
// from; it is drawn dashed and empty until it happens. Every dot has its state in words for screen
// readers, so the fill is never the only signal.

const LINE: Stage[] = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "IN_CONVERSATION", "COMMITTED"];

// Where the branch leaves the line: the stage the company was in when it was declined, from the
// stage history, or the start of the line when the history does not say.
function branchFrom(detail: CompanyDetail): number {
  const move = detail.stageChanges.find((s) => s.toStage === "DECLINED");
  const from = move ? LINE.indexOf(move.fromStage) : -1;
  if (from >= 0) return from;
  return detail.outreach.length > 0 ? 1 : 0;
}

export function RouteMap({ detail }: { detail: CompanyDetail }) {
  const stage = detail.company.stage;
  const declined = stage === "DECLINED";
  const current = declined ? -1 : STAGES.indexOf(stage);
  const leave = declined ? branchFrom(detail) : 3;

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
            <li key={s} className="lg-route-stop" data-state={st} data-leave={declined && i === leave ? "" : undefined}>
              <span className="lg-route-dot" aria-hidden="true" />
              <span className="lg-route-label lg-sc">
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
          <span className="lg-route-label lg-sc">
            Declined
            <span className="lg-sr">, {declined ? "Current stage" : "Not reached"}</span>
          </span>
        </li>
      </ol>
    </nav>
  );
}
