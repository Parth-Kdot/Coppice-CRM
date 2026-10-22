import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Better Auth's built-in role names. The UI shows "member" as Officer.
export type Role = "owner" | "member";

export type Membership = { userId: string; workspaceId: string; role: Role };

// Thrown when someone is signed in but not allowed. Server actions catch it and
// return { ok: false, error } instead of showing an error page.
export class AuthzError extends Error {}

export function roleLabel(role: Role): string {
  return role === "owner" ? "Owner" : "Officer";
}

// The signed-in user, or a redirect to /signin. For pages and actions that need a session.
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/signin");
  return session.user;
}

// The checks themselves take a userId so tests can call them without a browser session.
export async function checkMembership(userId: string, workspaceId: string): Promise<Membership> {
  const row = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  // Same error whether the workspace doesn't exist or you aren't in it, so ids can't be probed.
  if (!row) throw new AuthzError("You are not a member of this workspace.");
  return { userId, workspaceId, role: row.role === "owner" ? "owner" : "member" };
}

export async function checkOwner(userId: string, workspaceId: string): Promise<Membership> {
  const membership = await checkMembership(userId, workspaceId);
  if (membership.role !== "owner") throw new AuthzError("Only the workspace owner can do that.");
  return membership;
}

// Project rule 1: every server action starts with one of these two.
export async function requireMembership(workspaceId: string): Promise<Membership> {
  const user = await requireUser();
  return checkMembership(user.id, workspaceId);
}

export async function requireOwner(workspaceId: string): Promise<Membership> {
  const user = await requireUser();
  return checkOwner(user.id, workspaceId);
}
