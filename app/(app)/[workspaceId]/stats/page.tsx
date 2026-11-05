import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ledger/shared";
import { CompareTable, pct, rangeText, RULES_NOTE, SplitSwitch, TemplatesTable } from "@/components/ledger/stats-blocks";
import { requireMembershipOr404 } from "@/lib/authz";
import { workspaceStats } from "@/lib/stats";
import { MIN_SENDS, type Rated, type TemplateLine } from "@/lib/stats-math";
import { statsFiltersSchema } from "@/lib/validation";
import "@/components/ledger/pages.css";
import "@/components/ledger/stats.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/stats">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Template stats");
}

// Template stats, for every member (owner decision). One screen answers "which template works best,
// and which worst?" without reading more into small numbers than they hold: every rate has its likely
// range, thin or young samples say "not enough data yet", and best or worst is named only when the
// ranges allow it (the rules are in lib/stats-math.ts and in the note at the foot of the page).

const sentence = (stat: Rated) => `${pct(stat.rate ?? 0)} of ${stat.counted} counted sends got a reply (likely ${rangeText(stat.interval ?? { low: 0, high: 0 })})`;

function Verdict({ templates, best, worst, rated }: { templates: TemplateLine[]; best: string | null; worst: string | null; rated: number }) {
  const find = (key: string | null) => templates.find((t) => t.key === key);
  const b = find(best);
  const w = find(worst);
  const named = (label: string, line: TemplateLine) => (
    <p className="lg-verdict-line">
      <span className={`lg-badge ${label === "Best" ? "lg-best" : "lg-worst"}`}>{label}</span>
      <span>
        <strong>{line.name}</strong>
        {line.archived && " (archived)"}: {sentence(line.stat)}.
      </span>
    </p>
  );
  let why: string | null = null;
  if (rated < 2) {
    why =
      rated === 0
        ? `Not enough data yet to name a best or worst: no template has ${MIN_SENDS} counted sends.`
        : `Not enough data yet to name a best or worst: only one template has ${MIN_SENDS} counted sends.`;
  } else if (!b && !w) {
    why = "No clear best or worst yet: the likely ranges of the rated templates overlap, so the data can't tell them apart.";
  }
  return (
    <section className="lg-panel lg-verdict" aria-labelledby="stats-verdict">
      <div className="lg-panel-head">
        <h2 id="stats-verdict" className="lg-panel-title">
          Best and worst
        </h2>
        <span className="lg-panel-count">
          {rated} of {templates.length} {templates.length === 1 ? "template" : "templates"} rated
        </span>
      </div>
      <div className="lg-panel-body">
        {b && named("Best", b)}
        {w && named("Worst", w)}
        {rated >= 2 && b && !w && <p className="lg-muted">No clear worst: the others&apos; ranges overlap.</p>}
        {rated >= 2 && w && !b && <p className="lg-muted">No clear best: the others&apos; ranges overlap.</p>}
        {why && <p>{why}</p>}
      </div>
    </section>
  );
}

export default async function StatsPage({ params, searchParams }: PageProps<"/[workspaceId]/stats">) {
  const { workspaceId } = await params;
  const { userId } = await requireMembershipOr404(workspaceId);

  // A repeated URL param (?by=a&by=b) arrives as an array; use the first.
  const raw = await searchParams;
  const { by } = statsFiltersSchema.parse({ by: [raw.by].flat()[0] ?? null });
  const split = by ?? "none";
  const stats = await workspaceStats({ userId, workspaceId }, split);
  const base = `/${workspaceId}/stats`;
  const { ai, hand, lead } = stats.authorship;

  return (
    <div className="lg-page-stats">
      <PageHead title="Template stats" sub="Which templates get replies, from outreach logged in Coppice.">
        <Link href={`/${workspaceId}/settings`} className="lg-btn">
          Manage templates
        </Link>
      </PageHead>

      <Verdict templates={stats.templates} best={stats.verdict.best} worst={stats.verdict.worst} rated={stats.verdict.rated} />

      <section className="lg-panel" aria-labelledby="stats-templates">
        <div className="lg-panel-head">
          <h2 id="stats-templates" className="lg-panel-title">
            Templates
          </h2>
          <SplitSwitch base={base} current={split} />
        </div>
        <div className="lg-panel-body">
          {stats.templates.length === 0 && stats.noTemplate.stat.sent === 0 ? (
            <p className="lg-muted">
              No templates or outreach yet. Owners add templates in{" "}
              <Link href={`/${workspaceId}/settings`} className="lg-link">
                Settings
              </Link>
              .
            </p>
          ) : (
            <TemplatesTable lines={stats.templates} noTemplate={stats.noTemplate} best={stats.verdict.best} worst={stats.verdict.worst} />
          )}
          {split === "industry" && <p className="lg-hint mt-2">Each template is split by the industry of the companies it went to.</p>}
          {split === "touch" && <p className="lg-hint mt-2">Each template is split by whether it was the 1st, 2nd, or 3rd-or-later outreach to that company.</p>}
        </div>
      </section>

      <div className="lg-statgrid">
        <section className="lg-panel" aria-labelledby="stats-ai">
          <div className="lg-panel-head">
            <h2 id="stats-ai" className="lg-panel-title">
              AI-drafted and hand-written emails
            </h2>
          </div>
          <p className="lg-panel-note">Emails only, since an AI draft is always an email.</p>
          <div className="lg-panel-body">
            <CompareTable
              first="Email"
              rows={[
                { label: "From an AI draft", stat: ai, standing: lead === "ai" ? "best" : null },
                { label: "Written by hand", stat: hand, standing: lead === "hand" ? "best" : null },
              ]}
            />
            <p className="mt-3">
              {lead === "ai"
                ? "AI-drafted emails get replies more often: their whole range sits above the hand-written range."
                : lead === "hand"
                  ? "Hand-written emails get replies more often: their whole range sits above the AI-drafted range."
                  : ai.status === "rated" && hand.status === "rated"
                    ? "No clear difference yet: the two ranges overlap."
                    : `Not enough data yet to compare: each side needs ${MIN_SENDS} counted sends.`}
            </p>
          </div>
        </section>

        <section className="lg-panel" aria-labelledby="stats-touch">
          <div className="lg-panel-head">
            <h2 id="stats-touch" className="lg-panel-title">
              By touch
            </h2>
          </div>
          <p className="lg-panel-note">Every outreach, by whether it was the 1st, 2nd, or 3rd-or-later to that company.</p>
          <div className="lg-panel-body">
            <CompareTable first="Touch" rows={stats.byTouch.map((p) => ({ label: p.label, stat: p.stat }))} />
          </div>
        </section>
      </div>

      <section className="lg-panel" aria-labelledby="stats-gaps">
        <div className="lg-panel-head">
          <h2 id="stats-gaps" className="lg-panel-title">
            Gaps in the data
          </h2>
        </div>
        <div className="lg-panel-body">
          <dl className="lg-tally lg-gaps">
            <div>
              <dt>Outreach with no template</dt>
              <dd>{stats.gaps.noTemplate}</dd>
            </div>
            <div>
              <dt>Replied companies with no reply marked</dt>
              <dd data-tone={stats.gaps.repliedUnmarked > 0 ? "bad" : undefined}>{stats.gaps.repliedUnmarked}</dd>
            </div>
            <div>
              <dt>Sends still maturing</dt>
              <dd>{stats.gaps.maturing}</dd>
            </div>
          </dl>
          <p className="lg-hint mt-2">
            A replied company with no reply marked counts as a miss for every template it got. Open it and press &ldquo;This got the reply&rdquo; on the right
            entry.
          </p>
        </div>
      </section>

      <section className="lg-panel" aria-labelledby="stats-rules">
        <div className="lg-panel-head">
          <h2 id="stats-rules" className="lg-panel-title">
            How to read this
          </h2>
        </div>
        <div className="lg-panel-body">
          <ul className="lg-rules">
            {RULES_NOTE.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
