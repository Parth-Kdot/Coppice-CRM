import { prisma } from "@/lib/db";

// Two workspaces: "a" has an owner and an officer, "b" has its own owner.
// Wipes everything first; deleting workspaces and users cascades to memberships,
// invitations and sessions.
export async function resetAndSeed() {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  const user = (id: string) => ({ id, name: id, email: `${id}@example.com`, emailVerified: true });
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
}
