"use client";

import { useState } from "react";
import type { ImportResult } from "@/lib/csv";
import { mappingChanges, revertSmartMapping } from "@/lib/import-review";
import type { ColumnSuggestion, RowProposal, SmartChunk, SmartChunkResult, SmartOptions, SmartStart } from "@/lib/smart-import";
import { SMART_STAGES } from "@/lib/limits";
import type { ActionResult, ImportMapping, SmartDecision } from "@/lib/validation";

// Smart import, the optional half of the CSV importer (components/csv-importer.tsx). The AI only
// proposes: every reading shows the cell text it came from, and the person keeps, edits or drops
// each one before anything is imported. The browser sends the free-text rows one chunk at a time
// (lib/smart-import/), so a long sheet never needs one long server call; a rate limit pauses the
// reading for a minute (counted down on the page, with Continue to go on sooner), and the server
// never retries on its own.

type Action<T> = (prev: T | null, form: FormData) => Promise<T>;

export type SmartActions = {
  options: SmartOptions;
  suggest: Action<ActionResult<ColumnSuggestion>>;
  start: Action<ActionResult<SmartStart>>;
  read: Action<SmartChunkResult>;
  run: Action<ActionResult<ImportResult>>;
};

type ProposedStage = (typeof SMART_STAGES)[number];
type Kept<T> = { keep: boolean; value: T };
export type RowEdits = {
  stage?: Kept<ProposedStage>;
  last?: Kept<string>;
  follow?: Kept<string>;
  contact?: Kept<{ name: string; title: string }>;
  note?: Kept<string>;
};

// Every reading starts as Keep (the review says so); the person drops or edits what's wrong.
const editsFor = (p: RowProposal): RowEdits => ({
  stage: p.stage ? { keep: true, value: p.stage.value } : undefined,
  last: p.lastContactedOn ? { keep: true, value: p.lastContactedOn.date } : undefined,
  follow: p.followUpOn ? { keep: true, value: p.followUpOn.date } : undefined,
  contact: p.contact ? { keep: true, value: { name: p.contact.name, title: p.contact.title ?? "" } } : undefined,
  note: p.note ? { keep: true, value: p.note.text } : undefined,
});

export const hasReading = (p: RowProposal) => Boolean(p.stage || p.lastContactedOn || p.followUpOn || p.contact || p.note || p.doNotContact);

// What the person kept, for the import. Skipped rows send nothing. A do-not-contact row that is
// imported was chosen on purpose (it starts skipped, and every place it can be imported from says
// so), so whether it is accepted always follows the skips: the two can't drift apart and the
// server never refuses the import over it.
export function decisionsFrom(rows: number[], { skips, edits, doNotContact }: { skips: Set<number>; edits: Record<number, RowEdits>; doNotContact: Set<number> }): SmartDecision[] {
  const kept = <T>(k: Kept<T> | undefined) => (k?.keep ? k.value : null);
  return rows.flatMap((row) => {
    if (skips.has(row)) return [];
    const e = edits[row] ?? {};
    const contact = kept(e.contact);
    const decision: SmartDecision = {
      row,
      stage: kept(e.stage),
      lastContactedOn: kept(e.last) || null,
      followUpOn: kept(e.follow) || null,
      contact: contact && contact.name.trim() ? { name: contact.name.trim(), title: contact.title.trim() || null } : null,
      note: kept(e.note)?.trim() || null,
      dncAccepted: doNotContact.has(row),
    };
    const any = decision.stage || decision.lastContactedOn || decision.followUpOn || decision.contact || decision.note || decision.dncAccepted;
    return any ? [decision] : [];
  });
}

const withChunk = (current: RowProposal[], chunk: SmartChunk) =>
  [...current.filter((p) => !chunk.proposals.some((q) => q.row === p.row)), ...chunk.proposals].sort((a, b) => a.row - b.row);

// The reading: a session, the chunks read so far, and where a failed reading stopped.
function useReading() {
  const [session, setSession] = useState<(SmartStart & { mapping: string }) | null>(null);
  const [next, setNext] = useState(0);
  const [readError, setReadError] = useState<{ error: string; rateLimited: boolean; retryable: boolean } | null>(null);
  const [proposals, setProposals] = useState<RowProposal[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [edits, setEdits] = useState<Record<number, RowEdits>>({});

  const clearReading = () => {
    setSession(null);
    setNext(0);
    setReadError(null);
    setProposals([]);
    setEdits({});
  };
  const addChunk = (chunk: SmartChunk) => {
    setNames((current) => new Map([...current, ...chunk.names.map((n) => [n.row, n.name] as const)]));
    setProposals((current) => withChunk(current, chunk));
    setEdits((current) => ({ ...current, ...Object.fromEntries(chunk.proposals.map((p) => [p.row, editsFor(p)])) }));
  };
  return { session, setSession, next, setNext, readError, setReadError, proposals, names, setNames, edits, setEdits, clearReading, addChunk };
}

// Everything Smart import keeps between steps. `send` builds a form with the file in it, like the
// importer's own steps; `applyMapping` asks the importer for a new preview with other columns;
// `release` puts rows back to the preview's suggested choice when a reading that skipped them is
// thrown away.
export function useSmartImport({
  actions,
  send,
  applyMapping,
  skips,
  choose,
  release,
}: {
  // Undefined when Smart import isn't offered (AI off): the hook then does nothing.
  actions: SmartActions | undefined;
  send: (fields: Record<string, string>) => FormData | null;
  applyMapping: (mapping: ImportMapping) => void;
  skips: Set<number>;
  choose: (row: number, skip: boolean) => void;
  release: (rows: number[]) => void;
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<number[]>([]);
  const [cycle, setCycle] = useState(actions?.options.current ?? 0);
  // What turning Smart import on changed in the columns, and the columns before, for Undo.
  const [mappingNote, setMappingNote] = useState<{ changes: string[]; why: string | null; before: ImportMapping; after: ImportMapping } | null>(null);
  const reading = useReading();
  const { session, clearReading } = reading;

  // Rows the sheet says not to contact: found by code when the reading started, or by the reading.
  const doNotContact = new Set([...(session?.doNotContact ?? []).map((d) => d.row), ...reading.proposals.filter((p) => p.doNotContact).map((p) => p.row)]);
  // Rows this year's sheet says committed or declined: they start skipped too (lib/smart-import/check.ts).
  const outcomes = new Set(reading.proposals.filter((p) => p.outcome && !p.doNotContact).map((p) => p.row));
  const heldBack = new Set([...doNotContact, ...outcomes]);

  const reset = () => {
    setOn(false);
    setNote(null);
    setError(null);
    setFreeText([]);
    setMappingNote(null);
    clearReading();
  };

  // Throws the reading away. The do-not-contact rows it skipped go back to the normal suggestion,
  // so the normal import never skips a row without saying why.
  const discardReading = () => {
    if (heldBack.size > 0) release([...heldBack]);
    clearReading();
  };

  // Turning it on asks for column suggestions and applies them, and says what changed; the person
  // can undo that or change any column. Turning it off puts back the columns it changed, so the
  // normal import never loses a column (Notes) to a setting it no longer shows.
  const turn = async (value: boolean, current: { mapping: ImportMapping; headers: string[] }) => {
    const restore = !value && mappingNote ? revertSmartMapping(current.mapping, mappingNote.before, mappingNote.after) : null;
    setOn(value);
    setError(null);
    setMappingNote(null);
    discardReading();
    if (restore && JSON.stringify(restore) !== JSON.stringify(current.mapping)) applyMapping(restore);
    const form = value && actions?.options.groq ? send({}) : null;
    if (!actions || !form) return;
    setBusy(true);
    const res = await actions.suggest(null, form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFreeText(res.data.freeText);
    setNote(res.data.note);
    const changes = mappingChanges(current.mapping, res.data.mapping, current.headers);
    if (changes.length > 0) {
      const notes = current.mapping.notes;
      // Notes taken off its column because Smart import reads that column instead.
      const why =
        notes !== null && res.data.mapping.notes === null && res.data.freeText.includes(notes)
          ? `It reads "${current.headers[notes]?.trim() || `Column ${notes + 1}`}" with AI instead and proposes a line for each company's notes from it, which you can use, change or leave out. Undo keeps the column as plain notes.`
          : null;
      setMappingNote({ changes, why, before: current.mapping, after: res.data.mapping });
      applyMapping(res.data.mapping);
    }
  };
  const undoMapping = (current: ImportMapping) => {
    if (!mappingNote) return;
    discardReading();
    applyMapping(revertSmartMapping(current, mappingNote.before, mappingNote.after));
    setMappingNote(null);
  };

  // Reads chunks one after another from `from`, until done or one fails. A failure stops here;
  // Continue picks up from the same chunk, and chunks already read are kept on the server.
  const readFrom = async (started: SmartStart, from: number) => {
    if (!actions) return;
    setBusy(true);
    reading.setReadError(null);
    for (let index = from; index < started.chunkCount; index++) {
      const form = send({ sessionId: started.sessionId, index: String(index) });
      if (!form) break;
      const res = await actions.read(null, form);
      if (!res.ok) {
        reading.setReadError({ error: res.error, rateLimited: res.rateLimited, retryable: res.retryable === true || res.rateLimited });
        reading.setNext(index);
        break;
      }
      reading.addChunk(res.data);
      for (const p of res.data.proposals) if (p.doNotContact || p.outcome) choose(p.row, true);
      reading.setNext(index + 1);
    }
    setBusy(false);
  };

  const startReading = async (mapping: ImportMapping) => {
    if (!actions) return;
    setError(null);
    discardReading();
    const form = send({ mapping: JSON.stringify(mapping), freeText: JSON.stringify(freeText), cycleStart: String(cycle) });
    if (!form) return;
    setBusy(true);
    const res = await actions.start(null, form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    reading.setSession({ ...res.data, mapping: JSON.stringify(mapping) });
    reading.setNames(new Map(res.data.doNotContact.map((d) => [d.row, d.name])));
    // Do-not-contact rows start skipped; the person can choose to import them anyway.
    for (const d of res.data.doNotContact) choose(d.row, true);
    await readFrom(res.data, 0);
  };

  const decisions = () =>
    decisionsFrom([...new Set([...reading.proposals.map((p) => p.row), ...(session?.doNotContact ?? []).map((d) => d.row)])], {
      skips,
      edits: reading.edits,
      doNotContact,
    });
  const edit = (row: number, change: Partial<RowEdits>) => reading.setEdits((current) => ({ ...current, [row]: { ...current[row], ...change } }));
  // Import a do-not-contact row anyway, or skip it again: just the skips, like every other choice.
  const accept = (row: number, value: boolean) => choose(row, !value);
  // The rows a new preview must keep skipped: a matching reading's do-not-contact rows start
  // skipped again, like when they were found.
  const heldRows = (mapping: ImportMapping) => (session && session.mapping === JSON.stringify(mapping) ? [...heldBack] : []);

  return {
    skipsHas: (row: number) => skips.has(row),
    on,
    busy,
    note,
    error,
    freeText,
    setFreeText,
    cycle,
    setCycle,
    session,
    next: reading.next,
    readError: reading.readError,
    proposals: reading.proposals,
    names: reading.names,
    edits: reading.edits,
    doNotContact,
    mappingNote,
    undoMapping,
    heldRows,
    turn,
    reset,
    startReading,
    readFrom,
    decisions,
    edit,
    accept,
    discardReading,
  };
}

export type SmartState = ReturnType<typeof useSmartImport>;

// Whether the reading was done with the columns the preview shows now.
export const readingMatches = (smart: SmartState, mapping: ImportMapping) => smart.session !== null && smart.session.mapping === JSON.stringify(mapping);
