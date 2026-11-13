import type { Membership } from "@/lib/authz";
import { claimCompany, dbToday } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { withTenant } from "@/lib/db";

// A small pipeline for Ask Coppice's tests, in workspace "a" (ownerA owner, officerA officer), plus
// one company in workspace "b". Dates are set from the database's today, so the data is the same
// whatever day the tests run. Raw SQL writes claim and date fields directly (tests may; the app
// never does).
export const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
export const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
export const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

export type Pipeline = {
  today: string;
  // Name to id.
  id: Record<string, string>;
};

async function make(tenant: Membership, name: string, extra: { industry?: string; website?: string; notes?: string } = {}) {
  const created = await createCompany(tenant, { name, ...extra });
  if (created.status !== "saved") throw new Error(`seed company ${name} flagged`);
  return created.companyId;
}

export const NAMES = {
  bramble: "Bramblewick Consulting",
  acme: "Acme Tech",
  globex: "Globex",
  initech: "Initech",
  umbrella: "Umbrella",
  hooli: "Hooli",
  piper: "Pied Piper",
  archived: "Archived Co",
  aperture: "Aperture",
  pure: "100% Pure",
} as const;

// What each company is, relative to officerA:
//   Bramblewick  Contacted, 12 days overdue, held by officerA (live), consulting, an outreach entry
//   Acme Tech    Not contacted, no date, free, technology, website and notes mention "sponsor deck"
//   Globex       Replied, 3 days overdue, held by ownerA (live), technology
//   Initech      Contacted, due in 3 days, officerA's claim has ended, technology
//   Umbrella     In conversation, due in 30 days, health, website with "acme" in it
//   Hooli        Committed          Pied Piper  Declined          Archived Co  archived and overdue
//   Aperture     Contacted, due today, free, an outreach entry noting "zebra program"
//   100% Pure    Not contacted, no date, free, no industry
export async function seedPipeline(): Promise<Pipeline> {
  const today = await dbToday();
  const id: Record<string, string> = {};
  id.bramble = await make(OWNER, NAMES.bramble, { industry: "Consulting" });
  id.acme = await make(OWNER, NAMES.acme, { industry: "Technology", website: "acme.example", notes: "Wants a sponsor deck for fall." });
  id.globex = await make(OWNER, NAMES.globex, { industry: "Technology" });
  id.initech = await make(OWNER, NAMES.initech, { industry: "Technology" });
  id.umbrella = await make(OWNER, NAMES.umbrella, { industry: "Health", website: "https://www.acme-labs.example" });
  id.hooli = await make(OWNER, NAMES.hooli, { industry: "Technology" });
  id.piper = await make(OWNER, NAMES.piper, { industry: "Technology" });
  id.archived = await make(OWNER, NAMES.archived, { industry: "Technology" });
  id.aperture = await make(OWNER, NAMES.aperture, { industry: "Health" });
  id.pure = await make(OWNER, NAMES.pure);

  const at = (days: number) => `${addDays(today, days)}`;
  await withTenant(OWNER, async (tx) => {
    const set = (companyId: string, stage: string, followUp: string | null) =>
      tx.$executeRaw`UPDATE "Company" SET stage = ${stage}::"Stage",
        "nextFollowUpAt" = CASE WHEN ${followUp}::text IS NULL THEN NULL ELSE (${followUp}::date)::timestamp AT TIME ZONE 'America/Indiana/Indianapolis' END
        WHERE id = ${companyId}`;
    await set(id.bramble, "CONTACTED", at(-12));
    await set(id.acme, "NOT_CONTACTED", null);
    await set(id.globex, "REPLIED", at(-3));
    await set(id.initech, "CONTACTED", at(3));
    await set(id.umbrella, "IN_CONVERSATION", at(30));
    await set(id.hooli, "COMMITTED", null);
    await set(id.piper, "DECLINED", null);
    await set(id.archived, "CONTACTED", at(-20));
    await tx.$executeRaw`UPDATE "Company" SET "archivedAt" = now() WHERE id = ${id.archived}`;
    await set(id.aperture, "CONTACTED", at(0));
    await set(id.pure, "NOT_CONTACTED", null);
    await tx.$executeRaw`UPDATE "Company" SET "lastContactedAt" = now() - interval '12 days' WHERE id IN (${id.bramble}, ${id.aperture})`;
    await tx.outreach.create({ data: { workspaceId: "a", companyId: id.bramble, senderId: "officerA", channel: "EMAIL", note: "Sent the packet." } });
    await tx.outreach.create({ data: { workspaceId: "a", companyId: id.aperture, senderId: "ownerA", channel: "LINKEDIN", note: "Mentioned the zebra program." } });
  });
  // Claims: Bramblewick is officerA's, Globex is ownerA's, Initech's was officerA's and has ended.
  await claimCompany(OFFICER, id.bramble);
  await claimCompany(OWNER, id.globex);
  await claimCompany(OFFICER, id.initech);
  await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() - interval '1 minute' WHERE id = ${id.initech}`);

  // Workspace b: a company that matches many searches by name and by outreach note, and must never show up.
  const theirs = await make(OTHER_ORG, "Acme B", { industry: "Technology", website: "acme.example", notes: "sponsor deck zebra" });
  await withTenant(OTHER_ORG, async (tx) => {
    await tx.$executeRaw`UPDATE "Company" SET stage = 'CONTACTED'::"Stage", "nextFollowUpAt" = now() - interval '5 days' WHERE id = ${theirs}`;
    await tx.outreach.create({ data: { workspaceId: "b", companyId: theirs, senderId: "ownerB", channel: "EMAIL", note: "zebra program" } });
  });
  id.theirs = theirs;
  return { today, id };
}
