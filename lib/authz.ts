import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeNextPath } from "@/lib/validation";

// Better Auth's built-in role names. The UI shows "member" as Officer.
export type Role = "owner" | "member";

export type Membership = { userId: string; workspaceId: string; role: Role };

// Thrown when someone is signed in but not allowed. Server actions catch it and
// return { ok: false, error } instead of showing an error page.
export class AuthzError extends Error {}

export function roleLabel(role: Role): string {
  return role === "owner" ? "Owner" : "Officer";
}

// The request header that carries the page's own path and query (set by proxy.ts), so a signed-out
// visitor can be sent back to it after signing in. Only ever used through safeNextPath.
export const REQUEST_PATH_HEADER = "x-coppice-path";

// The signed-in user, or a redirect to /signin. For pages and actions that need a session.
// A page that was asked for while signed out is passed along as ?next= (a path on this site only),
// so a shared company link opens that company after Google, not the workspace list.
//
// Cached per request (React cache): the layout, generateMetadata and the page each call this, and
// before it each one looked the session and user up again. A cache lives for one server render;
// server actions and route handlers are not inside one, so they always read afresh.
export const requireUser = cache(async () => {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    const next = safeNextPath(requestHeaders.get(REQUEST_PATH_HEADER));
    redirect(next && next !== "/workspaces" ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  }
  return session.user;
});

// The checks themselves take a userId so tests can call them without a browser session.
// Cached per request by (userId, workspaceId), for the same reason as requireUser. Membership is
// still read once in every request, so someone removed from a workspace loses it on their next click.
export const checkMembership = cache(async (userId: string, workspaceId: string): Promise<Membership> => {
  const row = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  // Same error whether the workspace doesn't exist or you aren't in it, so ids can't be probed.
  if (!row) throw new AuthzError("You are not a member of this workspace.");
  return { userId, workspaceId, role: row.role === "owner" ? "owner" : "member" };
});

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

// For pages: not a member shows the same 404 as a workspace that doesn't exist,
// so workspace ids can't be probed.
export async function requireMembershipOr404(workspaceId: string): Promise<Membership> {
  try {
    return await requireMembership(workspaceId);
  } catch (e) {
    if (e instanceof AuthzError) notFound();
    throw e;
  }
}
