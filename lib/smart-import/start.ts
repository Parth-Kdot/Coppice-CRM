import { aiGate, aiUsage } from "@/lib/ai/run";
import { dbToday } from "@/lib/claims";
import { checkRows, parseCsv } from "@/lib/csv";
import { withTenant, type Tenant } from "@/lib/db";
import { SMART_MAX_ROWS, type ActionResult, type ImportMapping } from "@/lib/validation";
import { CHUNK_ROWS, findDoNotContact, type Quote } from "./check";
import { notFreeText } from "./columns";
import { boardYearOf } from "./dates";
import { findLookalikes, type LookalikeGroup } from "./lookalikes";
import { AI_OFF, aiOn, dncCells, hashOf, PAST_YEARS, readRows, sessionSince, type SessionRows } from "./shared";

export type SmartStart = {
  sessionId: string;
  chunkCount: number;
  chunkRows: number;
  rowsToRead: number;
  // Rows with free text past the 300-row cap: they import the normal way.
  overCap: number;
  cycleStart: number;
  pastYear: boolean;
  lookalikes: LookalikeGroup[];
  lookalikeNote: string | null;
  doNotContact: ({ row: number; name: string } & Quote)[];
};

// The person's choices, checked against the file and the database's today.
function checkChoices(headers: string[], { mapping, freeText, cycleStart }: { mapping: ImportMapping; freeText: number[]; cycleStart: number }, today: string): string | null {
  const current = boardYearOf(today);
  if (cycleStart > current || cycleStart < current - PAST_YEARS) return "Choose the board year the sheet is from.";
  if (freeText.some((c) => c >= headers.length)) return "The column choices don't match this file. Choose them again.";
  // The server decides what goes to Groq: never the name, email or website column.
  const taken = notFreeText(mapping);
  if (freeText.some((c) => taken.has(c))) return "Smart import can't read the company name, contact email or website column. Choose other columns.";
  return null;
}

// Starts a Smart import: checks the file and the choices, finds look-alikes, and stages a session
// listing the rows to read. No company is touched.
export async function startSmartRead(
  tenant: Tenant,
  text: string,
  choices: { mapping: ImportMapping; freeText: number[]; cycleStart: number },
): Promise<ActionResult<SmartStart>> {
  if (!(await aiOn(tenant))) return { ok: false, error: AI_OFF };
  // Refuse early (no session, no look-alike call) if the row pass can't run at all.
  const gate = await aiGate(tenant, "IMPORT_ROWS");
  if (!gate.ok) return gate;
  const today = await dbToday();

  const table = parseCsv(text);
  if (!table.ok) return table;
  const refused = checkChoices(table.data.headers, choices, today);
  if (refused) return { ok: false, error: refused };
  const { mapping, freeText, cycleStart } = choices;
  const checked = checkRows(table.data, mapping);
  if (!checked.ok) return checked;
  const valid = checked.data.filter((r) => r.errors.length === 0);

  const rows = readRows(table.data, valid, freeText).filter((r) => r.cells.length > 0);
  const read = rows.slice(0, SMART_MAX_ROWS).map((r) => r.row);

  // Said before any call is made: a sheet whose reading needs more AI calls than the workspace has
  // left would stop partway. One call per chunk, and one for the look-alikes.
  const needed = Math.ceil(read.length / CHUNK_ROWS) + 1;
  const usage = await aiUsage(tenant);
  if (read.length > 0 && usage.limit - usage.used < needed) {
    const left = Math.max(0, usage.limit - usage.used);
    return {
      ok: false,
      error: `Reading this sheet takes ${needed} AI calls, and this workspace has ${left} left for the last 30 days. Untick some columns, import without Smart import, or ask an owner to raise the limit in Settings.`,
    };
  }

  // Do-not-contact lines are looked for in every cell but the name and email, ticked or not.
  const dnc = dncCells(table.data, valid, mapping).flatMap((r) => {
    for (const cell of r.cells) {
      const hit = findDoNotContact(cell.text);
      if (hit) return [{ row: r.row, column: cell.column, header: cell.header, quote: hit }];
    }
    return [];
  });
  const { lookalikes, note } = await findLookalikes(tenant, valid);
  const nameOf = new Map(valid.map((r) => [r.row, r.company.name]));

  const since = await sessionSince();
  const session = await withTenant(tenant, async (tx) => {
    // This person's old sessions are no use to anyone: remove them here, no cron needed.
    await tx.importSession.deleteMany({ where: { workspaceId: tenant.workspaceId, createdById: tenant.userId, createdAt: { lt: since } } });
    return tx.importSession.create({
      data: {
        workspaceId: tenant.workspaceId,
        createdById: tenant.userId,
        fileHash: hashOf(text),
        mapping,
        freeText,
        rows: { read, dnc } satisfies SessionRows,
        cycleStart,
        chunkCount: Math.ceil(read.length / CHUNK_ROWS),
        lookalikes,
      },
      select: { id: true, chunkCount: true },
    });
  });
  return {
    ok: true,
    data: {
      sessionId: session.id,
      chunkCount: session.chunkCount,
      chunkRows: CHUNK_ROWS,
      rowsToRead: read.length,
      overCap: rows.length - read.length,
      cycleStart,
      pastYear: cycleStart < boardYearOf(today),
      lookalikes,
      lookalikeNote: note,
      doNotContact: dnc.map((d) => ({ ...d, name: nameOf.get(d.row) ?? "" })),
    },
  };
}
