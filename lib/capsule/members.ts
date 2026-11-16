import { releaseClaimsOf } from "@/lib/claims";
import { dbNow } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import type { Membership } from "@/lib/authz";
import { fail, isOwner, OWNER_ONLY, type Done } from "./shared";

// Step 2a: who is leaving. An owner ticks the members who will not be on next year's board
// (Membership.departingAt). Ticking changes nothing else. "Release their claims" gives back every
// company a departing person holds, through the existing releaseClaimsOf (lib/claims.ts), and says
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
export async function setDeparting(actor: Membership, userId: string, departing: boolean): Promise<Done> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const now = departing ? await dbNow() : null;
  return withTenant(actor, async (tx) => {
    const { count } = await tx.membership.updateMany({ where: { workspaceId: actor.workspaceId, userId }, data: { departingAt: now } });
    return count === 1 ? { ok: true, data: undefined } : fail("That person isn't a member of this workspace.");
  });
}

export type ReleasedClaims = { released: number; people: { userId: string; name: string; released: number }[] };

// Releases the claims of every member marked as departing. Returns the total and each person's
// count (a person who held nothing is listed with 0).
export async function releaseDepartingClaims(actor: Membership): Promise<Done<ReleasedClaims>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const leaving = await withTenant(actor, (tx) =>
    tx.membership.findMany({
      where: { workspaceId: actor.workspaceId, departingAt: { not: null } },
      select: { userId: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    }),
  );
  if (leaving.length === 0) return fail("Tick the members who are leaving first.");
  const people: ReleasedClaims["people"] = [];
  for (const m of leaving) people.push({ userId: m.userId, name: m.user.name, released: await releaseClaimsOf(actor, m.userId) });
  return { ok: true, data: { released: people.reduce((sum, p) => sum + p.released, 0), people } };
}
