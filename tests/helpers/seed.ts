import { prisma, withTenant } from "@/lib/db";

// Two workspaces: "a" has an owner and an officer, "b" has its own owner.
// Wipes everything first; deleting workspaces and users cascades to memberships,
// invitations and sessions.
export async function resetAndSeed() {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  // Lowercase emails, like Better Auth stores them after Google sign-in.
  const user = (id: string) => ({ id, name: id, email: `${id.toLowerCase()}@example.com`, emailVerified: true });
  await prisma.user.createMany({ data: [user("ownerA"), user("officerA"), user("ownerB")] });
  const now = new Date();
  await prisma.workspace.createMany({
    data: [
      { id: "a", name: "Org A", slug: "a", createdAt: now },
      { id: "b", name: "Org B", slug: "b", createdAt: now },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { id: "m-ownerA", workspaceId: "a", userId: "ownerA", role: "owner", createdAt: now },
      { id: "m-officerA", workspaceId: "a", userId: "officerA", role: "member", createdAt: now },
      { id: "m-ownerB", workspaceId: "b", userId: "ownerB", role: "owner", createdAt: now },
    ],
  });
  await markToursDone([
    { userId: "ownerA", workspaceId: "a", role: "owner" },
    { userId: "officerA", workspaceId: "a", role: "member" },
    { userId: "ownerB", workspaceId: "b", role: "owner" },
  ]);
}

// Test people have taken the onboarding tours, so nothing is gated on them. Each row is written
// as its own person (row-level security allows nobody else). tests/onboarding.test.ts clears them.
async function markToursDone(members: { userId: string; workspaceId: string; role: "owner" | "member" }[]) {
  const now = new Date();
  for (const { userId, workspaceId, role } of members) {
    await withTenant({ userId, workspaceId }, (tx) =>
      tx.onboardingProgress.create({ data: { workspaceId, userId, basicsStep: 8, basicsDoneAt: now, basicsRole: role, aiStep: 7, aiDoneAt: now } }),
    );
  }
}

// A pending invitation into workspace "a", sent by its owner.
export async function invite(fields: { id: string; email: string; role?: string; expiresAt?: Date; status?: string }) {
  await prisma.invitation.create({
    data: {
      workspaceId: "a",
      inviterId: "ownerA",
      role: "member",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...fields,
    },
  });
}

export const roleOf = async (membershipId: string) =>
  (await prisma.membership.findUnique({ where: { id: membershipId }, select: { role: true } }))?.role;

export const ownerCount = (workspaceId: string) =>
  prisma.membership.count({ where: { workspaceId, role: "owner" } });
