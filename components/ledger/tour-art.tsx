import type { Illustration } from "@/lib/onboarding-steps";
import { STAGE_LABELS } from "@/lib/stages";

// Small static drawings of a control the page can't show right now (an empty workspace, or no row
// to claim). Decorative: the sentence above says everything.
export function Drawing({ kind }: { kind: Illustration }) {
  return (
    <div className="lg-tour-art" data-art={kind} aria-hidden="true">
      {kind === "queue" &&
        [0, 1, 2].map((i) => (
          <span key={i} className="lg-tour-art-row">
            <span className="lg-tour-art-bar" />
            <span className="lg-tour-art-chip">{i === 0 ? "3d late" : "Due today"}</span>
          </span>
        ))}
      {kind === "claim" && (
        <span className="lg-tour-art-row">
          <span className="lg-tour-art-bar" />
          <span className="lg-tour-art-btn">Claim</span>
        </span>
      )}
      {kind === "log" && (
        <>
          <span className="lg-tour-art-label">Log outreach</span>
          <span className="lg-tour-art-row">
            <span className="lg-tour-art-chip">3 days</span>
            <span className="lg-tour-art-chip" data-on="">
              7 days
            </span>
            <span className="lg-tour-art-chip">Pick</span>
          </span>
        </>
      )}
      {kind === "board" && (
        <span className="lg-tour-art-cols">
          {[STAGE_LABELS.CONTACTED, STAGE_LABELS.REPLIED, STAGE_LABELS.IN_CONVERSATION].map((label) => (
            <span key={label} className="lg-tour-art-col">
              <span className="lg-tour-art-label">{label}</span>
              <span className="lg-tour-art-slip" />
              <span className="lg-tour-art-slip" />
            </span>
          ))}
        </span>
      )}
      {kind === "draft" && (
        <span className="lg-tour-art-cols" data-two="">
          {["Draft 1", "Draft 2"].map((label) => (
            <span key={label} className="lg-tour-art-col">
              <span className="lg-tour-art-label">{label}</span>
              <span className="lg-tour-art-bar" />
              <span className="lg-tour-art-bar" />
            </span>
          ))}
        </span>
      )}
      {kind === "brief" && (
        <>
          <span className="lg-tour-art-label">Suggested doors</span>
          {["University relations", "Community giving"].map((label) => (
            <span key={label} className="lg-tour-art-row">
              <span className="lg-tour-art-bar" />
              <span className="lg-tour-art-chip">{label}</span>
            </span>
          ))}
        </>
      )}
      {kind === "check" && (
        <>
          <span className="lg-tour-art-label">Claim check: 1 line to check</span>
          <span className="lg-tour-art-line">
            We have <span className="lg-tour-art-flag">40 members</span> and meet weekly.
          </span>
        </>
      )}
    </div>
  );
}
