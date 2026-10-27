import { DEMO_TODAY } from "./clock";
import { addDaysYmd, zonedToIso } from "./dates";
import { buildCompanies, type Built, type CompanySpec } from "./seed-helpers";
import type { Fact, InvitationForMe, Member, Person, Role, Template, Workspace } from "./types";

// The other workspaces: a hackathon at another school, a nonprofit alumni board, and a third
// workspace the signed-in person has only been invited to (it shows up after they press Join).
// They are summaries with a few companies each, enough for every screen to render.

const ago = (days: number, hour = 10) => zonedToIso(addDaysYmd(DEMO_TODAY, -days), hour);

const person = (key: string, name: string, domain: string): Person => ({
  id: `u-${key}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, ".")}@${domain}.example`,
});

export const TARTAN_ID = "tartan-build";
export const CALUMET_ID = "calumet-alumni";
export const FORMULA_ID = "boiler-formula";

export const OTHER_PEOPLE: Person[] = [
  person("lucas", "Lucas Ferreira", "cmu"),
  person("devon", "Devon Park", "cmu"),
  person("amara", "Amara Nwosu", "cmu"),
  person("margaret", "Margaret Okonkwo", "pnw"),
  person("ravi", "Ravi Patel", "pnw"),
  person("beth", "Beth Sorensen", "pnw"),
  person("hannah", "Hannah Lindqvist", "purdue"),
  person("tariq", "Tariq Hassan", "purdue"),
  person("grace", "Grace Obi", "purdue"),
];

export const OTHER_WORKSPACES: Workspace[] = [
  {
    id: TARTAN_ID,
    name: "Tartan Build Weekend",
    kind: "hackathon",
    school: "Carnegie Mellon University",
    tagline: "A 36-hour student hackathon in Pittsburgh. Sponsors fund prizes, food, and hardware.",
    claimWindowDays: 7,
    // AI is switched off here, so the AI-off states are easy to reach.
    aiEnabled: false,
    aiMonthlyLimit: 150,
    aiCallsUsed: 0,
    createdAt: ago(300, 9),
  },
  {
    id: CALUMET_ID,
    name: "Calumet Scholars Alumni Board",
    kind: "nonprofit",
    school: "Purdue University Northwest",
    tagline: "Alumni volunteers raising scholarship money for first-generation students in northwest Indiana.",
    claimWindowDays: 21,
    aiEnabled: true,
    aiMonthlyLimit: 100,
    aiCallsUsed: 12,
    createdAt: ago(520, 9),
  },
  {
    id: FORMULA_ID,
    name: "Boilermaker Formula Racing",
    kind: "student-org",
    school: "Purdue University",
    tagline: "A student team that designs and races a formula-style car each summer.",
    claimWindowDays: 14,
    aiEnabled: true,
    aiMonthlyLimit: 300,
    aiCallsUsed: 4,
    createdAt: ago(600, 9),
  },
];

const member = (workspaceId: string, key: string, role: Role, joinedDaysAgo: number): Member => ({
  id: `m-${workspaceId}-${key}`,
  workspaceId,
  userId: `u-${key}`,
  role,
  joinedAt: ago(joinedDaysAgo, 9),
});

// The signed-in person owns the hackathon workspace and is an officer on the alumni board. Each of
// those has a second owner, so the "view as owner or officer" demo tool never strands a workspace.
export const OTHER_MEMBERS: Member[] = [
  member(TARTAN_ID, "jordan", "owner", 200),
  member(TARTAN_ID, "lucas", "owner", 300),
  member(TARTAN_ID, "devon", "member", 200),
  member(TARTAN_ID, "amara", "member", 150),

  member(CALUMET_ID, "margaret", "owner", 520),
  member(CALUMET_ID, "jordan", "member", 90),
  member(CALUMET_ID, "ravi", "member", 400),
  member(CALUMET_ID, "beth", "member", 300),

  // The signed-in person is not a member here yet. Pressing Join on the invitation adds them.
  member(FORMULA_ID, "hannah", "owner", 600),
  member(FORMULA_ID, "tariq", "member", 300),
  member(FORMULA_ID, "grace", "member", 120),
];

export const OTHER_INVITATIONS_FOR_ME: InvitationForMe[] = [
  { id: "inv-for-me-formula", workspaceId: FORMULA_ID, workspaceName: "Boilermaker Formula Racing", role: "member", invitedByName: "Hannah Lindqvist" },
];

export const OTHER_TEMPLATES: Template[] = [
  {
    id: `${TARTAN_ID}-tpl-intro`,
    workspaceId: TARTAN_ID,
    name: "Hackathon sponsor intro",
    body: "Hi {{firstName}},\n\nI'm {{senderName}} with {{orgName}}. We host a student hackathon in Pittsburgh each spring and are looking for sponsors for prizes and food.\n\nCould I send you our sponsor deck?\n\nThanks,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(280, 10),
  },
  {
    id: `${CALUMET_ID}-tpl-intro`,
    workspaceId: CALUMET_ID,
    name: "Scholarship gift ask",
    body: "Dear {{firstName}},\n\nI'm {{senderName}}, a volunteer with {{orgName}}. We raise scholarship money for first-generation students in northwest Indiana, and I would like to share how a gift from your company would be used.\n\nMay I send a one-page summary?\n\nWith thanks,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(500, 10),
  },
  {
    id: `${FORMULA_ID}-tpl-intro`,
    workspaceId: FORMULA_ID,
    name: "Racing team intro",
    body: "Hi {{firstName}},\n\n{{senderName}} here from {{orgName}} at Purdue. We build a formula-style race car each year and are looking for sponsors.\n\nMay I send our sponsorship packet?\n\nThanks,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(580, 10),
  },
];

type FactSeed = { id: string; ws: string; text: string; verified?: number; by: string };
const fact = (f: FactSeed): Fact => ({
  id: f.id,
  workspaceId: f.ws,
  factSheetId: null,
  source: "MANUAL",
  text: f.text,
  quote: null,
  pageNumber: null,
  quoteFound: false,
  verifiedAt: f.verified === undefined ? null : ago(f.verified, 14),
  verifiedById: f.verified === undefined ? null : f.by,
  createdById: f.by,
  createdAt: ago(f.verified ?? 3, 14),
});

export const OTHER_FACTS: Fact[] = [
  fact({ id: "fact-tartan-1", ws: TARTAN_ID, text: "Tartan Build Weekend hosts 450 students for 36 hours each spring.", verified: 60, by: "u-lucas" }),
  fact({ id: "fact-tartan-2", ws: TARTAN_ID, text: "Sponsors can fund a prize track, meals, or hardware loans.", verified: 60, by: "u-lucas" }),
  fact({ id: "fact-tartan-3", ws: TARTAN_ID, text: "Last year's event had 120 projects submitted.", by: "u-lucas" }),
  fact({ id: "fact-calumet-1", ws: CALUMET_ID, text: "The board has awarded 38 scholarships since 2015.", verified: 90, by: "u-margaret" }),
  fact({ id: "fact-calumet-2", ws: CALUMET_ID, text: "Every dollar raised goes to scholarships, because board members volunteer their time.", verified: 90, by: "u-margaret" }),
  fact({ id: "fact-formula-1", ws: FORMULA_ID, text: "The team races its car at an annual collegiate competition each summer.", verified: 200, by: "u-hannah" }),
];

const TARTAN_SPECS: CompanySpec[] = [
  {
    id: "aurora-innovation",
    name: "Aurora Innovation",
    industry: "Autonomous vehicles",
    website: "aurora.tech",
    notes: "Pittsburgh office. Sponsored a prize track at a hackathon in 2025.",
    stage: "CONTACTED",
    follow: 1,
    claim: ["devon", "auto"],
    contacts: [["Camila Duarte", "Campus Programs Lead"]],
    outreach: [{ ago: 6, by: "devon", tpl: "intro", note: "Sent the sponsor deck to Camila." }],
  },
  {
    id: "duolingo",
    name: "Duolingo",
    industry: "Education technology",
    website: "duolingo.com",
    stage: "REPLIED",
    follow: -3,
    contacts: [["Nikhil Rao", "University Recruiting Manager"]],
    outreach: [
      { ago: 12, by: "amara", tpl: "intro", reply: true, note: "Nikhil replied and asked about attendance." },
      { ago: 10, by: "amara", note: "Sent last year's numbers." },
    ],
    moves: [{ ago: 11, to: "REPLIED", by: "amara" }],
  },
  {
    id: "pnc-bank",
    name: "PNC Bank",
    industry: "Finance",
    website: "pnc.com",
    notes: "Meal sponsor for Saturday night. Invoice sent.",
    stage: "COMMITTED",
    outreach: [{ ago: 30, by: "jordan", tpl: "intro", reply: true, note: "Agreed to sponsor dinner." }],
    moves: [{ ago: 24, to: "COMMITTED", by: "jordan" }],
  },
  {
    id: "gecko-robotics",
    name: "Gecko Robotics",
    industry: "Robotics",
    website: "geckorobotics.com",
    created: 12,
  },
  {
    id: "ansys",
    name: "Ansys",
    industry: "Engineering software",
    website: "ansys.com",
    claim: ["jordan", 150],
    created: 9,
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    industry: "Financial technology",
    website: "bloomberg.com",
    notes: "Only sponsors events in New York.",
    stage: "DECLINED",
    outreach: [{ ago: 20, by: "lucas", tpl: "intro", reply: true, note: "Declined. Only sponsors in New York." }],
    moves: [{ ago: 19, to: "DECLINED", by: "lucas" }],
  },
];

const CALUMET_SPECS: CompanySpec[] = [
  {
    id: "nipsco",
    name: "NIPSCO",
    industry: "Utilities",
    website: "nipsco.com",
    notes: "Pledged a scholarship gift for next fall.",
    stage: "COMMITTED",
    contacts: [["Dolores Weaver", "Community Relations Manager"]],
    outreach: [{ ago: 50, by: "margaret", tpl: "intro", reply: true, note: "Dolores replied the same week." }],
    moves: [{ ago: 36, to: "COMMITTED", by: "margaret" }],
  },
  {
    id: "horizon-bank",
    name: "Horizon Bank",
    industry: "Banking",
    website: "horizonbank.com",
    stage: "REPLIED",
    follow: 4,
    claim: ["ravi", "auto"],
    contacts: [["Kendrick Lowe", "Director of Community Development"]],
    outreach: [{ ago: 10, by: "ravi", tpl: "intro", reply: true, note: "Kendrick asked for the one-page summary." }],
    moves: [{ ago: 9, to: "REPLIED", by: "ravi" }],
  },
  {
    id: "centier-bank",
    name: "Centier Bank",
    industry: "Banking",
    website: "centier.com",
    stage: "CONTACTED",
    follow: -4,
    contacts: [["Paula Kowalski", "Foundation Coordinator"]],
    outreach: [{ ago: 11, by: "beth", tpl: "intro", note: "Sent the gift ask to the foundation." }],
  },
  {
    id: "arcelormittal",
    name: "ArcelorMittal Burns Harbor",
    industry: "Steel manufacturing",
    website: "usa.arcelormittal.com",
    stage: "IN_CONVERSATION",
    follow: 6,
    claim: ["jordan", "auto"],
    contacts: [["Frank Delgado", "Plant Community Liaison"]],
    outreach: [
      { ago: 40, by: "margaret", reply: true, note: "Frank agreed to a meeting." },
      { ago: 8, by: "jordan", note: "Toured the plant with two board members." },
    ],
    moves: [
      { ago: 38, to: "REPLIED", by: "margaret" },
      { ago: 8, to: "IN_CONVERSATION", by: "jordan" },
    ],
  },
  {
    id: "bp-whiting",
    name: "BP Whiting Refinery",
    industry: "Energy",
    website: "bp.com",
    created: 16,
  },
];

const FORMULA_SPECS: CompanySpec[] = [
  {
    id: "bosch",
    name: "Bosch",
    industry: "Automotive",
    website: "bosch.com",
    stage: "CONTACTED",
    follow: -1,
    claim: ["tariq", "auto"],
    contacts: [["Lukas Brandt", "University Partnerships Lead"]],
    outreach: [{ ago: 8, by: "tariq", tpl: "intro", note: "Sent the packet." }],
  },
  { id: "dana-inc", name: "Dana Incorporated", industry: "Automotive", website: "dana.com", created: 10 },
  { id: "aptiv", name: "Aptiv", industry: "Automotive technology", website: "aptiv.com", created: 10 },
];

function build(workspaceId: string, claimWindowDays: number, people: string[], specs: CompanySpec[]): Built {
  return buildCompanies(
    {
      workspaceId,
      claimWindowDays,
      users: Object.fromEntries(people.map((key) => [key, `u-${key}`])),
      templates: { intro: `${workspaceId}-tpl-intro` },
    },
    specs,
  );
}

export function buildOtherCompanies(): Built {
  const parts = [
    build(TARTAN_ID, 7, ["jordan", "lucas", "devon", "amara"], TARTAN_SPECS),
    build(CALUMET_ID, 21, ["jordan", "margaret", "ravi", "beth"], CALUMET_SPECS),
    build(FORMULA_ID, 14, ["hannah", "tariq", "grace"], FORMULA_SPECS),
  ];
  return {
    companies: parts.flatMap((p) => p.companies),
    contacts: parts.flatMap((p) => p.contacts),
    outreach: parts.flatMap((p) => p.outreach),
    stageChanges: parts.flatMap((p) => p.stageChanges),
  };
}
