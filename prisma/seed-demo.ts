import type { Channel, Prisma, Stage } from "@/generated/prisma/client";
import { claimCompany, dbNow, dbToday } from "@/lib/claims";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { domainKey, nameKey } from "@/lib/duplicates";

// The demo workspace: a made-up student club with 40 made-up companies, so the board, the queue
// and the claim badges have something believable to show. Everything here is fictional: the
// companies, people and websites (all *.example.com, a domain reserved for examples) do not exist.
//
// Running it again is safe. The workspace, users and memberships are upserted by fixed ids, and
// the workspace's companies and templates (contacts, outreach and stage history go with the
// companies) are cleared and rebuilt. Nothing outside the demo workspace is read or changed.
//
// Dates are counted back from the database's clock, so overdue follow-ups are overdue whenever
// the seed is run. Rows are written through the Prisma query API inside withTenant, as a member of
// the demo workspace, so row-level security applies to the seed exactly as it does to the app.

export const DEMO_WORKSPACE_ID = "demo-riverbend";
const TIME_ZONE = "America/Indiana/Indianapolis";
const DAY = 24 * 60 * 60 * 1000;

// Index 0 is the owner, the rest are officers (role "member").
const PEOPLE = [
  { id: "demo-user-dana", name: "Dana Whitfield", role: "owner" },
  { id: "demo-user-marcus", name: "Marcus Oyelaran", role: "member" },
  { id: "demo-user-priya", name: "Priya Nandakumar", role: "member" },
  { id: "demo-user-jonah", name: "Jonah Pereira", role: "member" },
  { id: "demo-user-sofia", name: "Sofia Lindqvist", role: "member" },
] as const;
const emailOf = (name: string) => `${name.toLowerCase().replace(/ /g, ".")}@example.com`;

const TEMPLATES = {
  intro: {
    id: "demo-tpl-intro",
    name: "Intro email",
    body: "Hi {{firstName}},\n\nI'm {{senderName}} with {{orgName}}. We are putting together our spring showcase and looking for local companies who would like to be part of it. I can send a one-page overview if that would help.\n\nThanks for reading,\n{{senderName}}",
    archived: false,
  },
  followUp: {
    id: "demo-tpl-follow-up",
    name: "Gentle follow-up",
    body: "Hi {{firstName}},\n\nJust following up on my earlier note from {{orgName}}. Happy to answer questions or set up a quick call, whatever is easiest for you.\n\nBest,\n{{senderName}}",
    archived: false,
  },
  retired: {
    id: "demo-tpl-fall-pitch",
    name: "Fall pitch (retired)",
    body: "Hello {{firstName}},\n\n{{orgName}} is looking for partners for the fall semester. If a short conversation sounds worthwhile, reply here and I will find a time.\n\nRegards,\n{{senderName}}",
    archived: true,
  },
};

type Spec = {
  name: string;
  slug: string;
  industry: string;
  stage: Stage;
  // Index into PEOPLE: who works this company.
  by: number;
  // Days ago of the first touch, days between touches, touches up to and including the reply (or
  // all touches, if there was no reply), and touches after the reply.
  first?: number;
  gap?: number;
  pre?: number;
  post?: number;
  // Whether the company ever answered. Replied, in conversation and committed always did.
  replied?: boolean;
  // Follow-up date in days from today: negative is overdue, 0 is due today.
  due?: number;
  claim?: "live" | "expired";
  linkedin?: boolean;
  note?: string;
  contacts?: string[];
};

// "First Last, Title". Emails are first.last@<company>.example.com.
const SPECS: Spec[] = [
  // Not contacted: fresh leads.
  { name: "Lumenfield Labs", slug: "lumenfield", industry: "Software", stage: "NOT_CONTACTED", by: 1, contacts: ["Elena Brandt, Partnerships Manager"], note: "Their careers page mentions community sponsorships." },
  { name: "Ferncliff Foods", slug: "ferncliff", industry: "Food & beverage", stage: "NOT_CONTACTED", by: 2, contacts: ["Tobias Reinholt, Marketing Director"] },
  { name: "Oakmere Logistics", slug: "oakmere", industry: "Logistics", stage: "NOT_CONTACTED", by: 3 },
  { name: "Pinebrook Dental Group", slug: "pinebrook", industry: "Healthcare", stage: "NOT_CONTACTED", by: 4, contacts: ["Amara Osei, Office Manager"] },
  { name: "Saltmarsh Brewing", slug: "saltmarsh", industry: "Food & beverage", stage: "NOT_CONTACTED", by: 1, contacts: ["Wes Holloran, Owner"], note: "Taproom is a short walk from campus." },
  { name: "Kestrel Ridge Aerospace", slug: "kestrel-ridge", industry: "Aerospace", stage: "NOT_CONTACTED", by: 2, claim: "live", contacts: ["Ingrid Salazar, University Relations"] },
  { name: "Marrowgate Games", slug: "marrowgate", industry: "Gaming", stage: "NOT_CONTACTED", by: 3, contacts: ["Dev Malhotra, Community Lead"] },
  { name: "Copperleaf Energy", slug: "copperleaf", industry: "Energy", stage: "NOT_CONTACTED", by: 4 },
  { name: "Wickerby Furniture", slug: "wickerby", industry: "Retail", stage: "NOT_CONTACTED", by: 0, contacts: ["Naomi Eastwood, Store Manager"] },
  // Same website as Quillon Software below: a look-alike a person has not looked at yet.
  { name: "Quillon Software Inc.", slug: "quillon", industry: "Software", stage: "NOT_CONTACTED", by: 0, note: "Added from a second list. May be the same company as Quillon Software." },

  // Contacted.
  { name: "Brindle & Finch Law", slug: "brindle-finch", industry: "Legal services", stage: "CONTACTED", by: 0, first: 21, gap: 7, pre: 3, due: -2, contacts: ["Harriet Voss, Managing Partner"] },
  { name: "Quillon Software", slug: "quillon", industry: "Software", stage: "CONTACTED", by: 1, first: 12, gap: 6, pre: 2, due: 0, claim: "live", linkedin: true, contacts: ["Rafael Dominguez, Head of People", "Mina Park, Recruiter"] },
  { name: "Harborlight Credit Union", slug: "harborlight", industry: "Finance", stage: "CONTACTED", by: 2, first: 9, gap: 5, pre: 2, due: 3, contacts: ["Clara Whitcombe, Community Outreach"] },
  { name: "Tamarack Freight", slug: "tamarack", industry: "Logistics", stage: "CONTACTED", by: 3, first: 30, gap: 10, pre: 3, due: -4, contacts: ["Gideon Fairweather, Operations Director"] },
  { name: "Alderbrook Analytics", slug: "alderbrook", industry: "Data & analytics", stage: "CONTACTED", by: 0, first: 40, gap: 12, pre: 3, due: -9, claim: "expired", contacts: ["Leila Nakamura, Founder"] },
  { name: "Sunmeadow Farms Co-op", slug: "sunmeadow", industry: "Agriculture", stage: "CONTACTED", by: 1, first: 5, pre: 1, due: 5, claim: "live", contacts: ["Bram Oduya, Co-op Coordinator"] },
  { name: "Fairhollow Insurance", slug: "fairhollow", industry: "Finance", stage: "CONTACTED", by: 2, first: 18, gap: 9, pre: 2, due: 2, linkedin: true, contacts: ["Celeste Marchetti, Agency Principal"] },
  { name: "Ironvale Machining", slug: "ironvale", industry: "Manufacturing", stage: "CONTACTED", by: 3, first: 26, gap: 13, pre: 2, due: -6 },

  // Replied.
  { name: "Velvet Anchor Coffee", slug: "velvet-anchor", industry: "Food & beverage", stage: "REPLIED", by: 1, first: 14, gap: 7, pre: 2, due: 1, claim: "live", contacts: ["Odette Laurent, Co-owner"] },
  { name: "Larkspur Biotech", slug: "larkspur", industry: "Biotech", stage: "REPLIED", by: 2, first: 40, gap: 12, pre: 3, due: -8, claim: "expired", contacts: ["Dr. Emeka Adeyemi, Director of Operations"] },
  { name: "Mosswood Construction", slug: "mosswood", industry: "Construction", stage: "REPLIED", by: 3, first: 19, gap: 8, pre: 2, due: -5, contacts: ["Frances Delacroix, Project Coordinator"] },
  { name: "Pelican Bay Networks", slug: "pelican-bay", industry: "Telecom", stage: "REPLIED", by: 0, first: 10, gap: 4, pre: 2, due: 4, claim: "live", contacts: ["Ravi Subramanian, Regional Manager"] },
  { name: "Redfern Outfitters", slug: "redfern", industry: "Retail", stage: "REPLIED", by: 4, first: 24, pre: 1, due: -7, contacts: ["Tessa Ingram, Marketing Lead"], note: "Replied but nobody has answered yet. Worth picking up." },
  { name: "Glasswing Hardware", slug: "glasswing", industry: "Hardware", stage: "REPLIED", by: 2, first: 8, pre: 1, due: -1, contacts: ["Hugo Brennan, Sales Director"] },

  // In conversation.
  { name: "Cinderfall Semiconductors", slug: "cinderfall", industry: "Semiconductors", stage: "IN_CONVERSATION", by: 3, first: 34, gap: 10, pre: 3, post: 2, due: 3, claim: "live", contacts: ["Annika Solheim, Campus Programs", "Joel Barrett, Engineering Manager"] },
  { name: "Bramblewick Consulting", slug: "bramblewick", industry: "Consulting", stage: "IN_CONVERSATION", by: 1, first: 29, gap: 14, pre: 2, post: 1, due: -3, contacts: ["Winston Achebe, Principal"] },
  { name: "Hollowmere Power Systems", slug: "hollowmere", industry: "Energy", stage: "IN_CONVERSATION", by: 4, first: 22, gap: 8, pre: 2, post: 2, due: 1, claim: "live", contacts: ["Sunita Kapoor, Community Affairs"] },
  { name: "Starling Pharma Services", slug: "starling", industry: "Healthcare", stage: "IN_CONVERSATION", by: 2, first: 55, gap: 14, pre: 3, post: 2, due: -9, claim: "expired", contacts: ["Gabriel Okonkwo, Business Development"] },
  { name: "Underhill Engineering", slug: "underhill", industry: "Engineering", stage: "IN_CONVERSATION", by: 0, first: 17, gap: 9, pre: 2, post: 1, due: 0, contacts: ["Marguerite Fontaine, Principal Engineer"] },

  // Committed.
  { name: "Ambergate Packaging", slug: "ambergate", industry: "Manufacturing", stage: "COMMITTED", by: 1, first: 52, gap: 12, pre: 2, post: 2, contacts: ["Lucas Everhart, Plant Director"] },
  { name: "Juniper Row Financial", slug: "juniper-row", industry: "Finance", stage: "COMMITTED", by: 2, first: 47, gap: 15, pre: 2, post: 2, contacts: ["Imani Rousseau, Vice President"] },
  { name: "Northgrove Telehealth", slug: "northgrove", industry: "Healthcare", stage: "COMMITTED", by: 3, first: 38, gap: 9, pre: 2, post: 1, contacts: ["Dr. Priyanka Menon, Chief of Staff"] },
  { name: "Beacon Hollow Education", slug: "beacon-hollow", industry: "Education", stage: "COMMITTED", by: 0, first: 27, gap: 6, pre: 2, post: 2, contacts: ["Silas Whitaker, Program Director"] },
  { name: "Foxglove Studios", slug: "foxglove", industry: "Media", stage: "COMMITTED", by: 4, first: 20, gap: 5, pre: 2, post: 1, contacts: ["Zainab Qureshi, Creative Producer"] },

  // Declined.
  { name: "Dunmore Steelworks", slug: "dunmore", industry: "Manufacturing", stage: "DECLINED", by: 2, first: 44, gap: 10, pre: 3, contacts: ["Peter Halvorsen, Plant Manager"] },
  { name: "Everly & Wren Advisory", slug: "everly-wren", industry: "Consulting", stage: "DECLINED", by: 1, first: 31, gap: 9, pre: 2, replied: true, contacts: ["Constance Mbeki, Partner"] },
  { name: "Gilded Heron Hotels", slug: "gilded-heron", industry: "Hospitality", stage: "DECLINED", by: 3, first: 40, gap: 15, pre: 2, post: 1, replied: true, contacts: ["Rosalind Kerr, Regional Marketing"] },
  { name: "Cobalt Meadow Materials", slug: "cobalt-meadow", industry: "Materials", stage: "DECLINED", by: 4, first: 15, gap: 7, pre: 2 },
  { name: "Rookery Retail Group", slug: "rookery", industry: "Retail", stage: "DECLINED", by: 0, first: 60, gap: 20, pre: 2, replied: true, contacts: ["Desmond Achterberg, Brand Manager"] },
  { name: "Thistledown Software", slug: "thistledown", industry: "Software", stage: "DECLINED", by: 1, first: 25, gap: 12, pre: 2, contacts: ["Yuki Tanaka, Engineering Recruiter"] },
];

const pick = <T,>(items: T[], i: number) => items[i % items.length];

// What a person typed in the note field after each kind of touch.
const NOTES = {
  intro: [
    "Intro email to {c}. Mentioned the spring showcase and the sponsor tiers.",
    "Sent the intro to {c}; asked who handles community giving.",
    "First email to {c}. Kept it to three sentences.",
    "Intro to {c}, found through the alumni mentor list.",
    "Cold intro to {c} with the one-page overview attached.",
  ],
  introLinkedin: [
    "Connection request and a short note to {c} on LinkedIn.",
    "Messaged {c} on LinkedIn; their email was not listed anywhere.",
  ],
  followUp: [
    "Gentle nudge to {c}. No answer to the first email yet.",
    "Second email to {c} with the date of the showcase.",
    "Followed up with {c} and offered a 15 minute call.",
    "Third try to {c}, shorter this time.",
  ],
  reply: [
    "{c} replied the next day and asked for the sponsor tiers.",
    "Reply from {c}: interested, needs to check with their marketing lead.",
    "{c} answered within hours and suggested a call next week.",
    "{c} replied and asked whether students could visit their office.",
  ],
  call: [
    "Call with {c}, about 20 minutes. Walked through the packages.",
    "Coffee with {c} near campus. They will take it to their team.",
    "Phone call with {c}; they liked the idea of a booth at the showcase.",
  ],
  packet: [
    "Sent {c} the sponsor packet and a thank-you note.",
    "Sent revised numbers to {c} after the call.",
    "Emailed {c} the logo and booth requirements.",
  ],
  confirm: [
    "{c} confirmed. They are in at the bronze tier, invoice to follow from the treasurer.",
    "Confirmed with {c}: they will sponsor the showcase and send their logo.",
    "{c} said yes. Booth space reserved.",
  ],
  declineReply: [
    "{c} replied: budget is set for the year. Closing this out.",
    "{c} wrote back that they only sponsor within their own region. Closing this out.",
    "{c} declined for this semester but would like to hear from us in the fall.",
  ],
  declineSilent: [
    "No answer after three tries. Closing this out.",
    "No reply to either email. Closing this out for now.",
  ],
};

// The calendar day at the start of a West Lafayette day, as an instant. Follow-ups are stored this
// way by logOutreach, so a follow-up for "today" counts as due the whole day.
function localMidnight(ymd: string): Date {
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  // West Lafayette is 4 or 5 hours behind UTC depending on daylight saving: try both.
  for (const hours of [4, 5]) {
    const candidate = new Date(utcMidnight + hours * 60 * 60 * 1000);
    const get = (type: string) => parts.formatToParts(candidate).find((p) => p.type === type)?.value;
    if (`${get("year")}-${get("month")}-${get("day")}` === ymd && get("hour") === "00") return candidate;
  }
  throw new Error(`Could not work out midnight for ${ymd}.`);
}

export type SeedResult = {
  workspaceId: string;
  counts: Record<string, number>;
  ownerNote: string;
};

export async function seedDemo({ ownerEmail }: { ownerEmail?: string } = {}): Promise<SeedResult> {
  const now = await dbNow();
  const today = await dbToday();
  // Midday UTC of today's date, minus whole days, plus a few minutes per event: business-hours
  // timestamps in the past, whatever time the seed runs.
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  const at = (daysAgo: number, seq: number, salt: number) =>
    new Date(dayStart - daysAgo * DAY + (14 * 60 + ((salt * 17) % 200) + seq * 11) * 60 * 1000);

  // Workspace, users and memberships are not tenant tables, so they are written outside withTenant.
  // The slug is unique: if a different workspace already owns it, this fails rather than overwrite it.
  await prisma.workspace.upsert({
    where: { id: DEMO_WORKSPACE_ID },
    create: { id: DEMO_WORKSPACE_ID, name: "Riverbend Robotics Club (demo)", slug: "riverbend-demo", createdAt: new Date(dayStart - 90 * DAY) },
    update: { name: "Riverbend Robotics Club (demo)" },
  });
  for (const person of PEOPLE) {
    const email = emailOf(person.name);
    const fields = { name: person.name, email, emailVerified: true };
    await prisma.user.upsert({ where: { id: person.id }, create: { id: person.id, ...fields }, update: fields });
    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: person.id } },
      create: { id: `demo-m-${person.id}`, workspaceId: DEMO_WORKSPACE_ID, userId: person.id, role: person.role, createdAt: new Date(dayStart - 90 * DAY) },
      update: { role: person.role },
    });
  }

  // Optional: let a person who signed in locally open the demo workspace as an owner.
  let ownerNote = "SEED_OWNER_EMAIL is not set; sign in as a demo user with a test session, or set it and run the seed again.";
  const wanted = ownerEmail?.trim().toLowerCase();
  if (wanted) {
    const user = await prisma.user.findUnique({ where: { email: wanted }, select: { id: true } });
    if (user) {
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: user.id } },
        create: { id: `demo-m-${user.id}`, workspaceId: DEMO_WORKSPACE_ID, userId: user.id, role: "owner", createdAt: now },
        update: { role: "owner" },
      });
      ownerNote = `${wanted} is an owner of the demo workspace.`;
    } else {
      ownerNote = `SEED_OWNER_EMAIL: no local user has the email ${wanted}. Sign in once locally, then run the seed again.`;
    }
  }

  const actor = (index: number) => ({ userId: PEOPLE[index].id, workspaceId: DEMO_WORKSPACE_ID });
  const sender = (index: number) => PEOPLE[index].id;

  const companies: Prisma.CompanyCreateManyInput[] = [];
  const contacts: Prisma.ContactCreateManyInput[] = [];
  const outreach: Prisma.OutreachCreateManyInput[] = [];
  const changes: Prisma.StageChangeCreateManyInput[] = [];
  // Companies whose claim is written after the rows exist.
  const live: { id: string; by: number }[] = [];
  const expired: { id: string; by: number; expiresAt: Date }[] = [];

  SPECS.forEach((spec, i) => {
    const n = String(i + 1).padStart(2, "0");
    const id = `demo-co-${n}`;
    const people = (spec.contacts ?? []).map((line) => {
      const [name, title] = line.split(", ");
      const parts = name.replace(/^Dr\. /, "").toLowerCase().split(" ");
      return { name, title, email: `${parts[0]}.${parts[parts.length - 1]}@${spec.slug}.example.com` };
    });
    people.forEach((p, k) => contacts.push({ id: `demo-ct-${n}-${k + 1}`, workspaceId: DEMO_WORKSPACE_ID, companyId: id, ...p, createdAt: at(spec.first ?? 20, 0, i) }));
    const who = people[0]?.name.replace(/^Dr\. /, "").split(" ")[0] ?? "the team";
    const text = (kind: keyof typeof NOTES, k: number) => pick(NOTES[kind], i + k).replace("{c}", who);

    const pre = spec.pre ?? 0;
    const post = spec.post ?? 0;
    const terminal = spec.stage === "COMMITTED" || spec.stage === "DECLINED";
    const replied = spec.replied === true || ["REPLIED", "IN_CONVERSATION", "COMMITTED"].includes(spec.stage);
    const conversed = post > 0;

    // Touch timings, in days ago.
    const touches: { ago: number; channel: Channel; templateId: string | null; note: string; gotReply: boolean; by: number }[] = [];
    for (let k = 0; k < pre; k++) {
      const ago = (spec.first ?? 0) - k * (spec.gap ?? 0);
      const isReply = replied && k === pre - 1;
      let kind: keyof typeof NOTES = k === 0 ? (spec.linkedin ? "introLinkedin" : "intro") : "followUp";
      if (isReply) kind = spec.stage === "DECLINED" && !conversed ? "declineReply" : "reply";
      if (!replied && spec.stage === "DECLINED" && k === pre - 1) kind = "declineSilent";
      const linkedin = k === 0 && spec.linkedin === true;
      touches.push({
        ago,
        channel: linkedin ? "LINKEDIN" : "EMAIL",
        // Older first touches went out under the pitch the club has since retired.
        templateId: linkedin ? null : k === 0 ? ((spec.first ?? 0) >= 45 ? TEMPLATES.retired.id : TEMPLATES.intro.id) : TEMPLATES.followUp.id,
        note: text(kind, k),
        gotReply: isReply,
        by: k % 3 === 2 && spec.by !== 0 && !spec.claim ? 0 : spec.by,
      });
    }
    const replyAgo = replied ? touches[pre - 1].ago - 1 : null;
    for (let k = 0; k < post; k++) {
      const last = k === post - 1;
      const kind: keyof typeof NOTES = last && spec.stage === "COMMITTED" ? "confirm" : last && spec.stage === "DECLINED" ? "declineReply" : k === 0 ? "call" : "packet";
      touches.push({
        ago: (replyAgo as number) - 2 - 3 * k,
        channel: k === 0 ? (i % 2 === 0 ? "IN_PERSON" : "OTHER") : "EMAIL",
        templateId: null,
        note: text(kind, k),
        gotReply: false,
        by: spec.by,
      });
    }

    // Stage history: each move starts where the last ended and happens after the touch that caused it.
    const path: { to: Stage; ago: number }[] = [];
    if (touches.length > 0) path.push({ to: "CONTACTED", ago: touches[0].ago });
    if (replied) path.push({ to: "REPLIED", ago: replyAgo as number });
    if (conversed && replied) path.push({ to: "IN_CONVERSATION", ago: touches[pre].ago });
    if (terminal) path.push({ to: spec.stage, ago: Math.max(1, touches[touches.length - 1].ago - (spec.stage === "DECLINED" ? 3 : 4)) });
    path.forEach((step, k) => {
      changes.push({
        id: `demo-sc-${n}-${k + 1}`,
        workspaceId: DEMO_WORKSPACE_ID,
        companyId: id,
        changedById: sender(k === 0 || k >= 2 ? spec.by : touches[pre - 1].by),
        fromStage: k === 0 ? "NOT_CONTACTED" : path[k - 1].to,
        toStage: step.to,
        changedAt: at(step.ago, 5, i),
      });
    });
    if ((path[path.length - 1]?.to ?? "NOT_CONTACTED") !== spec.stage) throw new Error(`Seed data for ${spec.name} does not end at ${spec.stage}.`);

    touches.forEach((t, k) => {
      outreach.push({
        id: `demo-o-${n}-${k + 1}`,
        workspaceId: DEMO_WORKSPACE_ID,
        companyId: id,
        senderId: sender(t.by),
        templateId: t.templateId,
        channel: t.channel,
        sentAt: at(t.ago, k, i),
        note: t.note,
        gotReply: t.gotReply,
      });
    });

    const lastContacted = touches.length > 0 ? at(touches[touches.length - 1].ago, touches.length - 1, i) : null;
    companies.push({
      id,
      workspaceId: DEMO_WORKSPACE_ID,
      name: spec.name,
      industry: spec.industry,
      website: `https://${spec.slug}.example.com`,
      notes: spec.note ?? null,
      nameKey: nameKey(spec.name),
      domainKey: domainKey(`https://${spec.slug}.example.com`),
      stage: spec.stage,
      nextFollowUpAt: !terminal && spec.due !== undefined ? localMidnight(addDays(today, spec.due)) : null,
      lastContactedAt: lastContacted,
      createdAt: at((spec.first ?? 12) + 7, 0, i),
    });

    if (spec.claim === "live") live.push({ id, by: spec.by });
    // A real claim runs for the workspace's window (14 days) after the last touch.
    if (spec.claim === "expired" && lastContacted) expired.push({ id, by: spec.by, expiresAt: new Date(lastContacted.getTime() + 14 * DAY) });
  });

  await withTenant(actor(0), async (tx) => {
    // Clear the demo workspace's rows. Contacts, outreach and stage history go with their companies.
    await tx.company.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } });
    await tx.template.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } });

    await tx.template.createMany({
      data: Object.values(TEMPLATES).map((t, k) => ({
        id: t.id,
        workspaceId: DEMO_WORKSPACE_ID,
        name: t.name,
        body: t.body,
        archivedAt: t.archived ? at(30, 0, 3) : null,
        createdAt: at(80 - k, 0, k),
      })),
    });
    await tx.company.createMany({ data: companies });
    await tx.contact.createMany({ data: contacts });
    await tx.outreach.createMany({ data: outreach });
    await tx.stageChange.createMany({ data: changes });

    // Expired claims cannot be made through lib/claims.ts: claimCompany always sets a claim that
    // ends in the future. The seed writes them directly, which only this file does outside
    // lib/claims.ts, to show what a claim looks like once its holder went quiet. It is limited
    // to demo rows by id, inside the demo workspace's tenant transaction.
    for (const claim of expired) {
      await tx.company.update({
        where: { id_workspaceId: { id: claim.id, workspaceId: DEMO_WORKSPACE_ID } },
        data: { claimedById: sender(claim.by), claimExpiresAt: claim.expiresAt },
      });
    }
  });

  // Live claims go through the same function the Claim button calls, one holder at a time.
  for (const claim of live) {
    const result = await claimCompany(actor(claim.by), claim.id);
    if (!result.ok) throw new Error(`Could not claim ${claim.id}: ${result.error}`);
  }

  return {
    workspaceId: DEMO_WORKSPACE_ID,
    counts: {
      companies: companies.length,
      contacts: contacts.length,
      templates: Object.keys(TEMPLATES).length,
      outreach: outreach.length,
      stageChanges: changes.length,
      liveClaims: live.length,
      expiredClaims: expired.length,
      users: PEOPLE.length,
    },
    ownerNote,
  };
}
