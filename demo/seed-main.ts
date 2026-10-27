import { DEMO_TODAY } from "./clock";
import { addDaysYmd, zonedToIso } from "./dates";
import { buildCompanies, type Built, type CompanySpec } from "./seed-helpers";
import type { Draft, Fact, FactSheetFile, Finding, Invitation, Member, Person, Template, Workspace } from "./types";

// The main demo workspace: a Purdue student robotics club, with the signed-in person as an officer.
// Everything is written relative to DEMO_NOW (2026-10-28, a Wednesday, 3:00 PM).

export const MAIN_WORKSPACE_ID = "boiler-robotics";
const WS = MAIN_WORKSPACE_ID;

// The signed-in person, an officer.
export const ME_ID = "u-jordan";

const ago = (days: number, hour = 10) => zonedToIso(addDaysYmd(DEMO_TODAY, -days), hour);

const person = (key: string, name: string): Person => ({
  id: `u-${key}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, ".")}@purdue.example`,
});

export const MAIN_PEOPLE: Person[] = [
  person("priya", "Priya Raghunathan"),
  person("jordan", "Jordan Ellis"),
  person("marcus", "Marcus Webb"),
  person("aaliyah", "Aaliyah Brooks"),
  person("wei", "Wei Chen"),
  person("sofia", "Sofia Martinez"),
  // Left the club after graduating. Their history stays on the companies they worked.
  person("kenji", "Kenji Watanabe"),
];

export const MAIN_WORKSPACE: Workspace = {
  id: WS,
  name: "Boilermaker Robotics Club",
  kind: "student-org",
  school: "Purdue University",
  tagline: "A student engineering team that builds autonomous rovers and competes every spring.",
  claimWindowDays: 14,
  aiEnabled: true,
  aiMonthlyLimit: 300,
  aiCallsUsed: 87,
  createdAt: ago(430, 9),
};

const member = (key: string, role: "owner" | "member", joinedDaysAgo: number): Member => ({
  id: `m-${WS}-${key}`,
  workspaceId: WS,
  userId: `u-${key}`,
  role,
  joinedAt: ago(joinedDaysAgo, 9),
});

// An owner and five officers. The signed-in person is Jordan, an officer.
export const MAIN_MEMBERS: Member[] = [
  member("priya", "owner", 430),
  member("marcus", "member", 400),
  member("aaliyah", "member", 390),
  member("jordan", "member", 340),
  member("wei", "member", 330),
  member("sofia", "member", 190),
];

export const MAIN_INVITATIONS: Invitation[] = [
  {
    id: `inv-${WS}-1`,
    workspaceId: WS,
    email: "taylor.brooks@purdue.example",
    role: "member",
    createdAt: ago(4, 14),
    expiresAt: ago(-3, 14),
    inviterId: "u-priya",
    link: "https://coppice.example/join/k7Qp2mXv9R",
  },
  {
    id: `inv-${WS}-2`,
    workspaceId: WS,
    email: "dana.kim@purdue.example",
    role: "owner",
    createdAt: ago(1, 16),
    expiresAt: ago(-6, 16),
    inviterId: "u-priya",
    link: "https://coppice.example/join/Hs3Zt8LwB1",
  },
];

export const MAIN_TEMPLATES: Template[] = [
  {
    id: `${WS}-tpl-intro`,
    workspaceId: WS,
    name: "Cold intro with packet",
    body: "Hi {{firstName}},\n\nI'm {{senderName}}, an officer with {{orgName}}, a student engineering team at Purdue. We are looking for a few companies to partner with this season, and I wanted to share our sponsorship packet.\n\nWould you be open to a short call, or is there a better person for me to send it to?\n\nThank you,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(420, 10),
  },
  {
    id: `${WS}-tpl-alumni`,
    workspaceId: WS,
    name: "Alumni referral intro",
    body: "Hi {{firstName}},\n\n{{senderName}} here from {{orgName}} at Purdue. A Purdue alum on your team suggested I reach out about sponsoring our student robotics team.\n\nI can send our sponsorship packet, or set up a 15-minute call if that is easier.\n\nBest,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(300, 10),
  },
  {
    id: `${WS}-tpl-followup`,
    workspaceId: WS,
    name: "Short follow-up",
    body: "Hi {{firstName}},\n\nFollowing up on my earlier note about sponsoring {{orgName}}. Happy to send the packet again or answer any questions.\n\nThanks,\n{{senderName}}\n{{orgName}}",
    archivedAt: null,
    createdAt: ago(300, 11),
  },
];

// ----- The fact sheet: verified, unverified and stale facts, with page numbers and quotes -----

export const MAIN_FACT_SHEETS: FactSheetFile[] = [
  { id: "fs-2026", workspaceId: WS, fileName: "BRC-Sponsorship-Packet-2026-27.pdf", pageCount: 12, uploadedById: "u-priya", createdAt: ago(44, 15) },
  { id: "fs-2024", workspaceId: WS, fileName: "BRC-Sponsorship-Packet-2024-25.pdf", pageCount: 10, uploadedById: "u-priya", createdAt: ago(436, 15) },
];

type FactSeed = {
  id: string;
  sheet: string | null;
  text: string;
  quote?: string;
  page?: number;
  found?: boolean;
  // Days ago the fact was verified, omitted when it is still waiting for a check.
  verified?: number;
  created: number;
};

const fact = (f: FactSeed): Fact => ({
  id: f.id,
  workspaceId: WS,
  factSheetId: f.sheet,
  source: f.sheet ? "PDF" : "MANUAL",
  text: f.text,
  quote: f.quote ?? null,
  pageNumber: f.page ?? null,
  quoteFound: f.found ?? false,
  verifiedAt: f.verified === undefined ? null : ago(f.verified, 16),
  verifiedById: f.verified === undefined ? null : "u-priya",
  createdById: "u-priya",
  createdAt: ago(f.created, 15),
});

export const MAIN_FACTS: Fact[] = [
  // Verified.
  fact({
    id: "fact-members",
    sheet: "fs-2026",
    text: "The club has 64 active members across mechanical, electrical, and software teams.",
    quote: "Boilermaker Robotics Club has 64 active members organized into mechanical, electrical, and software teams.",
    page: 2,
    found: true,
    verified: 44,
    created: 44,
  }),
  fact({
    id: "fact-placed",
    sheet: "fs-2026",
    text: "The team placed 3rd of 41 teams at the 2026 Midwest Collegiate Rover Challenge.",
    quote: "In June 2026 our rover placed 3rd out of 41 teams at the Midwest Collegiate Rover Challenge.",
    page: 3,
    found: true,
    verified: 44,
    created: 44,
  }),
  fact({
    id: "fact-gold",
    sheet: "fs-2026",
    text: "Gold sponsorship is $5,000 and includes a logo on the rover and a recruiting table at our spring showcase.",
    quote: "Gold ($5,000): logo on the rover, a recruiting table at the spring showcase, and a link on our website.",
    page: 6,
    found: true,
    verified: 44,
    created: 44,
  }),
  fact({
    id: "fact-silver",
    sheet: "fs-2026",
    text: "Silver sponsorship is $2,500 and includes a logo on team shirts and a link on our website.",
    quote: "Silver ($2,500): logo on team shirts and a link on our website.",
    page: 6,
    found: true,
    verified: 44,
    created: 44,
  }),
  fact({ id: "fact-demo", sheet: null, text: "We offer sponsors a 20-minute technical demo at their site.", verified: 26, created: 26 }),
  // Stale: last checked more than a year ago, so they carry a Stale badge.
  fact({
    id: "fact-founded",
    sheet: "fs-2024",
    text: "The club was founded in 2011.",
    quote: "Founded in 2011, Boilermaker Robotics Club builds autonomous rovers.",
    page: 2,
    found: true,
    verified: 434,
    created: 436,
  }),
  fact({
    id: "fact-urc",
    sheet: "fs-2024",
    text: "Our 2025 rover competed in the University Rover Challenge finals.",
    quote: "In 2025 our rover competed in the University Rover Challenge finals.",
    page: 4,
    found: true,
    verified: 421,
    created: 436,
  }),
  // Waiting for an owner to check. The Bronze fact says $1,000 but its quote says $1,200, so the
  // quote check fails and the page shows a warning.
  fact({
    id: "fact-bronze",
    sheet: "fs-2026",
    text: "Bronze sponsorship is $1,000 and includes a logo on our website.",
    quote: "Bronze ($1,200): logo on our website.",
    page: 6,
    found: false,
    created: 44,
  }),
  fact({
    id: "fact-showcase",
    sheet: "fs-2026",
    text: "Our spring showcase in April draws about 300 students and 25 recruiters.",
    quote: "The spring showcase draws roughly 300 students and 25 recruiters each April.",
    page: 7,
    found: true,
    created: 44,
  }),
  fact({
    id: "fact-budget",
    sheet: "fs-2026",
    text: "The club's budget for the 2026-27 season is $48,000.",
    quote: "Our operating budget for the 2026-27 season is $48,000.",
    page: 9,
    found: true,
    created: 44,
  }),
  fact({
    id: "fact-interns",
    sheet: "fs-2026",
    text: "Members have completed 14 internships at aerospace and automotive companies.",
    quote: "Team members have completed 14 internships at aerospace and automotive companies since 2024.",
    page: 5,
    found: true,
    created: 44,
  }),
];

// ----- Two pairs of AI drafts the signed-in person already has, so the draft panel opens with content -----

const NO_FINDINGS: Finding[] = [];

function draftPair(args: {
  prefix: string;
  companyId: string;
  contactId: string | null;
  to: string;
  greeting: string;
  daysAgo: number;
  hour: number;
  variants: { angle: string; subject: string; body: string; ai: Finding[] }[];
}): Draft[] {
  const createdAt = ago(args.daysAgo, args.hour);
  return args.variants.map((v, i) => ({
    id: `${args.prefix}-${i + 1}`,
    workspaceId: WS,
    companyId: args.companyId,
    contactId: args.contactId,
    createdById: ME_ID,
    kind: "FIRST_TOUCH" as const,
    angle: v.angle,
    subject: v.subject,
    body: v.body.replace("{greeting}", args.greeting),
    to: args.to,
    createdAt,
    check: { subject: v.subject, body: v.body.replace("{greeting}", args.greeting), ai: v.ai, error: null },
    model: "gemini-3.8-flash",
  }));
}

export const MAIN_DRAFTS: Draft[] = [
  ...draftPair({
    prefix: "d-nvidia",
    companyId: "nvidia",
    contactId: null,
    to: "",
    greeting: "Hi there,",
    daysAgo: 1,
    hour: 16,
    variants: [
      {
        angle: "Lead with competition results",
        subject: "Partnering with Boilermaker Robotics Club",
        body: "{greeting}\n\nI'm Jordan Ellis from Boilermaker Robotics Club. Our rover placed 3rd of 41 teams at the 2026 Midwest Collegiate Rover Challenge, and we are looking for a few companies to partner with this season.\n\nWould a 15-minute call work, or would you like our sponsorship packet first?\n\nThanks,\nJordan Ellis\nBoilermaker Robotics Club",
        ai: NO_FINDINGS,
      },
      {
        angle: "Lead with sponsor benefits",
        subject: "Gold and Silver sponsorship, Boilermaker Robotics Club",
        body: "{greeting}\n\nJordan here from Boilermaker Robotics Club. Gold sponsors give $5,000 and get their logo on the rover, and Silver sponsors give $2,500. Companies like yours often tell us our members are among the best-prepared engineering students they recruit.\n\nIf it would help, I can send the packet or set up a quick call.\n\nThanks,\nJordan Ellis\nBoilermaker Robotics Club",
        ai: [
          { kind: "unsupported", quote: "Companies like yours often tell us", reason: "No verified fact says other companies have said this." },
          {
            kind: "unsupported",
            quote: "our members are among the best-prepared engineering students they recruit",
            reason: "The facts do not rank our members against other students.",
          },
        ],
      },
    ],
  }),
  ...draftPair({
    prefix: "d-microsoft",
    companyId: "microsoft",
    contactId: "microsoft-c1",
    to: "elaine.whitfield@microsoft.example",
    greeting: "Hi Elaine,",
    daysAgo: 12,
    hour: 10,
    variants: [
      {
        angle: "Lead with competition results",
        subject: "Boilermaker Robotics Club and Microsoft",
        body: "{greeting}\n\nI'm Jordan Ellis, an officer with Boilermaker Robotics Club at Purdue. Our rover placed 3rd of 41 teams at the 2026 Midwest Collegiate Rover Challenge, and we are looking for a few companies to partner with this season.\n\nWould you be open to a 15-minute call, or would you like our sponsorship packet first?\n\nThanks,\nJordan Ellis\nBoilermaker Robotics Club",
        ai: NO_FINDINGS,
      },
      {
        angle: "Lead with sponsorship tiers",
        subject: "Sponsorship tiers for Boilermaker Robotics Club",
        body: "{greeting}\n\nJordan Ellis here from Boilermaker Robotics Club. Our Gold tier is $5,000 and Silver is $2,500, and Silver sponsors get a link on our website. Many of our members go on to intern at companies like Microsoft.\n\nI can send the full packet if that is useful.\n\nThanks,\nJordan Ellis\nBoilermaker Robotics Club",
        ai: [{ kind: "unsupported", quote: "Many of our members go on to intern at companies like Microsoft", reason: "No verified fact says members intern at Microsoft." }],
      },
    ],
  }),
];

// ----- The companies -----

const intro = "intro";
const alumni = "alumni";
const followup = "followup";

export const MAIN_COMPANY_SPECS: CompanySpec[] = [
  // ===== Not contacted =====
  {
    id: "rockwell-automation",
    name: "Rockwell Automation",
    industry: "Industrial automation",
    website: "rockwellautomation.com",
    notes: "Large Indiana presence with a plant in Indianapolis. A good fit for the controls team.",
    created: 30,
  },
  {
    id: "texas-instruments",
    name: "Texas Instruments",
    industry: "Semiconductors",
    website: "ti.com",
    notes: "Their university program offers hardware donations. Check their grants page before pitching.",
    contacts: [["Hannah Cho", "University Programs Manager"]],
    created: 30,
  },
  {
    id: "boeing",
    name: "Boeing",
    industry: "Aerospace",
    website: "boeing.com",
    notes: "Wei is lining up an alumni introduction before sending anything.",
    claim: ["wei", 259],
    created: 21,
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    industry: "Semiconductors",
    website: "nvidia.com",
    notes: "Jordan claimed this yesterday and drafted two first emails. Waiting on the fact check before sending.",
    claim: ["jordan", 313],
    created: 21,
  },
  {
    id: "honeywell-aerospace",
    name: "Honeywell Aerospace",
    industry: "Aerospace",
    website: "aerospace.honeywell.com",
    created: 14,
  },
  {
    id: "zimmer-biomet",
    name: "Zimmer Biomet",
    industry: "Medical devices",
    website: "zimmerbiomet.com",
    notes: "Headquartered in Warsaw, Indiana. Several Boilermaker alumni work on their engineering team.",
    contacts: [["Samuel Adeyemi", "Community Engagement Manager"]],
    created: 18,
  },
  {
    id: "kimball-electronics",
    name: "Kimball Electronics",
    industry: "Electronics manufacturing",
    website: "kimballelectronics.com",
    notes: "Based in Jasper, Indiana.",
    created: 18,
  },
  {
    id: "subaru-indiana",
    name: "Subaru of Indiana Automotive",
    industry: "Automotive",
    website: "subaru-sia.com",
    notes: "Plant in Lafayette, ten minutes from campus.",
    created: 18,
  },
  {
    id: "lilly-usa",
    name: "Lilly",
    industry: "Pharmaceuticals",
    website: "lilly.com",
    notes: "Added from the career fair list. Check whether this is the same company as Eli Lilly.",
    created: 6,
  },
  {
    id: "rolls-royce-corporation",
    name: "Rolls Royce Corporation",
    industry: "Aerospace",
    notes: "From the old sponsor spreadsheet. No website on file.",
    created: 6,
  },

  // ===== Contacted =====
  {
    id: "cummins",
    name: "Cummins Inc.",
    industry: "Engines and power systems",
    website: "cummins.com",
    notes: "Headquartered in Columbus, Indiana. Their university relations team collects sponsorship requests through a form that opens each January.",
    stage: "CONTACTED",
    follow: -6,
    claim: ["aaliyah", "auto"],
    contacts: [
      ["Dana Reyes", "University Relations Manager"],
      ["Kwame Mensah", "Engineering Recruiter"],
    ],
    outreach: [
      { ago: 190, by: "kenji", tpl: intro, note: "Sent the packet to the general inbox. No reply." },
      { ago: 13, by: "aaliyah", tpl: intro, hour: 11, note: "Wrote to Dana. She said the January form is the formal route, so we should apply then." },
    ],
  },
  {
    id: "allison-transmission",
    name: "Allison Transmission",
    industry: "Automotive",
    website: "allisontransmission.com",
    notes: "Indianapolis headquarters. Wei had a warm introduction through an alumnus.",
    stage: "CONTACTED",
    follow: -10,
    claim: ["wei", "auto"],
    contacts: [["Ingrid Larsen", "Talent Acquisition Partner"]],
    outreach: [{ ago: 17, by: "wei", tpl: alumni, hour: 10, note: "Referral from Kevin T., class of 2018. Packet attached." }],
  },
  {
    id: "corteva",
    name: "Corteva Agriscience",
    industry: "Agriculture",
    website: "corteva.com",
    notes: "Indianapolis campus. Interested in autonomous farming technology.",
    stage: "CONTACTED",
    follow: 2,
    claim: ["jordan", "auto"],
    contacts: [["Gabriel Santos", "Community Engagement Manager"]],
    outreach: [{ ago: 5, by: "jordan", tpl: intro, note: "Intro email to Gabriel. He will check with the community giving team." }],
  },
  {
    id: "elanco",
    name: "Elanco",
    industry: "Animal health",
    website: "elanco.com",
    notes: "Headquartered in Greenfield, Indiana.",
    stage: "CONTACTED",
    follow: -2,
    claim: ["marcus", "auto"],
    contacts: [["Priyanka Desai", "University Relations Lead"]],
    outreach: [{ ago: 9, by: "marcus", ch: "LINKEDIN", note: "Connected with Priyanka on LinkedIn and sent the packet link." }],
  },
  {
    id: "john-deere",
    name: "John Deere",
    industry: "Agricultural equipment",
    website: "deere.com",
    stage: "CONTACTED",
    follow: -15,
    contacts: [["Connor O'Brien", "Campus Recruiter"]],
    outreach: [{ ago: 22, by: "sofia", ch: "LINKEDIN", note: "Messaged a campus recruiter. No answer yet." }],
  },
  {
    id: "toyota-indiana",
    name: "Toyota Motor Manufacturing Indiana",
    industry: "Automotive",
    website: "toyota.com",
    notes: "Plant in Princeton, Indiana.",
    stage: "CONTACTED",
    follow: -30,
    contacts: [["Yuki Nakamura", "Community Relations Coordinator"]],
    outreach: [{ ago: 37, by: "marcus", tpl: intro, note: "Sent to the plant's community relations inbox." }],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    industry: "Software",
    website: "microsoft.com",
    stage: "CONTACTED",
    follow: -5,
    claim: ["jordan", "auto"],
    contacts: [["Elaine Whitfield", "Director of University Programs"]],
    outreach: [{ ago: 12, by: "jordan", draft: "d-microsoft-1", hour: 11, note: "Sent: Boilermaker Robotics Club and Microsoft" }],
  },
  {
    id: "lockheed-martin",
    name: "Lockheed Martin",
    industry: "Aerospace and defense",
    website: "lockheedmartin.com",
    stage: "CONTACTED",
    follow: 0,
    claim: ["priya", "auto"],
    contacts: [["Rohan Mehta", "University Programs Lead"]],
    outreach: [{ ago: 7, by: "priya", tpl: intro, note: "Intro sent to the university programs inbox. Follow-up scheduled for today." }],
  },
  {
    id: "collins-aerospace",
    name: "Collins Aerospace",
    industry: "Aerospace",
    website: "collinsaerospace.com",
    stage: "CONTACTED",
    follow: 3,
    claim: ["aaliyah", "auto"],
    contacts: [["Alejandra Cruz", "STEM Outreach Program Manager"]],
    outreach: [{ ago: 4, by: "aaliyah", tpl: alumni, note: "Introduced through Dr. Patel's lab. They asked for the sponsorship tiers." }],
  },
  {
    id: "rolls-royce",
    name: "Rolls-Royce",
    industry: "Aerospace and defense",
    website: "rolls-royce.com",
    stage: "CONTACTED",
    follow: -1,
    claim: ["jordan", "auto"],
    contacts: [["Chloe Bennett", "University Recruiter"]],
    outreach: [{ ago: 6, by: "jordan", ch: "IN_PERSON", note: "Talked to two engineers at the fall career fair. They gave me a recruiter's card." }],
  },
  {
    id: "roche-diagnostics",
    name: "Roche Diagnostics",
    industry: "Life sciences",
    website: "diagnostics.roche.com",
    stage: "CONTACTED",
    follow: -18,
    contacts: [["Mei-Ling Wu", "Community Giving Specialist"]],
    outreach: [{ ago: 25, by: "marcus", tpl: intro, note: "Sent to the Indianapolis site's community team." }],
  },
  {
    id: "elevance-health",
    name: "Elevance Health",
    industry: "Health insurance",
    website: "elevancehealth.com",
    notes: "Anthem renamed itself Elevance Health. The old Anthem entry is archived.",
    stage: "CONTACTED",
    follow: 5,
    claim: ["sofia", "auto"],
    contacts: [["Zainab Yusuf", "Community Partnerships Manager"]],
    outreach: [{ ago: 2, by: "sofia", tpl: intro, note: "Contacted the Indianapolis community team." }],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    industry: "Software",
    website: "salesforce.com",
    stage: "CONTACTED",
    follow: -12,
    contacts: [["Tyrone Jackson", "Campus Recruiter"]],
    outreach: [{ ago: 19, by: "wei", ch: "LINKEDIN", note: "Messaged a recruiter in the Indianapolis office." }],
  },

  // ===== Replied =====
  {
    id: "eli-lilly",
    name: "Eli Lilly",
    industry: "Pharmaceuticals",
    website: "lilly.com",
    notes: "Rachel asked for the tier details and last season's competition results. She prefers email.",
    stage: "REPLIED",
    follow: -4,
    claim: ["priya", "auto"],
    created: 40,
    contacts: [
      ["Rachel Greene", "University Relations Director"],
      ["Tomás Herrera", "Community Impact Manager"],
    ],
    outreach: [
      { ago: 18, by: "priya", tpl: alumni, reply: true, note: "Introduced through the Lilly Purdue alumni club." },
      { ago: 11, by: "priya", note: "Answered Rachel's questions and sent the tier details." },
    ],
    moves: [{ ago: 16, to: "REPLIED", by: "priya" }],
  },
  {
    id: "intel",
    name: "Intel",
    industry: "Semiconductors",
    website: "intel.com",
    stage: "REPLIED",
    follow: 5,
    claim: ["jordan", "auto"],
    contacts: [["Anika Sharma", "Higher Education Programs Manager"]],
    outreach: [
      { ago: 9, by: "jordan", tpl: intro, reply: true, note: "Intro to Anika. She replied the same day." },
      { ago: 2, by: "jordan", tpl: followup, note: "Sent the tiers and the technical demo offer." },
    ],
    moves: [{ ago: 8, to: "REPLIED", by: "jordan" }],
  },
  {
    id: "ge-aerospace",
    name: "GE Aerospace",
    industry: "Aerospace",
    website: "geaerospace.com",
    stage: "REPLIED",
    follow: -2,
    claim: ["marcus", "auto"],
    contacts: [["Hiroshi Tanaka", "Early Career Programs Lead"]],
    outreach: [
      { ago: 20, by: "marcus", tpl: intro, reply: true, note: "Hiroshi replied within a day and asked about the team's focus." },
      { ago: 9, by: "marcus", tpl: followup, note: "Sent more detail on the rover and the competition schedule." },
    ],
    moves: [{ ago: 18, to: "REPLIED", by: "marcus" }],
  },
  {
    id: "qualcomm",
    name: "Qualcomm",
    industry: "Semiconductors",
    website: "qualcomm.com",
    stage: "REPLIED",
    follow: 1,
    contacts: [["Bianca Rossi", "University Relations Manager"]],
    outreach: [
      { ago: 15, by: "sofia", ch: "LINKEDIN", reply: true, note: "Messaged Bianca on LinkedIn. She asked for an email." },
      { ago: 6, by: "sofia", tpl: followup, note: "Sent the packet after she asked." },
    ],
    moves: [{ ago: 13, to: "REPLIED", by: "sofia" }],
  },
  {
    id: "analog-devices",
    name: "Analog Devices",
    industry: "Semiconductors",
    website: "analog.com",
    stage: "REPLIED",
    follow: -7,
    contacts: [["Imani Carter", "Corporate Giving Specialist"]],
    outreach: [
      { ago: 24, by: "wei", reply: true, note: "Imani replied with questions about team size." },
      { ago: 14, by: "wei", tpl: followup, note: "Answered the team size question and attached the packet." },
    ],
    moves: [{ ago: 22, to: "REPLIED", by: "wei" }],
  },
  {
    id: "emerson",
    name: "Emerson",
    industry: "Industrial automation",
    website: "emerson.com",
    stage: "REPLIED",
    follow: 9,
    claim: ["aaliyah", "auto"],
    contacts: [["Dmitri Volkov", "Director of University Programs"]],
    outreach: [
      { ago: 8, by: "aaliyah", tpl: alumni, reply: true, note: "Alumni introduction. Dmitri replied right away." },
      { ago: 5, by: "aaliyah", tpl: followup, note: "He asked to talk after their fiscal year close, so I set a two week follow-up." },
    ],
    moves: [{ ago: 7, to: "REPLIED", by: "aaliyah" }],
  },
  {
    id: "northrop-grumman",
    name: "Northrop Grumman",
    industry: "Aerospace and defense",
    website: "northropgrumman.com",
    stage: "REPLIED",
    follow: -11,
    contacts: [["Fatima Al-Sayed", "University Recruiting Lead"]],
    outreach: [
      { ago: 25, by: "priya", reply: true, note: "Fatima replied and asked about sponsorship levels." },
      { ago: 18, by: "priya", tpl: followup, note: "Sent the tiers." },
    ],
    moves: [{ ago: 23, to: "REPLIED", by: "priya" }],
  },

  // ===== In conversation =====
  {
    id: "rtx",
    name: "RTX (Raytheon)",
    industry: "Aerospace and defense",
    website: "rtx.com",
    notes: "Verbal interest in Gold. Waiting on their budget cycle in November.",
    stage: "IN_CONVERSATION",
    follow: -2,
    claim: ["priya", "auto"],
    contacts: [["Ethan Park", "Director of University Relations"]],
    outreach: [
      { ago: 34, by: "priya", tpl: alumni, reply: true, note: "Alumni introduction." },
      { ago: 21, by: "priya", note: "Video call with Ethan. He liked the autonomy work." },
      { ago: 9, by: "priya", ch: "IN_PERSON", note: "Visited their Indianapolis office and met two engineers." },
    ],
    moves: [
      { ago: 32, to: "REPLIED", by: "priya" },
      { ago: 20, to: "IN_CONVERSATION", by: "priya" },
    ],
  },
  {
    id: "ford",
    name: "Ford Motor Company",
    industry: "Automotive",
    website: "ford.com",
    stage: "IN_CONVERSATION",
    follow: 3,
    claim: ["jordan", "auto"],
    contacts: [["Joaquín Ortega", "University Partnerships Manager"]],
    outreach: [
      { ago: 20, by: "jordan", reply: true, note: "Joaquín replied and offered a call." },
      { ago: 4, by: "jordan", note: "Call went well. Sending a draft Silver agreement." },
    ],
    moves: [
      { ago: 17, to: "REPLIED", by: "jordan" },
      { ago: 4, to: "IN_CONVERSATION", by: "jordan" },
    ],
  },
  {
    id: "google",
    name: "Google",
    industry: "Software",
    website: "google.com",
    stage: "IN_CONVERSATION",
    follow: 8,
    claim: ["sofia", "auto"],
    contacts: [["Anders Nilsson", "Software Engineer, Student Programs"]],
    outreach: [
      { ago: 27, by: "sofia", ch: "LINKEDIN", reply: true, note: "Anders replied on LinkedIn." },
      { ago: 6, by: "sofia", note: "Video call with two engineers. They want to see a demo in January." },
    ],
    moves: [
      { ago: 25, to: "REPLIED", by: "sofia" },
      { ago: 6, to: "IN_CONVERSATION", by: "sofia" },
    ],
  },
  {
    id: "tesla",
    name: "Tesla",
    industry: "Automotive",
    website: "tesla.com",
    stage: "IN_CONVERSATION",
    follow: -6,
    claim: ["wei", 120],
    contacts: [["Jun Takahashi", "Engineering Recruiter"]],
    outreach: [
      { ago: 30, by: "wei", ch: "LINKEDIN", reply: true, note: "Jun replied on LinkedIn." },
      { ago: 13, by: "wei", note: "Intro call booked for next week." },
    ],
    moves: [
      { ago: 28, to: "REPLIED", by: "wei" },
      { ago: 13, to: "IN_CONVERSATION", by: "wei" },
    ],
  },
  {
    id: "siemens",
    name: "Siemens",
    industry: "Industrial automation",
    website: "siemens.com",
    notes: "Kenji ran this one before he graduated. It needs a new owner.",
    stage: "IN_CONVERSATION",
    follow: -23,
    contacts: [["Ingrid Hoffmann", "Director of University Relations"]],
    outreach: [
      { ago: 52, by: "kenji", reply: true, note: "Ingrid replied and wants to hear about the controls team." },
      { ago: 30, by: "kenji", tpl: followup, note: "Call with the Plano campus team." },
    ],
    moves: [
      { ago: 50, to: "REPLIED", by: "kenji" },
      { ago: 30, to: "IN_CONVERSATION", by: "kenji" },
    ],
  },

  // ===== Committed =====
  {
    id: "general-motors",
    name: "General Motors",
    industry: "Automotive",
    website: "gm.com",
    notes: "Gold sponsor for 2026-27. Their logo is due by Nov 15 for the rover decals.",
    stage: "COMMITTED",
    contacts: [["Tamara Reed", "Community Relations Director"]],
    outreach: [
      { ago: 70, by: "priya", tpl: alumni, reply: true, note: "Alumni introduction." },
      { ago: 40, by: "priya", note: "Call. They want the Gold tier." },
      { ago: 22, by: "priya", ch: "OTHER", note: "Contract signed. Invoice sent Oct 6." },
    ],
    moves: [
      { ago: 66, to: "REPLIED", by: "priya" },
      { ago: 45, to: "IN_CONVERSATION", by: "priya" },
      { ago: 22, to: "COMMITTED", by: "priya" },
    ],
  },
  {
    id: "deloitte",
    name: "Deloitte",
    industry: "Consulting",
    website: "deloitte.com",
    notes: "Silver sponsor. They prefer a thank-you post on LinkedIn.",
    stage: "COMMITTED",
    contacts: [["Olivia Hart", "Campus Recruiting Manager"]],
    outreach: [
      { ago: 60, by: "sofia", reply: true, note: "Olivia replied and offered to meet at the career fair." },
      { ago: 35, by: "sofia", tpl: followup, note: "Sent the Silver tier details." },
      { ago: 28, by: "sofia", ch: "IN_PERSON", note: "Signed at the career fair." },
    ],
    moves: [
      { ago: 56, to: "REPLIED", by: "sofia" },
      { ago: 28, to: "COMMITTED", by: "sofia" },
    ],
  },
  {
    id: "nisource",
    name: "NiSource",
    industry: "Utilities",
    website: "nisource.com",
    notes: "Verbal yes for Bronze. Waiting on the purchase order number.",
    stage: "COMMITTED",
    contacts: [["Elijah Brooks", "Community Affairs Manager"]],
    outreach: [
      { ago: 45, by: "marcus", tpl: alumni, reply: true, note: "Alumni introduction." },
      { ago: 27, by: "marcus", note: "Phone call. Verbal yes." },
    ],
    moves: [
      { ago: 41, to: "REPLIED", by: "marcus" },
      { ago: 27, to: "COMMITTED", by: "marcus" },
    ],
  },
  {
    id: "accenture",
    name: "Accenture",
    industry: "Consulting",
    website: "accenture.com",
    notes: "In-kind support: free resume workshops for members. No cash.",
    stage: "COMMITTED",
    contacts: [["Sara Lindgren", "University Relations Lead"]],
    outreach: [
      { ago: 100, by: "kenji", reply: true, note: "Sara replied with interest in a workshop." },
      { ago: 80, by: "kenji", note: "Agreed on two resume workshops this year." },
    ],
    moves: [
      { ago: 95, to: "REPLIED", by: "kenji" },
      { ago: 80, to: "COMMITTED", by: "kenji" },
    ],
  },

  // ===== Declined =====
  {
    id: "jpmorgan-chase",
    name: "JPMorgan Chase",
    industry: "Finance",
    website: "jpmorganchase.com",
    notes: "Try again after July 1. Their fiscal year resets then.",
    stage: "DECLINED",
    contacts: [["Natalie Cho", "Community Investment Associate"]],
    outreach: [{ ago: 45, by: "marcus", tpl: intro, reply: true, note: "Declined: no student org sponsorships this fiscal year." }],
    moves: [{ ago: 43, to: "DECLINED", by: "marcus" }],
  },
  {
    id: "meta",
    name: "Meta",
    industry: "Software",
    website: "meta.com",
    notes: "They only sponsor hackathons through their university program.",
    stage: "DECLINED",
    outreach: [{ ago: 60, by: "priya", ch: "LINKEDIN", reply: true, note: "Declined. Only sponsors hackathons." }],
    moves: [{ ago: 55, to: "DECLINED", by: "priya" }],
  },
  {
    id: "ups",
    name: "UPS",
    industry: "Logistics",
    website: "ups.com",
    notes: "Budget is fully allocated this year. Try again in January.",
    stage: "DECLINED",
    contacts: [["Marcus Delgado", "Community Relations Manager"]],
    outreach: [
      { ago: 33, by: "sofia", tpl: intro, note: "Intro to the community relations team." },
      { ago: 20, by: "sofia", tpl: followup, reply: true, note: "Budget fully allocated. Suggested trying again in January." },
    ],
    moves: [{ ago: 19, to: "DECLINED", by: "sofia" }],
  },

  // ===== Archived =====
  {
    id: "anthem",
    name: "Anthem, Inc.",
    industry: "Health insurance",
    website: "anthem.com",
    notes: "Renamed Elevance Health. Archived in favor of the new entry.",
    stage: "CONTACTED",
    outreach: [{ ago: 120, by: "kenji", tpl: intro, note: "Sent the packet. No reply." }],
    archived: 15,
  },
  {
    id: "hill-rom",
    name: "Hill-Rom",
    industry: "Medical devices",
    website: "hillrom.com",
    notes: "Acquired by Baxter. No longer a separate sponsor.",
    created: 200,
    archived: 70,
  },
];

export function buildMainCompanies(): Built {
  return buildCompanies(
    {
      workspaceId: WS,
      claimWindowDays: MAIN_WORKSPACE.claimWindowDays,
      users: Object.fromEntries(MAIN_PEOPLE.map((p) => [p.id.slice(2), p.id])),
      templates: { intro: `${WS}-tpl-intro`, alumni: `${WS}-tpl-alumni`, followup: `${WS}-tpl-followup` },
    },
    MAIN_COMPANY_SPECS,
  );
}
