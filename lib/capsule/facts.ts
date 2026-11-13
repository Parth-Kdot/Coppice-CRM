import type { Stage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { CardFacts } from "./types";
import type { YearWindow } from "./year";

// The facts a card carries whether or not a model read it: read by code from the database, never
// by the model. Names are the database's (the senders' and contacts' names), and no email or phone
// number is copied in.

export type FactRows = {
  stage: Stage;
  // This board year's outreach to the company.
  outreach: { senderName: string; templateName: string | null; sentAt: Date; gotReply: boolean }[];
  contacts: { name: string; title: string | null }[];
};

const REPLY_TEMPLATES_SHOWN = 3;
const CONTACTS_SHOWN = 10;

export function cardFacts({ stage, outreach, contacts }: FactRows): CardFacts {
  const times = outreach.map((o) => o.sentAt.getTime());
  const bySender = new Map<string, number>();
  for (const o of outreach) bySender.set(o.senderName, (bySender.get(o.senderName) ?? 0) + 1);
  const templates = new Set<string>();
  for (const o of outreach) if (o.gotReply && o.templateName) templates.add(o.templateName);
  return {
    stage,
    outreachCount: outreach.length,
    replies: outreach.filter((o) => o.gotReply).length,
    firstContactAt: times.length > 0 ? new Date(Math.min(...times)).toISOString() : null,
    lastContactAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
    senders: [...bySender.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    replyTemplates: [...templates].sort((a, b) => a.localeCompare(b)).slice(0, REPLY_TEMPLATES_SHOWN),
    contacts: contacts.slice(0, CONTACTS_SHOWN).map((c) => ({ name: c.name, title: c.title })),
  };
}

// A long IN list is read in batches so no query carries thousands of parameters.
const BATCH = 500;

// The facts of each company, in flat queries (three per batch of 500 companies, never one per
// company). Inside the caller's withTenant transaction.
export async function loadFacts(tx: Prisma.TransactionClient, workspaceId: string, window: YearWindow, companyIds: readonly string[]): Promise<Map<string, CardFacts>> {
  const out = new Map<string, CardFacts>();
  for (let i = 0; i < companyIds.length; i += BATCH) {
    const ids = companyIds.slice(i, i + BATCH);
    const companies = await tx.company.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, stage: true } });
    const outreach = await tx.outreach.findMany({
      where: { workspaceId, companyId: { in: ids }, sentAt: { gte: window.from, lt: window.to } },
      select: { companyId: true, sentAt: true, gotReply: true, sender: { select: { name: true } }, template: { select: { name: true } } },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    });
    const contacts = await tx.contact.findMany({
      where: { workspaceId, companyId: { in: ids } },
      select: { companyId: true, name: true, title: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const group = <T extends { companyId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.companyId);
        if (list) list.push(row);
        else map.set(row.companyId, [row]);
      }
      return map;
    };
    const outreachOf = group(outreach);
    const contactsOf = group(contacts);
    for (const company of companies) {
      out.set(
        company.id,
        cardFacts({
          stage: company.stage,
          outreach: (outreachOf.get(company.id) ?? []).map((o) => ({ senderName: o.sender.name, templateName: o.template?.name ?? null, sentAt: o.sentAt, gotReply: o.gotReply })),
          contacts: contactsOf.get(company.id) ?? [],
        }),
      );
    }
  }
  return out;
}
