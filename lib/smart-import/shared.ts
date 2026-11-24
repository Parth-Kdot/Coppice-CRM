import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { aiUsage } from "@/lib/ai/run";
import { promptSafe } from "@/lib/ai/text";
import { dbNow } from "@/lib/claims";
import type { CheckedRow, Table } from "@/lib/csv";
import type { Tenant } from "@/lib/db";
import type { ActionResult, ImportMapping } from "@/lib/validation";
import type { Quote, ReadRow } from "./check";

// What Smart import's steps share (lib/smart-import/): the messages, the AI switch, and the staged
// session a chunked reading lives in.

export type Tx = Prisma.TransactionClient;

// Longer cells are cut here, before the AI sees them; quotes are checked against the cut text.
const CELL_MAX = 500;
const SESSION_MS = 24 * 60 * 60 * 1000;
// How many earlier board years a sheet can be from.
export const PAST_YEARS = 5;

export const AI_OFF = "AI is turned off for this workspace, so Smart import is off. The normal import still works.";
// The same, said once Smart import has started: the switch must go off before the normal import.
export const AI_OFF_MIDWAY = "AI is turned off for this workspace now. Turn off Smart import above, then import.";
export const EXPIRED = "This Smart import has expired or was started elsewhere. Turn Smart import off and on to start again.";
export const FILE_CHANGED = "The file changed since Smart import started. Turn Smart import off and on to start again.";
export const REVIEW_AGAIN = "The Smart import choices don't match what was read. Review them again.";

export async function aiOn(tenant: Tenant): Promise<boolean> {
  return (await aiUsage(tenant)).enabled;
}

export const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

// Sessions started before this moment (by the database's clock) are ignored.
export const sessionSince = async () => new Date((await dbNow()).getTime() - SESSION_MS);

// Every cell of a valid row that code checks for a do-not-contact line: all of them but the company
// name and the contact's email (a name or an address can't say it). This is code, not AI, so
// nothing is sent anywhere; it runs over unticked columns too, so a "do not contact" in a Notes
// column that isn't read is still found.
export function dncCells(table: Table, valid: CheckedRow[], mapping: ImportMapping): ReadRow[] {
  const skip = new Set([mapping.name, mapping.contactEmail].filter((c) => c !== null));
  const validRows = new Set(valid.map((r) => r.row));
  return table.rows
    .filter((r) => validRows.has(r.row))
    .map((r) => ({
      row: r.row,
      cells: r.cells.flatMap((cell, column) =>
        skip.has(column) || !cell.trim() ? [] : [{ column, header: table.headers[column] ?? `Column ${column + 1}`, text: promptSafe(cell.trim()).slice(0, CELL_MAX) }],
      ),
    }));
}

// The free-text cells of a row, as the AI is shown them: masked, angle brackets swapped, cut to
// CELL_MAX. Cells with no letters ("3", "-") don't count.
function freeTextCells(table: Table, cells: string[], freeText: number[]): ReadRow["cells"] {
  return freeText.flatMap((column) => {
    const text = (cells[column] ?? "").trim();
    if (!/\p{L}/u.test(text)) return [];
    return [{ column, header: table.headers[column] ?? `Column ${column + 1}`, text: promptSafe(text).slice(0, CELL_MAX) }];
  });
}

export function readRows(table: Table, valid: CheckedRow[], freeText: number[]): ReadRow[] {
  const validRows = new Set(valid.map((r) => r.row));
  return table.rows.filter((r) => validRows.has(r.row)).map((r) => ({ row: r.row, cells: freeTextCells(table, r.cells, freeText) }));
}

// What a session stores about its rows: the ones the AI reads, and the do-not-contact rows code
// found anywhere in the sheet.
export type SessionRows = { read: number[]; dnc: ({ row: number } & Quote)[] };

export type Session = { id: string; fileHash: string; mapping: ImportMapping; freeText: number[]; rows: SessionRows; cycleStart: number; chunkCount: number; lookalikes: unknown };

// This person's session, if it is under 24 hours old (by the database's clock) and was started on
// this exact file.
export async function loadSession(tx: Tx, tenant: Tenant, sessionId: string, text: string, since: Date): Promise<ActionResult<Session>> {
  const row = await tx.importSession.findFirst({
    where: { id: sessionId, workspaceId: tenant.workspaceId, createdById: tenant.userId, createdAt: { gte: since } },
    select: { id: true, fileHash: true, mapping: true, freeText: true, rows: true, cycleStart: true, chunkCount: true, lookalikes: true },
  });
  if (!row) return { ok: false, error: EXPIRED };
  if (row.fileHash !== hashOf(text)) return { ok: false, error: FILE_CHANGED };
  return {
    ok: true,
    data: { ...row, mapping: row.mapping as ImportMapping, freeText: row.freeText as number[], rows: row.rows as unknown as SessionRows },
  };
}
