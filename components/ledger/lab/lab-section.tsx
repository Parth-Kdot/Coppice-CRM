import { Disclosure } from "@/components/ledger/disclosure";
import { RangeBar } from "@/components/ledger/stats-blocks";
import { day } from "@/lib/dates";
import { formatCount, formatPct, formatRange, MATURITY_DAYS, MIN_SENDS, type Rated } from "@/lib/stats-math";
import type { ArmView, ExperimentView } from "@/lib/template-lab/experiment";
import { EndExperiment } from "./end-experiment";
import "../pages.css";
import "../stats.css";
import "./lab.css";

// The "Template Lab" disclosure of the stats page: the running experiment with its arms side by
// side, or else the last one that ended. Closed by default; the page's one primary action stays
// "Explain these numbers". The numbers are the scorecard's own (each arm counts only the sends
// logged while the experiment ran) and the verdict is exactly the text lib/template-lab/experiment.ts
// returned: nothing here compares arms or decides anything. Owners get the End control; officers
// read the same thing with no controls.

const KIND: Record<string, string> = { original: "Original", opening: "Opening", ask: "The ask", closing: "Closing", shorter: "Shorter" };

function rateText(stat: Rated): string {
  return stat.rate === null ? "None yet" : formatPct(stat.rate);
}
function rangeText(stat: Rated): string {
  return stat.interval ? formatRange(stat.interval) : "None yet";
}

// "Too few yet" and its count, or "Rated"; the same wording as the table.
function Standing({ stat }: { stat: Rated }) {
  if (stat.status === "none") return <span className="lg-muted">No sends yet</span>;
  if (stat.status === "too_few")
    return (
      <span className="lg-standing">
        <span className="lg-badge lg-badge-stale">Too few yet</span>
        <span className="lg-hint">
          {formatCount(stat.counted)} of {MIN_SENDS} sends
        </span>
      </span>
    );
  return <span className="lg-muted">Rated</span>;
}

function ArmCard({ arm }: { arm: ArmView }) {
  const { stat } = arm;
  return (
    <article className="lg-arm" data-arm={arm.templateId} data-label={arm.label} aria-label={`Arm ${arm.label}: ${arm.name}`}>
      <header className="lg-arm-head">
        <span className="lg-arm-letter" aria-hidden="true">
          {arm.label}
        </span>
        <div className="lg-arm-who">
          <strong className="lg-wrap-any">{arm.name}</strong>
          <span className="lg-hint">
            Arm {arm.label}, {KIND[arm.kind]?.toLowerCase() ?? arm.kind}
          </span>
        </div>
      </header>
      {arm.kind !== "original" && arm.summary && <p className="lg-arm-summary">{arm.summary}</p>}
      <dl className="lg-arm-nums">
        <div>
          <dt>Sends</dt>
          <dd className="lg-num">{formatCount(stat.sent)}</dd>
        </div>
        <div>
          <dt>Counted</dt>
          <dd className="lg-num">{formatCount(stat.counted)}</dd>
        </div>
        <div>
          <dt>Replies</dt>
          <dd className="lg-num">{formatCount(stat.replies)}</dd>
        </div>
        <div>
          <dt>Reply rate</dt>
          <dd className="lg-num">{rateText(stat)}</dd>
        </div>
        <div>
          <dt>Likely range</dt>
          <dd className="lg-num">{rangeText(stat)}</dd>
        </div>
      </dl>
      <RangeBar stat={stat} />
      <p className="lg-arm-standing">
        <Standing stat={stat} />
      </p>
    </article>
  );
}

// An arm of an ended experiment: one ruled line, what it was and what it got.
function ArmLine({ arm }: { arm: ArmView }) {
  const { stat } = arm;
  return (
    <li className="lg-armline" data-kept={arm.kept || undefined}>
      <span className="lg-arm-letter" aria-hidden="true">
        {arm.label}
      </span>
      <span className="lg-armline-name">
        <strong className="lg-wrap-any">{arm.name}</strong>
        <span className="lg-hint">
          Arm {arm.label}, {KIND[arm.kind]?.toLowerCase() ?? arm.kind}
        </span>
      </span>
      <span className="lg-armline-nums lg-num">
        {formatCount(stat.sent)} {stat.sent === 1 ? "send" : "sends"}, {formatCount(stat.replies)} {stat.replies === 1 ? "reply" : "replies"}, {rateText(stat)}
        {stat.interval && <span className="lg-hint"> (likely {rangeText(stat)})</span>}
      </span>
      {arm.kept ? <span className="lg-badge lg-best">Kept</span> : <span className="lg-badge lg-badge-stale">{arm.archived ? "Archived" : "Not kept"}</span>}
    </li>
  );
}

export function TemplateLab({ view, isOwner, canStart, workspaceId }: { view: ExperimentView | null; isOwner: boolean; canStart: boolean; workspaceId: string }) {
  // Officers have nothing to read until an experiment exists; an owner with AI off has nothing to do.
  if (!view && !(isOwner && canStart)) return null;

  const running = view?.status === "RUNNING";
  const count = !view ? "None yet" : running ? `Running · ${view.verdict.text}` : `Ended ${day(view.endedAt ?? view.startedAt)}`;

  return (
    <Disclosure summary="Template Lab" count={count} className="lg-stats-more lg-lab" id="template-lab">
      {!view && (
        <p className="lg-hint lg-lab-empty">
          No experiment yet. To start one, open the ⋯ menu on a template and choose Try a variant.
        </p>
      )}
      {view && (
        <div className="lg-lab-body" data-status={view.status.toLowerCase()}>
          <p className="lg-lab-when">
            {running
              ? `Running since ${day(view.startedAt)}.`
              : `Ran ${day(view.startedAt)} to ${day(view.endedAt ?? view.startedAt)}.`}
          </p>
          <p className="lg-lab-verdict" data-verdict={view.verdict.status} role="status">
            {view.verdict.text}
          </p>
          <p className="lg-hint lg-lab-rule">
            Only sends logged while the experiment ran count. A send counts once it is {MATURITY_DAYS} days old, and an arm is rated after {MIN_SENDS}{" "}
            counted sends. One arm is called ahead only when its whole likely range sits above every other arm&apos;s.
          </p>
          {running ? (
            <div className="lg-arms" data-arms={view.arms.length}>
              {view.arms.map((arm) => (
                <ArmCard key={arm.templateId} arm={arm} />
              ))}
            </div>
          ) : (
            <ul className="lg-armlines" aria-label="Arms of the last experiment">
              {view.arms.map((arm) => (
                <ArmLine key={arm.templateId} arm={arm} />
              ))}
            </ul>
          )}
          {running && isOwner && (
            <EndExperiment workspaceId={workspaceId} experimentId={view.id} arms={view.arms.map((a) => ({ templateId: a.templateId, label: a.label, name: a.name }))} />
          )}
          {running && !isOwner && <p className="lg-hint">An owner ends the experiment and chooses which template to keep.</p>}
          {!running && <p className="lg-hint">The templates that were not kept are archived, not deleted. Their history stays in the table above.</p>}
        </div>
      )}
    </Disclosure>
  );
}
