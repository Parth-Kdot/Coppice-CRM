import { dbNow, releaseMarkedClaims, type ReleasedCompany } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import type { Membership } from "@/lib/authz";
import { fail, isOwner, OWNER_ONLY, type Done } from "./shared";

// Step 2a: who is leaving. An owner ticks the members who will not be on next year's board
// (Membership.departingAt). Ticking changes nothing else. "Release their claims" gives back every
// company a departing person holds, in one transaction (releaseMarkedClaims in lib/claims.ts), and says
// how many. Nobody is removed here: removing a member stays in Settings.

export type HandoffMember = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "member";
  departingAt: string | null;
  // Companies whose claim this person holds (released by "Release their claims").
  claims: number;
};

export async function listMembers(actor: Membership): Promise<Done<HandoffMember[]>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const rows = await withTenant(actor, async (tx) => {
    const members = await tx.membership.findMany({
      where: { workspaceId: actor.workspaceId },
      select: { userId: true, role: true, departingAt: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    });
    const held = await tx.company.groupBy({ by: ["claimedById"], where: { workspaceId: actor.workspaceId, claimedBy: { isNot: null } }, _count: { _all: true } });
    return { members, held };
  });
  const claims = new Map(rows.held.map((h) => [h.claimedById, h._count._all]));
  return {
    ok: true,
    data: rows.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role === "owner" ? "owner" : "member",
      departingAt: m.departingAt?.toISOString() ?? null,
      claims: claims.get(m.userId) ?? 0,
    })),
  };
}

// Marks a member as departing, or clears the mark. The person must be a member of this workspace.
// The write decides: one UPDATE that only matches while the mark is in the other state, so of any
// number of identical calls at the same moment exactly one changes the row and says changed true.
// The others change nothing, say changed false, and the first time stays.
export async function setDeparting(actor: Membership, userId: string, departing: boolean): Promise<Done<{ changed: boolean }>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const now = departing ? await dbNow() : null;
  return withTenant(actor, async (tx) => {
    const { count } = await tx.membership.updateMany({
      where: { workspaceId: actor.workspaceId, userId, departingAt: departing ? null : { not: null } },
      data: { departingAt: now },
    });
    if (count === 1) return { ok: true, data: { changed: true } };
    const exists = await tx.membership.count({ where: { workspaceId: actor.workspaceId, userId } });
    return exists > 0 ? { ok: true, data: { changed: false } } : fail("That person isn't a member of this workspace.");
  });
}

// What a release would do right now: how many members are marked, how many companies they hold
// (the same set the release clears), whether the caller is one of them and whether every member of
// the workspace is marked. Read only. The assistant's confirm question quotes it.
export type DepartingSummary = { marked: number; companies: number; callerMarked: boolean; everyoneMarked: boolean };

export async function departingSummary(actor: Membership): Promise<Done<DepartingSummary>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const { members, held } = await withTenant(actor, async (tx) => ({
    members: await tx.membership.findMany({ where: { workspaceId: actor.workspaceId }, select: { userId: true, departingAt: true } }),
    held: await tx.company.groupBy({ by: ["claimedById"], where: { workspaceId: actor.workspaceId, claimedBy: { isNot: null } }, _count: { _all: true } }),
  }));
  const marked = members.filter((m) => m.departingAt !== null);
  const markedIds = new Set(marked.map((m) => m.userId));
  return {
    ok: true,
    data: {
      marked: marked.length,
      companies: held.reduce((sum, h) => sum + (h.claimedById !== null && markedIds.has(h.claimedById) ? h._count._all : 0), 0),
      callerMarked: markedIds.has(actor.userId),
      everyoneMarked: members.length > 0 && marked.length === members.length,
    },
  };
}

export type ReleasedClaims = {
  released: number;
  people: { userId: string; name: string; released: number }[];
  // Each company given back and who held it, so an owner can see what to reclaim or reassign.
  companies: { id: string; name: string; previousHolderId: string }[];
};

// Releases the claims of every member marked as leaving, in one transaction (see
// releaseMarkedClaims). Returns the total, each person's count (a person who held nothing is listed
// with 0) and the companies that were given back.
// With refuseWhenEveryone the check that every member is marked is made inside the release
// transaction (the assistant passes it, the app does not).
export const EVERYONE_MARKED =
  "Every member of this workspace is marked as leaving, so this would free every claim. Do this in the app, where you can see who is marked.";
export const NONE_MARKED = "Tick the members who are leaving first.";
export async function releaseDepartingClaims(actor: Membership, options: { refuseWhenEveryone?: boolean } = {}): Promise<Done<ReleasedClaims>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const { marked, released, everyone } = await releaseMarkedClaims(actor, options);
  if (everyone) return fail(EVERYONE_MARKED);
  if (marked.length === 0) return fail(NONE_MARKED);
  const count = (userId: string, list: ReleasedCompany[]) => list.filter((c) => c.previousHolderId === userId).length;
  return {
    ok: true,
    data: {
      released: released.length,
      people: marked.map((m) => ({ userId: m.userId, name: m.name, released: count(m.userId, released) })),
      companies: released.map((c) => ({ id: c.companyId, name: c.name, previousHolderId: c.previousHolderId })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    },
  };
}
