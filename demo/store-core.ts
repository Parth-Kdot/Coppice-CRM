import { createInitialState } from "./data";
import type { ImportPreview, ImportResult } from "./csv";
import { checkImportFile } from "./csv";
import { abortCheck, abortDraft, beginCheck, beginDraft, finishCheck, finishDraft, type DraftRequest } from "./engine-ai";
import {
  archiveCompany,
  addContact,
  createCompany,
  markSeparate,
  removeContact,
  resolveAsDuplicate,
  unarchiveCompany,
  updateCompany,
  updateContact,
  type CompanyEdit,
  type SaveResult,
} from "./engine-companies";
import { claimCompany, forceRelease, logOutreach, moveStage, releaseClaim, setOutreachReply, type OutreachInput, type StageMoveOptions, type StageMoveResult } from "./engine-claims";
import type { Step } from "./engine-core";
import { abortUpload, addFact, beginUpload, deleteFact, deleteFactSheet, finishUpload, setFactVerified, updateFact, type UploadResult, type UploadedFile } from "./engine-facts";
import { previewCsv, runCsvImport } from "./engine-import";
import {
  acceptInvitation,
  advanceClock,
  cancelInvitation,
  changeMemberRole,
  createWorkspace,
  inviteMember,
  invitationLink,
  leaveWorkspace,
  removeMember,
  setFlags,
  setRole,
  signIn,
  signOut,
  simulateTeammateEdit,
  transferOwnership,
  updateAiSettings,
  updateClaimWindow,
  type DemoFlags,
} from "./engine-settings";
import type { ActionResult, Draft, DraftCheck, DemoState, Role, Stage } from "./types";
import type { CompanyInput } from "./validation";
import type { ImportMapping } from "./validation";

// The store without React: the state, a way to subscribe to it, and every action. The provider in
// demo/store.tsx wraps this for components. Keeping it plain TypeScript means it can also be driven
// from a script or a test, with no browser.
//
// Every action is a command from the engine files: a pure function from the state to the next state
// and a result. The store applies it and returns the result, so a screen can show the message of a
// refused action ({ ok: false, error }) right where the person clicked.

export type StoreOptions = {
  // Skips the simulated waits (drafting, checking, reading a packet). For tests and screenshots.
  instant?: boolean;
};

// How long the simulated AI takes. Always inside the range, and the same for the same state.
export const SIMULATED_DELAY_MS = {
  draft: [1500, 3000],
  check: [900, 1800],
  upload: [2000, 3500],
} as const;

export function simulatedDelay(kind: keyof typeof SIMULATED_DELAY_MS, seq: number): number {
  const [min, max] = SIMULATED_DELAY_MS[kind];
  return min + ((seq * 7919) % (max - min + 1));
}

const RESET_MESSAGE = "The demo was reset while this was running.";

export type DemoActions = {
  // ----- Session and demo tools (not in the real app) -----
  signIn(): void;
  signOut(): void;
  // Puts every workspace back as it started. Keeps you signed in unless `signOut` is true.
  resetDemo(options?: { signOut?: boolean }): void;
  // Switches the signed-in person between Owner and Officer in one workspace, or in all of them.
  setRole(role: Role, ws?: string): void;
  // Moves the clock forward so claims run out and follow-ups come due.
  advanceClock(days: number): void;
  // aiFailNext, serverAiConfigured and canCreateWorkspace, for reaching the error and empty states.
  setFlags(flags: DemoFlags): void;
  // Plays a teammate editing a company, so the "someone else changed this" conflict can be shown.
  simulateTeammateEdit(ws: string, companyId: string, field: "name" | "industry" | "website" | "notes", value: string): void;

  // ----- Workspace list -----
  createWorkspace(name: string): ActionResult<{ workspaceId: string }>;
  acceptInvitation(invitationId: string): ActionResult<{ workspaceId: string }>;

  // ----- Claims, outreach and stages -----
  claimCompany(ws: string, companyId: string): ActionResult<{ claimExpiresAt: string }>;
  releaseClaim(ws: string, companyId: string): ActionResult;
  forceRelease(ws: string, companyId: string): ActionResult;
  logOutreach(ws: string, companyId: string, input: OutreachInput): ActionResult<{ outreachId: string }>;
  moveStage(ws: string, companyId: string, stage: Stage, options?: StageMoveOptions): ActionResult<StageMoveResult>;
  setOutreachReply(ws: string, outreachId: string, gotReply: boolean): ActionResult;

  // ----- Companies and contacts -----
  createCompany(ws: string, input: CompanyInput, separateFrom?: string[]): ActionResult<SaveResult>;
  updateCompany(ws: string, companyId: string, edit: CompanyEdit, separateFrom?: string[]): ActionResult<SaveResult>;
  archiveCompany(ws: string, companyId: string): ActionResult;
  unarchiveCompany(ws: string, companyId: string): ActionResult;
  // Keep one company and archive the other: "Same company" on the board and while editing.
  archiveDuplicate(ws: string, keepId: string, archiveId: string): ActionResult;
  // These two are separate entries: remembered so the pair stops being flagged.
  keepSeparate(ws: string, companyId: string, otherId: string): ActionResult;
  addContact(ws: string, companyId: string, input: { name: string; email?: string | null; title?: string | null }): ActionResult<{ contactId: string }>;
  updateContact(ws: string, contactId: string, input: { name: string; email?: string | null; title?: string | null }): ActionResult;
  removeContact(ws: string, contactId: string): ActionResult;

  // ----- CSV import -----
  // Checks the file the person picked, before reading it.
  checkImportFile(file: { name: string; size: number } | null): ActionResult;
  // The columns, the problems and the duplicate groups for the file's text. Mapping null guesses.
  previewImport(ws: string, text: string, mapping: ImportMapping | null): ActionResult<ImportPreview>;
  runImport(ws: string, text: string, mapping: ImportMapping, skip: number[], seen: string[]): ActionResult<ImportResult>;

  // ----- Fact sheet (owners only) -----
  setFactVerified(ws: string, factId: string, verified: boolean): ActionResult;
  updateFact(ws: string, factId: string, text: string): ActionResult;
  addFact(ws: string, text: string): ActionResult<{ factId: string }>;
  deleteFact(ws: string, factId: string): ActionResult;
  deleteFactSheet(ws: string, factSheetId: string): ActionResult;
  // Waits a few seconds, then adds the file and four unverified facts read from it.
  uploadFactSheet(ws: string, file: UploadedFile | null): Promise<ActionResult<UploadResult>>;

  // ----- AI drafts (simulated) -----
  // Claims the company, waits 1.5 to 3 seconds, then returns two drafts with unsupported claims flagged.
  draftEmail(ws: string, companyId: string, request: DraftRequest): Promise<ActionResult<Draft[]>>;
  // "Check again with AI" on the draft as edited. Waits about a second.
  checkDraft(ws: string, draftId: string, text: { subject: string; body: string }): Promise<ActionResult<DraftCheck>>;

  // ----- Settings -----
  inviteMember(ws: string, email: string, role: Role): ActionResult<{ invitationId: string; link: string }>;
  cancelInvitation(ws: string, invitationId: string): ActionResult;
  // Puts the invitation link on the clipboard when the browser allows it. `copied` says whether it did.
  copyInviteLink(ws: string, invitationId: string): Promise<ActionResult<{ link: string; copied: boolean }>>;
  changeMemberRole(ws: string, memberId: string, role: Role): ActionResult;
  removeMember(ws: string, memberId: string): ActionResult<{ released: number }>;
  leaveWorkspace(ws: string): ActionResult<{ released: number }>;
  // Makes the person Owner and you Officer in one step.
  transferOwnership(ws: string, memberId: string): ActionResult<{ newOwnerId: string }>;
  updateClaimWindow(ws: string, days: number): ActionResult;
  updateAiSettings(ws: string, settings: { enabled: boolean; limit: number }): ActionResult;
};

export type DemoStore = {
  getState(): DemoState;
  subscribe(listener: () => void): () => void;
  actions: DemoActions;
};

export function createDemoStore(options: StoreOptions = {}): DemoStore {
  let state: DemoState = createInitialState();
  // Counts resets, so a wait that began before one does not write into the fresh state.
  let epoch = 0;
  const listeners = new Set<() => void>();

  const commit = (next: DemoState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  // Applies a command. A refused command hands back the state it was given, so nothing changes.
  const run = <T,>(command: (current: DemoState) => Step<T>): ActionResult<T> => {
    const step = command(state);
    commit(step.state);
    return step.result;
  };
  const apply = (change: (current: DemoState) => DemoState) => commit(change(state));

  const wait = (kind: keyof typeof SIMULATED_DELAY_MS) => (options.instant ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, simulatedDelay(kind, state.seq))));

  const actions: DemoActions = {
    signIn: () => apply(signIn),
    signOut: () => apply(signOut),
    resetDemo: (opts) => {
      epoch += 1;
      const fresh = createInitialState();
      commit({ ...fresh, signedIn: opts?.signOut ? false : state.signedIn });
    },
    setRole: (role, ws) => apply((s) => setRole(s, role, ws)),
    advanceClock: (days) => apply((s) => advanceClock(s, days)),
    setFlags: (flags) => apply((s) => setFlags(s, flags)),
    simulateTeammateEdit: (ws, companyId, field, value) => apply((s) => simulateTeammateEdit(s, ws, companyId, field, value)),

    createWorkspace: (name) => run((s) => createWorkspace(s, name)),
    acceptInvitation: (id) => run((s) => acceptInvitation(s, id)),

    claimCompany: (ws, id) => run((s) => claimCompany(s, ws, id)),
    releaseClaim: (ws, id) => run((s) => releaseClaim(s, ws, id)),
    forceRelease: (ws, id) => run((s) => forceRelease(s, ws, id)),
    logOutreach: (ws, id, input) => run((s) => logOutreach(s, ws, id, input)),
    moveStage: (ws, id, stage, opts) => run((s) => moveStage(s, ws, id, stage, opts)),
    setOutreachReply: (ws, id, gotReply) => run((s) => setOutreachReply(s, ws, id, gotReply)),

    createCompany: (ws, input, separateFrom) => run((s) => createCompany(s, ws, input, separateFrom)),
    updateCompany: (ws, id, edit, separateFrom) => run((s) => updateCompany(s, ws, id, edit, separateFrom)),
    archiveCompany: (ws, id) => run((s) => archiveCompany(s, ws, id)),
    unarchiveCompany: (ws, id) => run((s) => unarchiveCompany(s, ws, id)),
    archiveDuplicate: (ws, keepId, archiveId) => run((s) => resolveAsDuplicate(s, ws, keepId, archiveId)),
    keepSeparate: (ws, id, otherId) => run((s) => markSeparate(s, ws, id, otherId)),
    addContact: (ws, id, input) => run((s) => addContact(s, ws, id, input)),
    updateContact: (ws, id, input) => run((s) => updateContact(s, ws, id, input)),
    removeContact: (ws, id) => run((s) => removeContact(s, ws, id)),

    checkImportFile: (file) => checkImportFile(file),
    previewImport: (ws, text, mapping) => previewCsv(state, ws, text, mapping),
    runImport: (ws, text, mapping, skip, seen) => run((s) => runCsvImport(s, ws, text, mapping, skip, seen)),

    setFactVerified: (ws, id, verified) => run((s) => setFactVerified(s, ws, id, verified)),
    updateFact: (ws, id, text) => run((s) => updateFact(s, ws, id, text)),
    addFact: (ws, text) => run((s) => addFact(s, ws, text)),
    deleteFact: (ws, id) => run((s) => deleteFact(s, ws, id)),
    deleteFactSheet: (ws, id) => run((s) => deleteFactSheet(s, ws, id)),
    uploadFactSheet: async (ws, file) => {
      const begun = run((s) => beginUpload(s, ws, file));
      if (!begun.ok) return begun;
      const startedIn = epoch;
      await wait("upload");
      if (epoch !== startedIn) return { ok: false, error: RESET_MESSAGE };
      const finished = run((s) => finishUpload(s, ws, begun.data));
      if (!finished.ok) apply((s) => abortUpload(s, ws));
      return finished;
    },

    draftEmail: async (ws, companyId, request) => {
      const begun = run((s) => beginDraft(s, ws, companyId, request));
      if (!begun.ok) return begun;
      const startedIn = epoch;
      await wait("draft");
      if (epoch !== startedIn) return { ok: false, error: RESET_MESSAGE };
      const finished = run((s) => finishDraft(s, ws, begun.data));
      if (!finished.ok) apply((s) => abortDraft(s, companyId));
      return finished;
    },
    checkDraft: async (ws, draftId, text) => {
      const begun = run((s) => beginCheck(s, ws, draftId, text));
      if (!begun.ok) return begun;
      const startedIn = epoch;
      await wait("check");
      if (epoch !== startedIn) return { ok: false, error: RESET_MESSAGE };
      const finished = run((s) => finishCheck(s, ws, draftId, text));
      if (!finished.ok) apply((s) => abortCheck(s, draftId));
      return finished;
    },

    inviteMember: (ws, email, role) => run((s) => inviteMember(s, ws, email, role)),
    cancelInvitation: (ws, id) => run((s) => cancelInvitation(s, ws, id)),
    copyInviteLink: async (ws, id) => {
      const found = run((s) => invitationLink(s, ws, id));
      if (!found.ok) return found;
      let copied = false;
      try {
        await navigator.clipboard.writeText(found.data.link);
        copied = true;
      } catch {
        // No clipboard here (a server, an insecure page, a blocked permission). The link is still returned.
      }
      return { ok: true, data: { link: found.data.link, copied } };
    },
    changeMemberRole: (ws, memberId, role) => run((s) => changeMemberRole(s, ws, memberId, role)),
    removeMember: (ws, memberId) => run((s) => removeMember(s, ws, memberId)),
    leaveWorkspace: (ws) => run((s) => leaveWorkspace(s, ws)),
    transferOwnership: (ws, memberId) => run((s) => transferOwnership(s, ws, memberId)),
    updateClaimWindow: (ws, days) => run((s) => updateClaimWindow(s, ws, days)),
    updateAiSettings: (ws, settings) => run((s) => updateAiSettings(s, ws, settings)),
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
  };
}
