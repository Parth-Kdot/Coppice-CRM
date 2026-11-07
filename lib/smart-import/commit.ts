import { dbToday } from "@/lib/claims";
import { runImport, type CheckedRow, type ImportResult, type RowExtras, type SmartExtras } from "@/lib/csv";
import { addDays, localMidnight } from "@/lib/dates";
import type { Tenant } from "@/lib/db";
import { COMPANY_LIMITS, IMPORT_FIELDS, type ActionResult, type ImportMapping, type SmartDecision } from "@/lib/validation";
import type { RowProposal } from "./check";
import type { LookalikeGroup } from "./lookalikes";
import { AI_OFF_MIDWAY, aiOn, EXPIRED, FILE_CHANGED, loadSession, REVIEW_AGAIN, sessionSince, type Session, type Tx } from "./shared";

// The import (lib/smart-import/): the file goes in the normal way (lib/csv.ts runImport), plus what
// the person kept of the AI's reading, in that one transaction. Each decision is checked against
// what was staged for its row: only a field the AI proposed can be set, dates stay in range, and a
// do-not-contact row must be accepted or skipped. The session is used once and deleted with the
// import.

const sameMapping = (a: ImportMapping, b: ImportMapping) => IMPORT_FIELDS.every((f) => a[f] === b[f]);

type Staged = { proposals: Map<number, RowProposal>; codeDnc: Set<number> };

// One row's decision, checked against what was staged for it, as the fields to set; or why not.
function checkDecision(r: CheckedRow, decision: SmartDecision | undefined, proposal: RowProposal | undefined, dnc: boolean, today: string): RowExtras | string | null {
  if (dnc && !decision?.dncAccepted) return `Row ${r.row} says not to contact this company. Choose Import anyway or Skip for it.`;
  if (!decision) return null;
  // A field can only be kept if the AI proposed it for this row.
  if ((decision.stage && !proposal?.stage) || (decision.lastContactedOn && !proposal?.lastContactedOn) || (decision.followUpOn && !proposal?.followUpOn)) return REVIEW_AGAIN;
  if ((decision.contact && (!proposal?.contact || r.contact)) || (decision.note && !proposal?.note)) return REVIEW_AGAIN;
  if (decision.lastContactedOn && decision.lastContactedOn > today) return `Row ${r.row}: a last-contacted date can't be in the future.`;
  if (decision.lastContactedOn && decision.lastContactedOn < addDays(today, -730)) return `Row ${r.row}: pick a last-contacted date in the last two years.`;
  if (decision.followUpOn && (decision.followUpOn < addDays(today, -365) || decision.followUpOn > addDays(today, 365))) {
    return `Row ${r.row}: pick a follow-up date within a year of today.`;
  }
  const notes = [r.company.notes, decision.note].filter(Boolean).join("\n\n");
  if (notes.length > COMPANY_LIMITS.notes) {
    return `Row ${r.row}: its notes and the line from Smart import are over ${COMPANY_LIMITS.notes.toLocaleString("en-US")} characters. Shorten the line.`;
  }
  return {
    stage: decision.stage ?? undefined,
    lastContactedAt: decision.lastContactedOn ? localMidnight(decision.lastContactedOn) : undefined,
    nextFollowUpAt: decision.followUpOn ? localMidnight(decision.followUpOn) : undefined,
    noteLine: decision.note ?? undefined,
    contact: decision.contact ? { name: decision.contact.name, email: null, title: decision.contact.title } : undefined,
  };
}

async function stagedFor(tx: Tx, tenant: Tenant, session: Session): Promise<Staged> {
  const chunks = await tx.importChunk.findMany({ where: { sessionId: session.id, workspaceId: tenant.workspaceId }, select: { proposals: true } });
  return {
    proposals: new Map(chunks.flatMap((c) => (c.proposals as unknown as RowProposal[]).map((p) => [p.row, p] as const))),
    codeDnc: new Set(session.rows.dnc.map((d) => d.row)),
  };
}

// The session's look-alike groups, as rows and the ids of companies that still exist, for import to
// record as "separate entries" like the exact ones.
async function lookalikesFor(tx: Tx, tenant: Tenant, session: Session): Promise<SmartExtras["lookalikes"]> {
  const groups = (session.lookalikes ?? []) as LookalikeGroup[];
  const ids = [...new Set(groups.flatMap((g) => g.existing.map((c) => c.id)))];
  const found = ids.length ? await tx.company.findMany({ where: { workspaceId: tenant.workspaceId, id: { in: ids } }, select: { id: true } }) : [];
  const live = new Set(found.map((c) => c.id));
  return groups.map((g) => ({ rows: g.rows.map((r) => r.row), existing: g.existing.flatMap((c) => (live.has(c.id) ? [c.id] : [])) }));
}

export async function runSmartImport(
  tenant: Tenant,
  text: string,
  { sessionId, mapping, skip, seen, decisions }: { sessionId: string; mapping: ImportMapping; skip: number[]; seen: string[]; decisions: SmartDecision[] },
): Promise<ActionResult<ImportResult>> {
  if (!(await aiOn(tenant))) return { ok: false, error: AI_OFF_MIDWAY };
  const since = await sessionSince();
  const today = await dbToday();
  const byRow = new Map<number, SmartDecision>();
  for (const d of decisions) {
    if (byRow.has(d.row)) return { ok: false, error: REVIEW_AGAIN };
    byRow.set(d.row, d);
  }

  return runImport(tenant, text, mapping, skip, seen, async (tx, rows) => {
    const session = await loadSession(tx, tenant, sessionId, text, since);
    if (!session.ok) return session;
    if (!sameMapping(session.data.mapping, mapping)) return { ok: false, error: FILE_CHANGED };
    const { proposals, codeDnc } = await stagedFor(tx, tenant, session.data);
    const importing = new Set(rows.map((r) => r.row));
    for (const row of byRow.keys()) if (!importing.has(row) || (!proposals.has(row) && !codeDnc.has(row))) return { ok: false, error: REVIEW_AGAIN };

    const extras = new Map<number, RowExtras>();
    for (const r of rows) {
      const proposal = proposals.get(r.row);
      const checked = checkDecision(r, byRow.get(r.row), proposal, codeDnc.has(r.row) || Boolean(proposal?.doNotContact), today);
      if (typeof checked === "string") return { ok: false, error: checked };
      if (checked) extras.set(r.row, checked);
    }
    const lookalikes = await lookalikesFor(tx, tenant, session.data);

    // Used once: deleting the session is the lock. A second import of the same session at the same
    // time (a double submit, a retry, another tab) waits on this row, then finds it gone and stops
    // before writing anything.
    const used = await tx.importSession.deleteMany({ where: { id: sessionId, workspaceId: tenant.workspaceId, createdById: tenant.userId } });
    if (used.count !== 1) return { ok: false, error: EXPIRED };
    return { ok: true, data: { rows: extras, lookalikes } };
  });
}
