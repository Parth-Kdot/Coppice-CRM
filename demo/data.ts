import { DEMO_NOW, DEMO_NOW_ISO, DEMO_TODAY } from "./clock";
import {
  MAIN_DRAFTS,
  MAIN_FACTS,
  MAIN_FACT_SHEETS,
  MAIN_INVITATIONS,
  MAIN_MEMBERS,
  MAIN_PEOPLE,
  MAIN_TEMPLATES,
  MAIN_WORKSPACE,
  MAIN_WORKSPACE_ID,
  ME_ID,
  buildMainCompanies,
} from "./seed-main";
import {
  CALUMET_ID,
  FORMULA_ID,
  OTHER_FACTS,
  OTHER_INVITATIONS_FOR_ME,
  OTHER_MEMBERS,
  OTHER_PEOPLE,
  OTHER_TEMPLATES,
  OTHER_WORKSPACES,
  TARTAN_ID,
  buildOtherCompanies,
} from "./seed-others";
import type { DemoState } from "./types";

// The mock data. Everything is deterministic and fixed relative to DEMO_NOW, so the server and the
// browser build identical state. Nothing here touches a database, the network or the real clock.
//
// The signed-in person is Jordan Ellis:
//   Boilermaker Robotics Club (boiler-robotics): an officer. The main demo workspace, with an owner
//     and five officers, 44 companies across all six stages, claims, outreach, a fact sheet, and AI on.
//   Tartan Build Weekend (tartan-build): the owner, with AI switched off. A hackathon at another school.
//   Calumet Scholars Alumni Board (calumet-alumni): an officer. A nonprofit alumni board.
//   Boilermaker Formula Racing (boiler-formula): not joined yet. An invitation waits on the workspace list.

export { DEMO_NOW, DEMO_NOW_ISO, DEMO_TODAY };
export { MAIN_WORKSPACE_ID, TARTAN_ID, CALUMET_ID, FORMULA_ID };

// The id of the signed-in person.
export const DEMO_USER_ID = ME_ID;

export const DEFAULT_WORKSPACE_ID = MAIN_WORKSPACE_ID;

// A static summary of the three workspaces the person belongs to, for pages that render before the
// store exists (a landing page, for example). The live list comes from the store.
export const DEMO_WORKSPACE_SUMMARIES: { id: string; name: string; school: string; tagline: string; kind: string }[] = [
  MAIN_WORKSPACE,
  ...OTHER_WORKSPACES.filter((w) => w.id !== FORMULA_ID),
].map((w) => ({ id: w.id, name: w.name, school: w.school, tagline: w.tagline, kind: w.kind }));

// A fresh copy of the starting state. Called once per provider, and again by resetDemo().
export function createInitialState(): DemoState {
  const main = buildMainCompanies();
  const others = buildOtherCompanies();
  return {
    now: DEMO_NOW_ISO,
    seq: 1000,
    signedIn: false,
    meId: ME_ID,
    // The signed-in person is on the list of emails allowed to create workspaces.
    canCreateWorkspace: true,
    serverAiConfigured: true,
    people: [...MAIN_PEOPLE, ...OTHER_PEOPLE].map((p) => ({ ...p })),
    workspaces: [MAIN_WORKSPACE, ...OTHER_WORKSPACES].map((w) => ({ ...w })),
    members: [...MAIN_MEMBERS, ...OTHER_MEMBERS].map((m) => ({ ...m })),
    invitations: MAIN_INVITATIONS.map((i) => ({ ...i })),
    invitationsForMe: OTHER_INVITATIONS_FOR_ME.map((i) => ({ ...i })),
    companies: [...main.companies, ...others.companies],
    contacts: [...main.contacts, ...others.contacts],
    outreach: [...main.outreach, ...others.outreach],
    stageChanges: [...main.stageChanges, ...others.stageChanges],
    pairDecisions: [],
    templates: [...MAIN_TEMPLATES, ...OTHER_TEMPLATES].map((t) => ({ ...t })),
    factSheets: MAIN_FACT_SHEETS.map((f) => ({ ...f })),
    facts: [...MAIN_FACTS, ...OTHER_FACTS].map((f) => ({ ...f })),
    drafts: MAIN_DRAFTS.map((d) => ({ ...d, check: d.check ? { ...d.check, ai: d.check.ai.map((f) => ({ ...f })) } : null })),
    busy: { drafting: [], checking: [], uploading: [] },
  };
}
