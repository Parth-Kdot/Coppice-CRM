"use client";

import { useState } from "react";
import type { ImportResult } from "@/lib/csv";
import type { ColumnSuggestion, RowProposal, SmartChunk, SmartChunkResult, SmartOptions, SmartStart } from "@/lib/smart-import";
import { SMART_STAGES, type ActionResult, type ImportMapping, type SmartDecision } from "@/lib/validation";

// Smart import, the optional half of the CSV importer (components/csv-importer.tsx). The AI only
// proposes: every reading shows the cell text it came from, and the person keeps, edits or drops
// each one before anything is imported. The browser sends the free-text rows one chunk at a time
// (lib/smart-import/), so a long sheet never needs one long server call; a rate limit stops the
// reading until the person presses Continue, and nothing is retried on its own.

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

// What the person kept, for the import. Skipped rows send nothing.
function decisionsFrom(rows: number[], { skips, edits, accepted }: { skips: Set<number>; edits: Record<number, RowEdits>; accepted: Set<number> }): SmartDecision[] {
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
      dncAccepted: accepted.has(row),
    };
    const any = decision.stage || decision.lastContactedOn || decision.followUpOn || decision.contact || decision.note || decision.dncAccepted;
    return any ? [decision] : [];
  });
}

const withChunk = (current: RowProposal[], chunk: SmartChunk) =>
  [...current.filter((p) => !chunk.proposals.some((q) => q.row === p.row)), ...chunk.proposals].sort((a, b) => a.row - b.row);

const toggled = (set: Set<number>, row: number, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(row);
  else next.delete(row);
  return next;
};

// The reading: a session, the chunks read so far, and where a failed reading stopped.
function useReading() {
  const [session, setSession] = useState<(SmartStart & { mapping: string }) | null>(null);
  const [next, setNext] = useState(0);
  const [readError, setReadError] = useState<{ error: string; rateLimited: boolean } | null>(null);
  const [proposals, setProposals] = useState<RowProposal[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [edits, setEdits] = useState<Record<number, RowEdits>>({});
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  const clearReading = () => {
    setSession(null);
    setNext(0);
    setReadError(null);
    setProposals([]);
    setEdits({});
    setAccepted(new Set());
  };
  const addChunk = (chunk: SmartChunk) => {
    setNames((current) => new Map([...current, ...chunk.names.map((n) => [n.row, n.name] as const)]));
    setProposals((current) => withChunk(current, chunk));
    setEdits((current) => ({ ...current, ...Object.fromEntries(chunk.proposals.map((p) => [p.row, editsFor(p)])) }));
  };
  return { session, setSession, next, setNext, readError, setReadError, proposals, names, setNames, edits, setEdits, accepted, setAccepted, clearReading, addChunk };
}

// Everything Smart import keeps between steps. `send` builds a form with the file in it, like the
// importer's own steps; `applyMapping` asks the importer for a new preview with other columns.
export function useSmartImport({
  actions,
  send,
  applyMapping,
  skips,
  choose,
}: {
  // Undefined when Smart import isn't offered (AI off): the hook then does nothing.
  actions: SmartActions | undefined;
  send: (fields: Record<string, string>) => FormData | null;
  applyMapping: (mapping: ImportMapping) => void;
  skips: Set<number>;
  choose: (row: number, skip: boolean) => void;
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<number[]>([]);
  const [cycle, setCycle] = useState(actions?.options.current ?? 0);
  const reading = useReading();
  const { session, clearReading } = reading;

  const reset = () => {
    setOn(false);
    setNote(null);
    setError(null);
    setFreeText([]);
    clearReading();
  };

  // Turning it on asks for column suggestions and applies them; the person can still change any.
  const turn = async (value: boolean) => {
    setOn(value);
    setError(null);
    clearReading();
    const form = value && actions?.options.groq ? send({}) : null;
    if (!actions || !form) return;
    setBusy(true);
    const res = await actions.suggest(null, form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFreeText(res.data.freeText);
    setNote(res.data.note);
    applyMapping(res.data.mapping);
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
        reading.setReadError({ error: res.error, rateLimited: res.rateLimited });
        reading.setNext(index);
        break;
      }
      reading.addChunk(res.data);
      for (const p of res.data.proposals) if (p.doNotContact) choose(p.row, true);
      reading.setNext(index + 1);
    }
    setBusy(false);
  };

  const startReading = async (mapping: ImportMapping) => {
    if (!actions) return;
    setError(null);
    clearReading();
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
      accepted: reading.accepted,
    });
  const edit = (row: number, change: Partial<RowEdits>) => reading.setEdits((current) => ({ ...current, [row]: { ...current[row], ...change } }));
  const accept = (row: number, value: boolean) => {
    reading.setAccepted((current) => toggled(current, row, value));
    choose(row, !value);
  };

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
    accepted: reading.accepted,
    turn,
    reset,
    startReading,
    readFrom,
    decisions,
    edit,
    accept,
    clearReading,
  };
}

export type SmartState = ReturnType<typeof useSmartImport>;

// Whether the reading was done with the columns the preview shows now.
export const readingMatches = (smart: SmartState, mapping: ImportMapping) => smart.session !== null && smart.session.mapping === JSON.stringify(mapping);
