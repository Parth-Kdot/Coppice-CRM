import type { Playbook } from "@/lib/capsule";
import { formatCount, formatPct, formatRange, MIN_SENDS, type Rated, type TemplateLine } from "@/lib/stats-math";
import { CompareTable } from "../stats-blocks";
import { monthName, plural } from "./format";

// The playbook: one ledger page of what worked this board year. Every figure is the one Template
// stats shows (lib/stats.ts), or is worked out from the year's own outreach and says how many
// companies it rests on. No model wrote any of it. Draws on the server.

const sentence = (stat: Rated) =>
  `${formatPct(stat.rate ?? 0)} of ${formatCount(stat.counted)} counted sends got a reply (likely ${formatRange(stat.interval ?? { low: 0, high: 0 })})`;

function Standing({ label, line }: { label: "Best" | "Worst"; line: TemplateLine }) {
  return (
    <p className="lg-verdict-line" data-standing={label === "Best" ? "best" : "worst"}>
      <span className={`lg-badge ${label === "Best" ? "lg-best" : "lg-worst"}`}>{label}</span>
      <span>
        <strong className="lg-verdict-name">{line.name}</strong>: {sentence(line.stat)}.
      </span>
    </p>
  );
}

const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function PlaybookView({ playbook }: { playbook: Playbook }) {
  const { best, worst, rated, byTouch, authorship, monthWithMostReplies, touchesBeforeReply, daysToReply } = playbook;
  const month = monthWithMostReplies ? monthName(monthWithMostReplies.month) : null;
  const { ai, hand, lead } = authorship;
  const touchRows = byTouch.filter((p) => p.stat.sent > 0);
  const tooEarly = !best && !worst;
  return (
    <div className="lg-cap-playbook">
      <section aria-labelledby="pb-templates">
        <h3 id="pb-templates" className="lg-cap-pbh">
          Which template works
        </h3>
        {best && <Standing label="Best" line={best} />}
        {worst && <Standing label="Worst" line={worst} />}
        {tooEarly && (
          <p>
            {rated < 2
              ? `Too early to tell which template is best or worst: it takes ${MIN_SENDS} counted sends for each to be rated, and at least two templates.`
              : "Too early to tell: the likely ranges of the templates overlap, so the numbers can't tell them apart yet."}
          </p>
        )}
        {playbook.retiredBetter && (
          <p className="lg-hint">
            A retired template did better: {playbook.retiredBetter.name} ({formatPct(playbook.retiredBetter.rate)}).
          </p>
        )}
      </section>

      {touchRows.length > 0 && (
        <section aria-labelledby="pb-touch">
          <h3 id="pb-touch" className="lg-cap-pbh">
            Reply rate by touch
          </h3>
          <CompareTable first="Touch" rows={touchRows.map((p) => ({ label: p.label, stat: p.stat }))} />
        </section>
      )}

      {ai.sent + hand.sent > 0 && (
        <section aria-labelledby="pb-author">
          <h3 id="pb-author" className="lg-cap-pbh">
            AI-drafted and hand-written
          </h3>
          <p className="lg-hint">Emails only, since an AI draft is always an email.</p>
          <CompareTable
            first="Email"
            rows={[
              { label: "From an AI draft", stat: ai, standing: lead === "ai" ? "best" : null },
              { label: "Written by hand", stat: hand, standing: lead === "hand" ? "best" : null },
            ]}
          />
        </section>
      )}

      <section aria-labelledby="pb-usual">
        <h3 id="pb-usual" className="lg-cap-pbh">
          What usually happens
        </h3>
        <dl className="lg-tally">
          <div>
            <dt>Month with the most replies</dt>
            <dd>{monthWithMostReplies && month ? `${month}, ${plural(monthWithMostReplies.count, "reply", "replies")}` : "No replies marked yet"}</dd>
          </div>
          <div>
            <dt>Usual touch that got the reply</dt>
            <dd>{touchesBeforeReply ? `Number ${days(touchesBeforeReply.median)}, from ${plural(touchesBeforeReply.n, "company", "companies")}` : "Not enough yet"}</dd>
          </div>
          <div>
            <dt>Usual days from first outreach to Replied</dt>
            <dd>{daysToReply ? `${days(daysToReply.median)}, from ${plural(daysToReply.n, "company", "companies")}` : "Not enough yet"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
