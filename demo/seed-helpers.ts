import { DEMO_NOW_ISO, DEMO_TODAY } from "./clock";
import { addDaysYmd, zonedToIso } from "./dates";
import { domainKey, nameKey } from "@/lib/duplicates";
import type { Channel, Company, Contact, IsoDateTime, Outreach, Stage, StageChange } from "./types";

// Builders that turn short descriptions of companies into the full records. Dates are written as
// "days ago" or "days from today", so the data stays correct relative to DEMO_NOW.

export type OutreachSpec = {
  // Whole days before today.
  ago: number;
  // A member key from the workspace's roster, like "jordan".
  by: string;
  ch?: Channel;
  // A template key like "intro", or omitted for a hand-written message.
  tpl?: string;
  note?: string;
  // True when this is the outreach the company replied to.
  reply?: boolean;
  // The id of an AI draft this outreach was sent from.
  draft?: string;
  // Local hour of the day. Defaults to a weekday-looking hour that is never in the future.
  hour?: number;
};

export type MoveSpec = { ago: number; to: Stage; by: string; hour?: number };

export type ContactSpec = [name: string, title: string, email?: string | null];

// [who holds it, hours from DEMO_NOW until the claim expires] or [who, "auto"], which means the
// holder's latest outreach plus the claim window, like a claim renewed by logging outreach.
export type ClaimSpec = [by: string, expires: number | "auto"];

export type CompanySpec = {
  id: string;
  name: string;
  industry?: string;
  website?: string;
  notes?: string;
  stage?: Stage;
  // Days from today until the follow-up. Negative is overdue, zero is due today, omitted is none.
  follow?: number;
  claim?: ClaimSpec;
  contacts?: ContactSpec[];
  outreach?: OutreachSpec[];
  // Stage moves after the automatic Not contacted to Contacted move at the first outreach.
  moves?: MoveSpec[];
  // Days ago the company was added. Defaults to a few days before its first outreach.
  created?: number;
  // Days ago the company was archived.
  archived?: number;
};

export type BuildContext = {
  workspaceId: string;
  claimWindowDays: number;
  // Member key to user id.
  users: Record<string, string>;
  // Template key to template id.
  templates: Record<string, string>;
};

export type Built = { companies: Company[]; contacts: Contact[]; outreach: Outreach[]; stageChanges: StageChange[] };

const at = (ago: number, hour: number): IsoDateTime => zonedToIso(addDaysYmd(DEMO_TODAY, -ago), hour);

function emailFor(name: string, website: string | undefined, companyId: string): string {
  const [first, ...rest] = name.toLowerCase().replace(/[^a-z\s'-]/g, "").trim().split(/\s+/);
  const last = rest.length > 0 ? rest[rest.length - 1] : "";
  const domain = domainKey(website ?? null);
  const parts = domain ? domain.split(".") : [];
  const site = parts.length >= 2 ? parts[parts.length - 2] : companyId;
  // The .example domain is reserved for documentation, so no real mailbox is ever addressed.
  return `${[first, last].filter(Boolean).join(".")}@${site}.example`;
}

export function buildCompanies(ctx: BuildContext, specs: CompanySpec[]): Built {
  const built: Built = { companies: [], contacts: [], outreach: [], stageChanges: [] };
  const user = (key: string): string => {
    const id = ctx.users[key];
    if (!id) throw new Error(`Unknown member key "${key}" in the demo data`);
    return id;
  };

  specs.forEach((spec, companyIndex) => {
    const stage = spec.stage ?? "NOT_CONTACTED";
    const rows = (spec.outreach ?? []).map((o, outreachIndex) => {
      const hour = o.hour ?? 10 + ((companyIndex * 3 + outreachIndex * 5) % 5);
      const tpl = o.tpl ? ctx.templates[o.tpl] : undefined;
      if (o.tpl && !tpl) throw new Error(`Unknown template key "${o.tpl}" in the demo data`);
      return {
        id: `${spec.id}-o${outreachIndex + 1}`,
        workspaceId: ctx.workspaceId,
        companyId: spec.id,
        senderId: user(o.by),
        templateId: tpl ?? null,
        channel: o.ch ?? "EMAIL",
        sentAt: at(o.ago, hour),
        note: o.note ?? null,
        gotReply: o.reply ?? false,
        aiDraftId: o.draft ?? null,
      } satisfies Outreach;
    });
    rows.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    built.outreach.push(...rows);

    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstAgo = Math.max(0, ...(spec.outreach ?? []).map((o) => o.ago));
    const createdAt = at(spec.created ?? firstAgo + 4, 9);

    // The stage history: the automatic first move, then the explicit ones in time order.
    const changes: StageChange[] = [];
    let from: Stage = "NOT_CONTACTED";
    const push = (to: Stage, changedAt: IsoDateTime, changedById: string) => {
      changes.push({ id: `${spec.id}-s${changes.length + 1}`, workspaceId: ctx.workspaceId, companyId: spec.id, changedById, fromStage: from, toStage: to, changedAt });
      from = to;
    };
    if (stage !== "NOT_CONTACTED" && first) push("CONTACTED", first.sentAt, first.senderId);
    for (const move of [...(spec.moves ?? [])].sort((a, b) => b.ago - a.ago)) push(move.to, at(move.ago, move.hour ?? 13), user(move.by));
    if (from !== stage) throw new Error(`Stage history for "${spec.id}" ends at ${from}, expected ${stage}`);
    built.stageChanges.push(...changes);

    let claimedById: string | null = null;
    let claimExpiresAt: IsoDateTime | null = null;
    if (spec.claim) {
      const [by, expires] = spec.claim;
      claimedById = user(by);
      if (expires === "auto") {
        const latest = [...rows].reverse().find((r) => r.senderId === claimedById);
        const base = latest ? Date.parse(latest.sentAt) : Date.parse(DEMO_NOW_ISO);
        claimExpiresAt = new Date(base + ctx.claimWindowDays * 24 * 60 * 60 * 1000).toISOString();
      } else {
        claimExpiresAt = new Date(Date.parse(DEMO_NOW_ISO) + expires * 60 * 60 * 1000).toISOString();
      }
    }

    built.companies.push({
      id: spec.id,
      workspaceId: ctx.workspaceId,
      name: spec.name,
      industry: spec.industry ?? null,
      website: spec.website ?? null,
      notes: spec.notes ?? null,
      nameKey: nameKey(spec.name),
      domainKey: domainKey(spec.website ?? null),
      stage,
      nextFollowUpAt: spec.follow === undefined ? null : zonedToIso(addDaysYmd(DEMO_TODAY, spec.follow)),
      lastContactedAt: last ? last.sentAt : null,
      claimedById,
      claimExpiresAt,
      archivedAt: spec.archived === undefined ? null : at(spec.archived, 11),
      createdAt,
      updatedAt: last ? last.sentAt : createdAt,
    });

    (spec.contacts ?? []).forEach(([name, title, email], i) => {
      built.contacts.push({
        id: `${spec.id}-c${i + 1}`,
        workspaceId: ctx.workspaceId,
        companyId: spec.id,
        name,
        title,
        email: email === null ? null : (email ?? emailFor(name, spec.website, spec.id)),
        createdAt,
      });
    });
  });

  return built;
}
