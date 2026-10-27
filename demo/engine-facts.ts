import { numbersIn } from "@/lib/ai/text";
import { aiGate } from "./engine-ai";
import { asOwner, done, nextId, refuse, type Step } from "./engine-core";
import type { DemoState, Fact, FactSheetFile } from "./types";
import { PDF_MAX_BYTES, checkFactText } from "./validation";

// The fact sheet: the only things the AI may state about the org. Everything here is owner only,
// like lib/facts.ts. A fact counts for the drafter only once an owner has verified it.

const FACT_NOT_FOUND = "Fact not found.";

export function setFactVerified(state: DemoState, ws: string, factId: string, verified: boolean): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  if (!state.facts.some((f) => f.id === factId && f.workspaceId === ws)) return refuse(state, FACT_NOT_FOUND);
  return done(
    {
      ...state,
      facts: state.facts.map((f) =>
        f.id === factId ? { ...f, verifiedAt: verified ? state.now : null, verifiedById: verified ? state.meId : null } : f,
      ),
    },
    undefined,
  );
}

// An owner's edit is their own statement, so it counts as verified. A fact from a PDF keeps its
// quote, and the quote check runs again: change "$2,500" to "$3,000" and it shows "quote doesn't
// match". (The prototype has no page text, so the check compares the numbers in the fact with the
// numbers in its quote.)
export function updateFact(state: DemoState, ws: string, factId: string, text: string): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const checked = checkFactText(text);
  if (!checked.ok) return refuse(state, checked.error);
  const fact = state.facts.find((f) => f.id === factId && f.workspaceId === ws);
  if (!fact) return refuse(state, FACT_NOT_FOUND);
  const quote = fact.quote;
  const found = Boolean(quote && fact.pageNumber && fact.factSheetId) && numbersIn(checked.data).every((n) => numbersIn(quote as string).includes(n));
  return done(
    {
      ...state,
      facts: state.facts.map((f) =>
        f.id === factId ? { ...f, text: checked.data, quoteFound: found, verifiedAt: state.now, verifiedById: state.meId } : f,
      ),
    },
    undefined,
  );
}

// A fact typed in by an owner: verified, with no quote to check.
export function addFact(state: DemoState, ws: string, text: string): Step<{ factId: string }> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const checked = checkFactText(text);
  if (!checked.ok) return refuse(state, checked.error);
  const withId = nextId(state, "fact");
  const fact: Fact = {
    id: withId.id,
    workspaceId: ws,
    factSheetId: null,
    source: "MANUAL",
    text: checked.data,
    quote: null,
    pageNumber: null,
    quoteFound: false,
    verifiedAt: state.now,
    verifiedById: state.meId,
    createdById: state.meId,
    createdAt: state.now,
  };
  return done({ ...withId.state, facts: [...withId.state.facts, fact] }, { factId: fact.id });
}

// Facts are not history, so deleting really deletes.
export function deleteFact(state: DemoState, ws: string, factId: string): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  if (!state.facts.some((f) => f.id === factId && f.workspaceId === ws)) return refuse(state, FACT_NOT_FOUND);
  return done({ ...state, facts: state.facts.filter((f) => f.id !== factId) }, undefined);
}

// Deletes an uploaded file and every fact read from it. Facts typed by hand stay.
export function deleteFactSheet(state: DemoState, ws: string, factSheetId: string): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  if (!state.factSheets.some((s) => s.id === factSheetId && s.workspaceId === ws)) return refuse(state, "File not found.");
  return done(
    {
      ...state,
      factSheets: state.factSheets.filter((s) => s.id !== factSheetId),
      facts: state.facts.filter((f) => f.factSheetId !== factSheetId),
    },
    undefined,
  );
}

// ----- Uploading a packet -----

export type UploadedFile = { name: string; size: number };
export type UploadResult = { factSheetId: string; facts: number; quotesFound: number };

// The file checks that run before anything is read, in the real app's order and words.
export function checkPdf(file: UploadedFile | null): string | null {
  if (!file || file.size === 0) return "Choose a PDF file.";
  if (!/\.pdf$/i.test(file.name)) return "Choose a PDF file.";
  if (file.size > PDF_MAX_BYTES) return "The PDF is over 3.5 MB. Export a smaller copy.";
  return null;
}

// Checks the upload and the AI switch, the way the real app does before it reads the PDF. Returns
// the state with the upload marked as in flight; the store reads the packet after a short wait.
export function beginUpload(state: DemoState, ws: string, file: UploadedFile | null): Step<UploadedFile> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const problem = checkPdf(file);
  if (problem) return refuse(state, problem);
  const gate = aiGate(state, ws, "FACT_EXTRACTION");
  if (!gate.ok) return refuse(state, gate.error);
  return done({ ...state, busy: { ...state.busy, uploading: [...state.busy.uploading, ws] } }, file as UploadedFile);
}

// What the AI "reads" from any packet: four unverified facts, each with the sentence and page it
// came from. The last one's quote disagrees with its fact, so the warning state is always reachable.
function extractedFacts(orgName: string) {
  return [
    {
      text: `${orgName} has 40 student members across four project teams.`,
      quote: `${orgName} has 40 student members organized into four project teams.`,
      page: 2,
      found: true,
    },
    { text: "The annual showcase is held each April.", quote: "Our annual showcase takes place every April on campus.", page: 3, found: true },
    { text: "Platinum sponsorship is $7,500 and includes a banner at the showcase.", quote: "Platinum ($7,500): a banner at the showcase and a speaking slot.", page: 5, found: true },
    { text: "Sponsors receive a table at our career night.", quote: "Sponsors receive a banner at our career night.", page: 5, found: false },
  ];
}

// Adds the uploaded file and the facts the AI would read from it, all unverified.
export function finishUpload(state: DemoState, ws: string, file: UploadedFile): Step<UploadResult> {
  const cleared: DemoState = { ...state, busy: { ...state.busy, uploading: state.busy.uploading.filter((id) => id !== ws) } };
  const owner = asOwner(cleared, ws);
  if (!owner.ok) return owner.step;
  const sheetId = nextId(cleared, "fs");
  let next = sheetId.state;
  const sheet: FactSheetFile = {
    id: sheetId.id,
    workspaceId: ws,
    fileName: file.name.slice(0, 200),
    // A plausible page count from the file size, between 4 and 24, the same for the same file.
    pageCount: 4 + (Math.floor(file.size / 1024) % 21),
    uploadedById: state.meId,
    createdAt: state.now,
  };
  const facts: Fact[] = extractedFacts(owner.workspace.name).map((f) => {
    const withId = nextId(next, "fact");
    next = withId.state;
    return {
      id: withId.id,
      workspaceId: ws,
      factSheetId: sheet.id,
      source: "PDF",
      text: f.text,
      quote: f.quote,
      pageNumber: Math.min(f.page, sheet.pageCount),
      quoteFound: f.found,
      verifiedAt: null,
      verifiedById: null,
      createdById: state.meId,
      createdAt: state.now,
    };
  });
  next = { ...next, factSheets: [...next.factSheets, sheet], facts: [...next.facts, ...facts] };
  return done(next, { factSheetId: sheet.id, facts: facts.length, quotesFound: facts.filter((f) => f.quoteFound).length });
}

// Clears the in-flight mark when an upload fails after it began.
export function abortUpload(state: DemoState, ws: string): DemoState {
  return { ...state, busy: { ...state.busy, uploading: state.busy.uploading.filter((id) => id !== ws) } };
}
