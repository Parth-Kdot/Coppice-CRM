import type { z } from "zod";
import { previewImport, runImport, type CheckedRow, type ImportPreview } from "@/lib/csv";
import { MCP_IMPORT_SEEN_MAX_BYTES, type mcpPreviewImportSchema, type mcpRunImportSchema } from "@/lib/validation";
import { confirmNeeded, fromResult, ok, openWorkspace, recordActivity, refusedBy, untrusted, type McpPrincipal, type ToolResult } from "./shared";

// Group I, CSV import from text, in the app's two steps: preview_import shows what would happen
// and finds look-alikes, run_import does it, in one transaction, with the choices the preview
// gave. Both go through lib/csv.ts, so the row checks, the duplicate rules and the limits are the
// app's own. The text is capped under the request body limit, so a bigger sheet is split.

// What one answer lists of each kind of row before saying there are more.
const SHOWN = 200;

type Capped<T> = { shown: T[]; cut: number };
const cap = <T>(rows: readonly T[]): Capped<T> => ({ shown: rows.slice(0, SHOWN), cut: Math.max(0, rows.length - SHOWN) });

const rowOut = (r: CheckedRow) => ({
  row: r.row,
  name: untrusted(r.company.name),
  industry: untrusted(r.company.industry),
  website: untrusted(r.company.website),
  notes: untrusted(r.company.notes),
  contact: r.contact ? { name: untrusted(r.contact.name), email: untrusted(r.contact.email), title: untrusted(r.contact.title) } : null,
  // The messages can quote a cell (a name made from an email, for one), so they are wrapped too.
  problems: r.errors.map((m) => untrusted(m)),
  leftOut: r.warnings.map((m) => untrusted(m)),
});

const existingOut = (c: { id: string; name: string; website: string | null; archived: boolean }) => ({
  id: c.id,
  name: untrusted(c.name),
  website: untrusted(c.website),
  archived: c.archived,
});

export function previewAnswer(preview: ImportPreview): ToolResult {
  const errors = cap(preview.errors);
  const warnings = cap(preview.warnings);
  const names = cap(preview.names);
  const groups = cap(preview.groups);
  const contained = cap(preview.contained);
  const labels = cap(preview.labels);
  const cutLists = [
    ["rows with problems", errors.cut, preview.errors.length],
    ["rows with something left out", warnings.cut, preview.warnings.length],
    ["importable rows", names.cut, preview.names.length],
    ["groups of look-alikes", groups.cut, preview.groups.length],
    ["names inside other names", contained.cut, preview.contained.length],
    ["labels of grouped rows", labels.cut, preview.labels.length],
  ] as const;
  const cut = cutLists.filter(([, n]) => n > 0).map(([what, , all]) => `${what} (${all} in all)`);
  return ok({
    headers: preview.headers.map((h) => untrusted(h)),
    mapping: preview.mapping,
    nameColumnWasGuessed: preview.nameAssumed,
    rowCount: preview.rowCount,
    importableRows: preview.names.length,
    rowsWithProblems: preview.errors.length,
    sample: preview.sample.map(rowOut),
    errors: errors.shown.map((e) => ({ row: e.row, name: untrusted(e.name), problems: e.messages.map((m) => untrusted(m)) })),
    warnings: warnings.shown.map((w) => ({ row: w.row, name: untrusted(w.name), leftOut: w.messages.map((m) => untrusted(m)) })),
    lookAlikes: groups.shown.map((g) => ({ rows: g.rows, matchedOn: g.matchedOn, alreadyInCoppice: g.existing.map(existingOut) })),
    groupedRows: labels.shown.map((l) => ({ row: l.row, name: untrusted(l.name), website: untrusted(l.website) })),
    nameInsideOtherName: contained.shown.map((c) => ({
      rows: c.rows.map((r) => ({ row: r.row, name: untrusted(r.name), website: untrusted(r.website) })),
      alreadyInCoppice: c.existing.map(existingOut),
      why: untrusted(c.why),
    })),
    // Send these back to run_import: the rows to leave out by default, and the existing look-alikes the person has now seen.
    defaultSkips: preview.defaultSkips,
    seen: preview.seen,
    importableNames: names.shown.map((n) => ({ row: n.row, name: untrusted(n.name) })),
    ...(cut.length > 0
      ? { more: `Only the first ${SHOWN} are listed for: ${cut.join(", ")}. defaultSkips and seen are complete. Fix the file and preview again to see the rest.` }
      : {}),
    next:
      Buffer.byteLength(JSON.stringify(preview.seen)) > MCP_IMPORT_SEEN_MAX_BYTES
        ? "This file has more look-alikes of saved companies than one import call can carry. Split it into smaller parts and preview each part."
        : "Show the person the problems and look-alikes. After they decide which rows to skip, call run_import with the same csv, mapping, the rows to skip, seen, and confirm: true once they agree.",
  });
}

export async function previewImportTool(principal: McpPrincipal, args: z.infer<typeof mcpPreviewImportSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const result = await previewImport(member, args.csv, args.mapping ?? null);
  return fromResult(result, previewAnswer);
}

export async function runImportTool(principal: McpPrincipal, args: z.infer<typeof mcpRunImportSchema>): Promise<ToolResult> {
  // The decision needs no database read, so asking never uses up one of the person's changes.
  if (args.confirm !== true) {
    return confirmNeeded(
      "run_import",
      "This adds every row you did not skip to the shared board as new companies, with their contacts. There is no bulk undo: each company would have to be archived one by one.",
    );
  }
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const result = await runImport(member, args.csv, args.mapping, args.skip, args.seen);
  if (!result.ok) return refusedBy(result.error);
  // The activity list says that an import ran: no company or target is named, and an import that
  // added nothing writes no row.
  if (result.data.imported > 0) await recordActivity(principal, member, { tool: "run_import", action: "imported" });
  return ok({ imported: result.data.imported, skipped: result.data.skipped, leftOutWithProblems: result.data.errored });
}
