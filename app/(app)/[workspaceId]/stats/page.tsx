import type { Metadata } from "next";
import Link from "next/link";
import { Disclosure } from "@/components/ledger/disclosure";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { Segmented } from "@/components/ledger/segmented";
import { PageHead } from "@/components/ledger/shared";
import { ExplainPanel } from "@/components/ledger/lab/explain-panel";
import { TemplateLab } from "@/components/ledger/lab/lab-section";
import { TryVariantMenu } from "@/components/ledger/lab/variant-menu";
import { CompareTable, RULES_NOTE, TemplatesTable } from "@/components/ledger/stats-blocks";
import { isConfigured } from "@/lib/ai/client";
import { AI_WINDOW_DAYS, aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { day } from "@/lib/dates";
import { readNarrative } from "@/lib/scorecard/explain";
import { workspaceStats } from "@/lib/stats";
import { formatCount, formatPct, formatRange, MIN_SENDS, type ActiveVerdict, type Rated, type TemplateLine } from "@/lib/stats-math";
import { getExperimentView } from "@/lib/template-lab/lab";
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
// range, thin or young samples say "too few yet", and best or worst is named only when the ranges
// allow it, among the templates people can still use (the rules are in lib/stats-math.ts and behind
// "How to read this"). Everything past the verdict and the table sits one click away. A workspace
// with no outreach yet gets one sentence and nothing else.

const sentence = (stat: Rated) =>
  `${formatPct(stat.rate ?? 0)} of ${formatCount(stat.counted)} counted sends got a reply (likely ${formatRange(stat.interval ?? { low: 0, high: 0 })})`;

function Verdict({ templates, verdict }: { templates: TemplateLine[]; verdict: ActiveVerdict }) {
  const find = (key: string | null) => templates.find((t) => t.key === key);
  const b = find(verdict.best);
  const w = find(verdict.worst);
  const { rated } = verdict;
  const inUse = templates.filter((t) => !t.archived).length;
  const named = (label: "Best" | "Worst", line: TemplateLine) => (
    <p className="lg-verdict-line" data-standing={label === "Best" ? "best" : "worst"}>
      <span className={`lg-badge ${label === "Best" ? "lg-best" : "lg-worst"}`}>{label}</span>
      <span>
        <strong className="lg-verdict-name">{line.name}</strong>: {sentence(line.stat)}.
      </span>
    </p>
  );
  let why: string | null = null;
  if (rated < 2) {
    why =
      rated === 0
        ? `Too few sends yet to name a best or worst: no template in use has ${MIN_SENDS} counted sends.`
        : `Too few sends yet to name a best or worst: only one template in use has ${MIN_SENDS} counted sends.`;
  } else if (!b && !w) {
    why = "No clear best or worst yet: the likely ranges overlap, so the data can't tell the templates apart.";
  }
  return (
    <section className="lg-panel lg-verdict" aria-labelledby="stats-verdict" data-tour="stats-verdict">
      <div className="lg-panel-head">
        <h2 id="stats-verdict" className="lg-panel-title">
          Best and worst
        </h2>
        {inUse > 0 && (
          <span className="lg-panel-count">
            {rated} of {inUse} in use rated
          </span>
        )}
      </div>
      <div className="lg-panel-body">
        {b && named("Best", b)}
        {w && named("Worst", w)}
        {rated >= 2 && b && !w && <p className="lg-muted">No clear worst: the others&apos; ranges overlap.</p>}
        {rated >= 2 && w && !b && <p className="lg-muted">No clear best: the others&apos; ranges overlap.</p>}
        {why && <p>{why}</p>}
        {verdict.retiredBetter && (
          <p className="lg-hint">
            A retired template did better: {verdict.retiredBetter.name} ({formatPct(verdict.retiredBetter.rate)}).
          </p>
        )}
      </div>
    </section>
  );
}

export default async function StatsPage({ params, searchParams }: PageProps<"/[workspaceId]/stats">) {
  const { workspaceId } = await params;
  const { userId, role } = await requireMembershipOr404(workspaceId);

  // A repeated URL param (?by=a&by=b) arrives as an array; use the first.
  const raw = await searchParams;
  const { by } = statsFiltersSchema.parse({ by: [raw.by].flat()[0] ?? null });
  const split = by ?? "none";
  const tenant = { userId, workspaceId };
  const [stats, usage, experiment] = await Promise.all([workspaceStats(tenant, split), aiUsage(tenant), getExperimentView(tenant)]);
  // The stored explanation is read, never written, here: the AI is only ever asked by its button.
  const explained = await readNarrative(tenant, split === "none" ? stats : undefined);
  const aiOn = isConfigured() && usage.enabled;
  const base = `/${workspaceId}/stats`;
  const { ai, hand, lead } = stats.authorship;
  const sent = stats.templates.reduce((sum, t) => sum + t.stat.sent, stats.noTemplate.stat.sent);

  const more =
    role === "owner" ? (
      <OverflowMenu
        label="More actions for template stats"
        items={[{ key: "manage", label: "Manage templates", href: `/${workspaceId}/settings#templates` }]}
      />
    ) : undefined;

  if (sent === 0) {
    return (
      <div className="lg-page-stats">
        <PageHead title="Template stats" sub="Which templates get replies, from outreach logged in Coppice.">
          {more}
        </PageHead>
        <p className="lg-stats-empty">Stats appear after about {MIN_SENDS} emails are logged with a template.</p>
        <p className="lg-stats-empty-act">
          {role === "owner" ? (
            <Link href={`/${workspaceId}/settings#templates`} className="lg-btn lg-btn-primary">
              Manage templates
            </Link>
          ) : (
            <Link href={`/${workspaceId}`} className="lg-btn lg-btn-primary">
              Go to the queue
            </Link>
          )}
        </p>
      </div>
    );
  }

  const authorship =
    lead === "ai"
      ? "AI-drafted emails get replies more often than hand-written ones."
      : lead === "hand"
        ? "Hand-written emails get replies more often than AI-drafted ones."
        : ai.status === "rated" && hand.status === "rated"
          ? "AI-drafted and hand-written emails: no clear difference yet."
          : "AI-drafted and hand-written emails: too few sends yet to compare.";
  const { gaps } = stats;
  const gapParts = [
    gaps.repliedUnmarked > 0 && `${formatCount(gaps.repliedUnmarked)} replied ${gaps.repliedUnmarked === 1 ? "company has" : "companies have"} no reply marked`,
    gaps.noTemplate > 0 && `${formatCount(gaps.noTemplate)} ${gaps.noTemplate === 1 ? "send has" : "sends have"} no template`,
    gaps.maturing > 0 && `${formatCount(gaps.maturing)} still maturing`,
  ].filter(Boolean);

  return (
    <div className="lg-page-stats">
      <PageHead title="Template stats" sub="Which templates get replies, from outreach logged in Coppice.">
        {more}
      </PageHead>
      <Disclosure variant="inline" summary="How to read this" className="lg-stats-how">
        <ul className="lg-rules">
          {RULES_NOTE.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Disclosure>

      <Verdict templates={stats.templates} verdict={stats.activeVerdict} />

      {(aiOn || explained.narrative) && (
        <ExplainPanel
          workspaceId={workspaceId}
          paragraphs={explained.narrative?.paragraphs ?? null}
          written={explained.narrative ? `Written by ${explained.narrative.createdByName} on ${day(explained.narrative.createdAt)}` : null}
          changed={explained.changed}
          dropped={explained.narrative?.dropped ?? 0}
          canAsk={aiOn}
          limitLine={aiOn && usage.used >= usage.limit ? `This workspace has used its ${usage.limit} AI calls for the last ${AI_WINDOW_DAYS} days.` : null}
        />
      )}

      <section className="lg-panel" aria-labelledby="stats-templates">
        <div className="lg-panel-head">
          <h2 id="stats-templates" className="lg-panel-title">
            Templates
          </h2>
          <Segmented
            label="Split each template"
            value={split}
            options={[
              { value: "none", label: "All", href: base },
              { value: "industry", label: "By industry", href: `${base}?by=industry` },
              { value: "touch", label: "By touch", href: `${base}?by=touch` },
            ]}
          />
        </div>
        <div className="lg-panel-body">
          <TemplatesTable
            lines={stats.templates}
            noTemplate={stats.noTemplate}
            best={stats.activeVerdict.best}
            worst={stats.activeVerdict.worst}
            split={split}
            rowMenu={
              role === "owner" && aiOn
                ? (line) =>
                    line.archived ? null : (
                      <span className="lg-rowmenu">
                        <TryVariantMenu workspaceId={workspaceId} templateId={line.key} templateName={line.name} running={experiment?.status === "RUNNING"} />
                      </span>
                    )
                : undefined
            }
          />
          {split === "touch" && <p className="lg-hint mt-2">Split by whether it was the 1st, 2nd, or 3rd-or-later outreach to that company.</p>}
        </div>
      </section>

      <TemplateLab view={experiment} isOwner={role === "owner"} canStart={aiOn} workspaceId={workspaceId} />

      {ai.sent + hand.sent > 0 && (
        <Disclosure summary={authorship} className="lg-stats-more">
          <p className="lg-hint">Emails only, since an AI draft is always an email.</p>
          <CompareTable
            first="Email"
            rows={[
              { label: "From an AI draft", stat: ai, standing: lead === "ai" ? "best" : null },
              { label: "Written by hand", stat: hand, standing: lead === "hand" ? "best" : null },
            ]}
          />
        </Disclosure>
      )}

      {gapParts.length > 0 && (
        <Disclosure summary={`Gaps in the data: ${gapParts.join(", ")}`} className="lg-stats-more">
          <dl className="lg-tally lg-gaps">
            <div>
              <dt>Outreach with no template</dt>
              <dd>{formatCount(gaps.noTemplate)}</dd>
            </div>
            <div>
              <dt>Replied companies with no reply marked</dt>
              <dd data-tone={gaps.repliedUnmarked > 0 ? "bad" : undefined}>{formatCount(gaps.repliedUnmarked)}</dd>
            </div>
            <div>
              <dt>Sends still maturing</dt>
              <dd>{formatCount(gaps.maturing)}</dd>
            </div>
          </dl>
          <p className="lg-hint mt-2">
            A replied company with no reply marked counts as a miss for every template it got. Open it and press &ldquo;This got the reply&rdquo; on the right
            entry.
          </p>
        </Disclosure>
      )}
    </div>
  );
}
