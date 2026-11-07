import { claimCompany, dbNow, dbToday } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { DEMO_WORKSPACE_ID, PEOPLE, TEMPLATES, emailOf } from "./seed-data";
import { buildRows, type DemoRows } from "./seed-rows";

export { DEMO_WORKSPACE_ID };

// The demo workspace: a made-up student club with 40 made-up companies, so the board, the queue
// and the claim badges have something believable to show. The made-up data is in prisma/seed-data.ts
// and prisma/seed-rows.ts turns it into rows; this file writes them.
//
// Running it again is safe. The workspace, users and memberships are upserted by fixed ids, and
// the workspace's companies and templates (contacts, outreach and stage history go with the
// companies) are cleared and rebuilt. Nothing outside the demo workspace is read or changed.
//
// Dates are counted back from the database's clock, so overdue follow-ups are overdue whenever
// the seed is run. Rows are written through the Prisma query API inside withTenant, as a member of
// the demo workspace, so row-level security applies to the seed exactly as it does to the app.

export type SeedResult = {
  workspaceId: string;
  counts: Record<string, number>;
  ownerNote: string;
};

const actor = (index: number) => ({ userId: PEOPLE[index].id, workspaceId: DEMO_WORKSPACE_ID });

// Workspace, users and memberships are not tenant tables, so they are written outside withTenant.
// The slug is unique: if a different workspace already owns it, this fails rather than overwrite it.
async function upsertPeople(dayStart: number) {
  const workspace = await prisma.workspace.upsert({
    where: { id: DEMO_WORKSPACE_ID },
    create: { id: DEMO_WORKSPACE_ID, name: "Riverbend Robotics Club (demo)", slug: "riverbend-demo", createdAt: new Date(dayStart - 90 * 24 * 60 * 60 * 1000) },
    update: { name: "Riverbend Robotics Club (demo)" },
  });
  for (const person of PEOPLE) {
    const email = emailOf(person.name);
    const fields = { name: person.name, email, emailVerified: true };
    await prisma.user.upsert({ where: { id: person.id }, create: { id: person.id, ...fields }, update: fields });
    await prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: person.id } },
      create: { id: `demo-m-${person.id}`, workspaceId: DEMO_WORKSPACE_ID, userId: person.id, role: person.role, createdAt: workspace.createdAt },
      update: { role: person.role },
    });
  }
  return workspace;
}

// Optional: let a person who signed in locally open the demo workspace as an owner.
async function addOwnerFromEnv(ownerEmail: string | undefined, now: Date): Promise<string> {
  const wanted = ownerEmail?.trim().toLowerCase();
  if (!wanted) return "SEED_OWNER_EMAIL is not set; sign in as a demo user with a test session, or set it and run the seed again.";
  const user = await prisma.user.findUnique({ where: { email: wanted }, select: { id: true } });
  if (!user) return `SEED_OWNER_EMAIL: no local user has the email ${wanted}. Sign in once locally, then run the seed again.`;
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: user.id } },
    create: { id: `demo-m-${user.id}`, workspaceId: DEMO_WORKSPACE_ID, userId: user.id, role: "owner", createdAt: now },
    update: { role: "owner" },
  });
  return `${wanted} is an owner of the demo workspace.`;
}

async function writeDemo(rows: DemoRows) {
  await withTenant(actor(0), async (tx) => {
    // Clear the demo workspace's rows. Contacts, outreach and stage history go with their companies.
    await tx.company.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } });
    await tx.template.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } });

    await tx.template.createMany({ data: rows.templates });
    await tx.company.createMany({ data: rows.companies });
    await tx.contact.createMany({ data: rows.contacts });
    await tx.outreach.createMany({ data: rows.outreach });
    await tx.stageChange.createMany({ data: rows.changes });

    // Expired claims cannot be made through lib/claims.ts: claimCompany always sets a claim that
    // ends in the future. The seed writes them directly, which only this file does outside
    // lib/claims.ts (tests/seed.test.ts pins that), to show what a claim looks like once its holder
    // went quiet. It is limited to demo rows by id, inside the demo workspace's tenant transaction.
    for (const claim of rows.expired) {
      await tx.company.update({
        where: { id_workspaceId: { id: claim.id, workspaceId: DEMO_WORKSPACE_ID } },
        data: { claimedById: PEOPLE[claim.by].id, claimExpiresAt: claim.expiresAt },
      });
    }
  });

  // Live claims go through the same function the Claim button calls, one holder at a time.
  for (const claim of rows.live) {
    const result = await claimCompany(actor(claim.by), claim.id);
    if (!result.ok) throw new Error(`Could not claim ${claim.id}: ${result.error}`);
  }
}

// The made-up people have already taken the onboarding tours, so a demo session (and every
// screenshot of one) opens straight onto the page. Each row is written as its own person: the
// table's row-level security lets nobody else write it. Someone added with SEED_OWNER_EMAIL is a
// real person and still gets the tour.
async function markToursDone(now: Date) {
  for (const [index, person] of PEOPLE.entries()) {
    const done = { basicsStep: 8, basicsDoneAt: now, basicsRole: person.role, aiStep: 7, aiDoneAt: now };
    await withTenant(actor(index), (tx) =>
      tx.onboardingProgress.upsert({
        where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: person.id } },
        create: { workspaceId: DEMO_WORKSPACE_ID, userId: person.id, ...done },
        update: {},
      }),
    );
  }
}

export async function seedDemo({ ownerEmail }: { ownerEmail?: string } = {}): Promise<SeedResult> {
  const now = await dbNow();
  const today = await dbToday();
  const workspace = await upsertPeople(Date.parse(`${today}T00:00:00Z`));
  const ownerNote = await addOwnerFromEnv(ownerEmail, now);

  const rows = buildRows(today, workspace.claimWindowDays);
  await writeDemo(rows);
  await markToursDone(now);

  return {
    workspaceId: DEMO_WORKSPACE_ID,
    counts: {
      companies: rows.companies.length,
      contacts: rows.contacts.length,
      templates: Object.keys(TEMPLATES).length,
      outreach: rows.outreach.length,
      stageChanges: rows.changes.length,
      liveClaims: rows.live.length,
      expiredClaims: rows.expired.length,
      users: PEOPLE.length,
    },
    ownerNote,
  };
}
