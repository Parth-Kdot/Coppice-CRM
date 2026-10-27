import { claimStateOf } from "./rules";
import { formatWhen } from "./dates";
import type { ActionResult, Company, DemoState, Member, Role, Workspace } from "./types";

// Shared plumbing for the engine. Every command is a pure function from the current state to a
// Step: the next state plus the result the screen gets back. A refused command returns the state it
// was given, so nothing changes when it fails.

export type Step<T = undefined> = { state: DemoState; result: ActionResult<T> };

export const done = <T>(state: DemoState, data: T): Step<T> => ({ state, result: { ok: true, data } });
export const refuse = (state: DemoState, error: string): Step<never> => ({ state, result: { ok: false, error } });

export const NOT_A_MEMBER = "You are not a member of this workspace.";
export const OWNERS_ONLY = "Only the workspace owner can do that.";
export const COMPANY_NOT_FOUND = "Company not found.";
export const LAST_OWNER = "A workspace must keep at least one owner.";

// Ids are made from a counter in the state, so they are the same on every run.
export function nextId(state: DemoState, prefix: string): { state: DemoState; id: string } {
  const seq = state.seq + 1;
  return { state: { ...state, seq }, id: `${prefix}-${seq}` };
}

export const workspaceOf = (state: DemoState, ws: string): Workspace | undefined => state.workspaces.find((w) => w.id === ws);

// The signed-in person's membership in a workspace, or undefined.
export const membershipOf = (state: DemoState, ws: string): Member | undefined =>
  state.members.find((m) => m.workspaceId === ws && m.userId === state.meId);

export const roleOf = (state: DemoState, ws: string): Role | null => membershipOf(state, ws)?.role ?? null;

export const companyOf = (state: DemoState, ws: string, companyId: string): Company | undefined =>
  state.companies.find((c) => c.workspaceId === ws && c.id === companyId);

export const personName = (state: DemoState, userId: string | null): string =>
  (userId && state.people.find((p) => p.id === userId)?.name) || "a former member";

export const mapCompany = (state: DemoState, companyId: string, change: (c: Company) => Company): DemoState => ({
  ...state,
  companies: state.companies.map((c) => (c.id === companyId ? change(c) : c)),
});

// Every command starts with one of these two, like requireMembership and requireOwner.
export function asMember(state: DemoState, ws: string): { ok: true; member: Member; workspace: Workspace } | { ok: false; step: Step<never> } {
  const member = membershipOf(state, ws);
  const workspace = workspaceOf(state, ws);
  if (!member || !workspace) return { ok: false, step: refuse(state, NOT_A_MEMBER) };
  return { ok: true, member, workspace };
}

export function asOwner(state: DemoState, ws: string): { ok: true; member: Member; workspace: Workspace } | { ok: false; step: Step<never> } {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked;
  if (checked.member.role !== "owner") return { ok: false, step: refuse(state, OWNERS_ONLY) };
  return checked;
}

export const liveClaimByOther = (state: DemoState, company: Company): boolean =>
  claimStateOf(company, state.now, state.meId) === "theirs";

// "Sam Lee holds this company until Nov 11, 2026, 3:00 PM. Ask them, or an owner."
export const heldMessage = (state: DemoState, company: Company): string =>
  `${personName(state, company.claimedById)} holds this company until ${formatWhen(company.claimExpiresAt as string)}. Ask them, or an owner.`;

export const sortByDate = <T>(items: T[], date: (item: T) => string, direction: "asc" | "desc" = "asc"): T[] =>
  [...items].sort((a, b) => (direction === "asc" ? 1 : -1) * (Date.parse(date(a)) - Date.parse(date(b))));
