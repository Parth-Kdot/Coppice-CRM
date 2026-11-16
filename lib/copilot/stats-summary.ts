import type { Membership } from "@/lib/authz";
import { workspaceStats } from "@/lib/stats";
import { formatCount, formatPct, MIN_SENDS, type Scorecard } from "@/lib/stats-math";

// The "stats" view: a few plain sentences from the template stats the stats page shows, with no new
// math (lib/stats-math.ts does all of it). Best and worst are named only when the page would name them.

export type StatsSummary = { lines: string[]; href: string };

const percent = (rate: number | null) => (rate === null ? "no rate yet" : `${formatPct(rate)} replied`);

export function summarizeStats(card: Scorecard, workspaceId: string): StatsSummary {
  const lines: string[] = [];
  const named = (key: string | null) => card.templates.find((t) => t.key === key);
  const best = named(card.activeVerdict.best);
  const worst = named(card.activeVerdict.worst);
  if (best) lines.push(`Best template: ${best.name}, ${percent(best.stat.rate)} (${formatCount(best.stat.counted)} counted sends).`);
  if (worst) lines.push(`Weakest template: ${worst.name}, ${percent(worst.stat.rate)} (${formatCount(worst.stat.counted)} counted sends).`);
  if (!best && !worst) lines.push(`Too few sends yet to name a best or worst: a template needs ${MIN_SENDS} counted sends.`);

  const tallies = [...card.templates, card.noTemplate].map((t) => t.stat);
  const sent = tallies.reduce((n, s) => n + s.sent, 0);
  const replies = tallies.reduce((n, s) => n + s.replies, 0);
  const used = card.templates.filter((t) => t.stat.sent > 0).length;
  lines.push(
    sent === 0
      ? "No outreach has been logged yet."
      : `${formatCount(sent)} ${sent === 1 ? "email or message" : "emails and messages"} logged, ${used} of ${formatCount(card.templates.length)} ${card.templates.length === 1 ? "template" : "templates"} used, ${formatCount(replies)} counted ${replies === 1 ? "reply" : "replies"}.`,
  );
  if (card.gaps.repliedUnmarked > 0) {
    lines.push(`${formatCount(card.gaps.repliedUnmarked)} replied ${card.gaps.repliedUnmarked === 1 ? "company has" : "companies have"} no reply marked.`);
  }
  return { lines, href: `/${workspaceId}/stats` };
}

export async function statsSummary(member: Membership): Promise<StatsSummary> {
  return summarizeStats(await workspaceStats(member), member.workspaceId);
}
