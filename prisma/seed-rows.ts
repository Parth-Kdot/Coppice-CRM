import type { Channel, Prisma, Stage } from "@/generated/prisma/client";
import { addDays, DAY_MS, TIME_ZONE } from "@/lib/dates";
import { domainKey, nameKey } from "@/lib/duplicates";
import { DEMO_WORKSPACE_ID, NOTES, PEOPLE, SPECS, TEMPLATES } from "./seed-data";

const pick = <T,>(items: T[], i: number) => items[i % items.length];
const senderOf = (index: number) => PEOPLE[index].id;

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

export type DemoRows = {
  templates: Prisma.TemplateCreateManyInput[];
  companies: Prisma.CompanyCreateManyInput[];
  contacts: Prisma.ContactCreateManyInput[];
  outreach: Prisma.OutreachCreateManyInput[];
  changes: Prisma.StageChangeCreateManyInput[];
  // Companies whose claim is written after the rows exist: live ones through claimCompany, expired
  // ones directly (see writeDemo in prisma/seed-demo.ts).
  live: { id: string; by: number }[];
  expired: { id: string; by: number; expiresAt: Date }[];
};

// Turns the demo data into rows. Pure: it reads no clock and no database. `today` is the database's
// calendar day (YYYY-MM-DD) and `claimWindowDays` is the workspace's claim window, so dates are
// counted back from the database's clock whenever the seed runs.
export function buildRows(today: string, claimWindowDays: number): DemoRows {
  // Midday UTC of today's date, minus whole days, plus a few minutes per event: business-hours
  // timestamps in the past, whatever time the seed runs.
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  const at = (daysAgo: number, seq: number, salt: number) =>
    new Date(dayStart - daysAgo * DAY_MS + (14 * 60 + ((salt * 17) % 200) + seq * 11) * 60 * 1000);

  const companies: Prisma.CompanyCreateManyInput[] = [];
  const contacts: Prisma.ContactCreateManyInput[] = [];
  const outreach: Prisma.OutreachCreateManyInput[] = [];
  const changes: Prisma.StageChangeCreateManyInput[] = [];
  const live: DemoRows["live"] = [];
  const expired: DemoRows["expired"] = [];

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
        changedById: senderOf(k === 0 || k >= 2 ? spec.by : touches[pre - 1].by),
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
        senderId: senderOf(t.by),
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
    // A real claim runs for the workspace's window after the last touch.
    if (spec.claim === "expired" && lastContacted) expired.push({ id, by: spec.by, expiresAt: new Date(lastContacted.getTime() + claimWindowDays * DAY_MS) });
  });

  const templates = Object.values(TEMPLATES).map((t, k) => ({
    id: t.id,
    workspaceId: DEMO_WORKSPACE_ID,
    name: t.name,
    body: t.body,
    archivedAt: t.archived ? at(30, 0, 3) : null,
    createdAt: at(80 - k, 0, k),
  }));
  return { templates, companies, contacts, outreach, changes, live, expired };
}
