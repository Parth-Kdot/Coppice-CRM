import type { z } from "zod";
import { workspaceStats } from "@/lib/stats";
import { MATURITY_DAYS, MIN_SENDS, type Part, type Rated, type TemplateLine } from "@/lib/stats-math";
import { endExperiment, getExperimentView, startExperiment } from "@/lib/template-lab/lab";
import type { mcpEndExperimentSchema, mcpGetStatsSchema, mcpStartExperimentSchema } from "@/lib/validation";
import { confirmNeededLater, fromResult, iso, ok, openWorkspace, recordActivity, untrusted, type McpPrincipal, type ToolResult } from "./shared";

// Group S, stats and the Template Lab. get_stats is the numbers the stats page shows, all worked
// out by code (lib/stats-math.ts), and the experiment's state. start_experiment and end_experiment
// are the owner's Lab buttons: the variants are written by the assistant (Coppice's own model is
// never asked) and go through exactly the checks the app's proposals go through, in
// startExperiment. They work with AI off.

// A count of sends and replies with its likely range, as plain numbers.
export const ratedOut = (stat: Rated) => ({
  sent: stat.sent,
  counted: stat.counted,
  replies: stat.replies,
  stillMaturing: stat.maturing,
  replyRate: stat.rate,
  likelyRange: stat.interval,
  status: stat.status,
});

// A split's label is an industry name (typed by members) or a fixed touch label.
const partOut = (part: Part, typed: boolean) => ({ label: typed ? untrusted(part.label) : part.label, ...ratedOut(part.stat) });

export const templateLineOut = (line: TemplateLine, typedParts = false) => ({
  templateId: line.key,
  name: untrusted(line.name),
  archived: line.archived,
  ...ratedOut(line.stat),
  ...(line.parts.length > 0 ? { split: line.parts.map((p) => partOut(p, typedParts)) } : {}),
});

export async function getStatsTool(principal: McpPrincipal, args: z.infer<typeof mcpGetStatsSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const split = args.by ?? "none";
  const stats = await workspaceStats(member, split);
  const experiment = await getExperimentView(member);
  const typedParts = split === "industry";
  const named = (key: string | null) => {
    const line = stats.templates.find((t) => t.key === key);
    return line ? { templateId: line.key, name: untrusted(line.name) } : null;
  };
  const sent = stats.templates.reduce((sum, t) => sum + t.stat.sent, stats.noTemplate.stat.sent);
  const { retiredBetter } = stats.activeVerdict;
  return ok({
    stats: {
      sendsLogged: sent,
      // The page names a best or worst only when the likely ranges allow it, among templates still in use.
      best: named(stats.activeVerdict.best),
      worst: named(stats.activeVerdict.worst),
      ratedTemplates: stats.activeVerdict.rated,
      retiredTemplateDidBetter: retiredBetter ? { templateId: retiredBetter.key, name: untrusted(retiredBetter.name), replyRate: retiredBetter.rate } : null,
      templates: stats.templates.map((t) => templateLineOut(t, typedParts)),
      noTemplate: templateLineOut(stats.noTemplate, typedParts),
      byTouch: stats.byTouch.map((p) => partOut(p, false)),
      emailAuthorship: { aiDrafted: ratedOut(stats.authorship.ai), handWritten: ratedOut(stats.authorship.hand), ahead: stats.authorship.lead },
      gaps: {
        sendsWithoutTemplate: stats.gaps.noTemplate,
        repliedCompaniesWithNoReplyMarked: stats.gaps.repliedUnmarked,
        sendsStillMaturing: stats.gaps.maturing,
      },
      howToRead: `A send counts once it is ${MATURITY_DAYS} days old. A template is rated with at least ${MIN_SENDS} counted sends, and best or worst is named only when its likely range clears the others.`,
    },
    templateLab: experiment
      ? {
          experimentId: experiment.id,
          status: experiment.status === "RUNNING" ? "running" : "ended",
          startedAt: iso(experiment.startedAt),
          endedAt: iso(experiment.endedAt),
          verdict: experiment.verdict.text,
          verdictLeader: experiment.verdict.leader,
          nextSuggestedVersion: experiment.suggested,
          keptTemplateId: experiment.keptTemplateId,
          versions: experiment.arms.map((a) => ({
            templateId: a.templateId,
            version: a.label,
            name: untrusted(a.name),
            changes: a.kind,
            summary: untrusted(a.summary),
            archived: a.archived,
            kept: a.kept,
            sinceStart: ratedOut(a.stat),
          })),
        }
      : null,
  });
}

export async function startExperimentTool(principal: McpPrincipal, args: z.infer<typeof mcpStartExperimentSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "start_experiment",
      "Starting an experiment adds the variants as templates the whole team sees, and while it runs the original template's text is locked. It can be ended, but not restarted.",
    );
  }
  const result = await startExperiment(member, args.templateId, args.variants);
  return fromResult(result, async (data) => {
    await recordActivity(principal, member, { tool: "start_experiment", action: "started", targetId: data.experimentId });
    return ok({
      started: true,
      experimentId: data.experimentId,
      versions: data.arms.map((a) => ({ templateId: a.templateId, version: a.label, name: untrusted(a.name) })),
      note: "While it runs, the log form and the drafter suggest the version with the fewest sends. Check get_stats for the numbers.",
    });
  });
}

export async function endExperimentTool(principal: McpPrincipal, args: z.infer<typeof mcpEndExperimentSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "end_experiment",
      "Ending the experiment keeps one template and archives the others. The stats keep their history, but the experiment cannot be restarted.",
    );
  }
  const result = await endExperiment(member, args.experimentId, args.keepTemplateId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "end_experiment", action: "ended", targetId: args.experimentId });
    return ok({ ended: true, experimentId: args.experimentId, keptTemplateId: args.keepTemplateId });
  });
}
