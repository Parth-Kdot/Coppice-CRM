import { addDaysToIso } from "./dates";
import { LAST_OWNER, NOT_A_MEMBER, asMember, asOwner, companyOf, done, mapCompany, membershipOf, nextId, refuse, type Step } from "./engine-core";
import { claimStateOf, domainKey, nameKey } from "./rules";
import { ROLES, isTerminalStage, type Company, type DemoState, type Invitation, type Member, type Role, type Workspace } from "./types";
import { checkAiLimit, checkClaimWindow, checkInviteEmail, checkWorkspaceName } from "./validation";

// Workspaces, members, invitations and settings: the rules of the workspace list and Settings
// screens, plus the demo-only switches reviewers use to reach every state. The messages are the real
// app's (Better Auth's wording with "organization" shown as "workspace").

export const INVITATION_DAYS = 7;

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

// ----- Signing in and workspaces -----

// The prototype's sign-in is a button: nothing is checked and nothing enforces it.
export const signIn = (state: DemoState): DemoState => ({ ...state, signedIn: true });
export const signOut = (state: DemoState): DemoState => ({ ...state, signedIn: false });

// Only people on the allowed-emails list may create a workspace. The creator becomes its owner.
export function createWorkspace(state: DemoState, name: string): Step<{ workspaceId: string }> {
  const checked = checkWorkspaceName(name);
  if (!checked.ok) return refuse(state, checked.error);
  if (!state.canCreateWorkspace) return refuse(state, "You are not allowed to create a new workspace");
  const withId = nextId(state, "ws");
  const workspace: Workspace = {
    id: withId.id,
    name: checked.data,
    kind: "student-org",
    school: "Purdue University",
    tagline: "",
    claimWindowDays: 14,
    aiEnabled: false,
    aiMonthlyLimit: 300,
    aiCallsUsed: 0,
    createdAt: state.now,
  };
  const member: Member = { id: `m-${workspace.id}-${state.meId}`, workspaceId: workspace.id, userId: state.meId, role: "owner", joinedAt: state.now };
  return done(
    { ...withId.state, workspaces: [...withId.state.workspaces, workspace], members: [...withId.state.members, member] },
    { workspaceId: workspace.id },
  );
}

// Pressing Join on an invitation addressed to you. A second press, after you already joined, just
// takes you there.
export function acceptInvitation(state: DemoState, invitationId: string): Step<{ workspaceId: string }> {
  const invite = state.invitationsForMe.find((i) => i.id === invitationId);
  if (!invite) return refuse(state, "Invitation not found.");
  const already = state.members.some((m) => m.workspaceId === invite.workspaceId && m.userId === state.meId);
  const member: Member = { id: `m-${invite.workspaceId}-${state.meId}`, workspaceId: invite.workspaceId, userId: state.meId, role: invite.role, joinedAt: state.now };
  return done(
    {
      ...state,
      invitationsForMe: state.invitationsForMe.filter((i) => i.id !== invitationId),
      members: already ? state.members : [...state.members, member],
    },
    { workspaceId: invite.workspaceId },
  );
}

// ----- Invitations -----

// A token that looks random but is the same on every run, built from the counter.
const tokenFor = (seq: number): string => {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = seq * 2654435761;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + seq * (i + 3);
  }
  return out;
};

export const inviteLink = (token: string): string => `https://coppice.example/join/${token}`;

// Owner only. No email is sent: the invitee signs in with this email and presses Join, or opens the
// copyable link. Inviting the same email again replaces the earlier pending invitation.
export function inviteMember(state: DemoState, ws: string, email: string, role: string): Step<{ invitationId: string; link: string }> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const checked = checkInviteEmail(email);
  if (!checked.ok) return refuse(state, checked.error);
  if (!isRole(role)) return refuse(state, "Pick a role.");
  const memberIds = new Set(state.members.filter((m) => m.workspaceId === ws).map((m) => m.userId));
  if (state.people.some((p) => memberIds.has(p.id) && p.email.toLowerCase() === checked.data)) {
    return refuse(state, "User is already a member of this workspace");
  }
  const withId = nextId(state, "inv");
  const link = inviteLink(tokenFor(withId.state.seq));
  const invitation: Invitation = {
    id: withId.id,
    workspaceId: ws,
    email: checked.data,
    role,
    createdAt: state.now,
    expiresAt: addDaysToIso(state.now, INVITATION_DAYS),
    inviterId: state.meId,
    link,
  };
  const kept = withId.state.invitations.filter((i) => !(i.workspaceId === ws && i.email === checked.data));
  return done({ ...withId.state, invitations: [...kept, invitation] }, { invitationId: invitation.id, link });
}

export function cancelInvitation(state: DemoState, ws: string, invitationId: string): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  if (!state.invitations.some((i) => i.id === invitationId && i.workspaceId === ws)) return refuse(state, "Invitation not found.");
  return done({ ...state, invitations: state.invitations.filter((i) => i.id !== invitationId) }, undefined);
}

// The link for an invitation, for the "Copy link" button. The store does the copying.
export function invitationLink(state: DemoState, ws: string, invitationId: string): Step<{ link: string }> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const invite = state.invitations.find((i) => i.id === invitationId && i.workspaceId === ws);
  return invite ? done(state, { link: invite.link }) : refuse(state, "Invitation not found.");
}

// ----- Members -----

const ownerCount = (state: DemoState, ws: string): number => state.members.filter((m) => m.workspaceId === ws && m.role === "owner").length;

const releaseClaimsOf = (state: DemoState, ws: string, userId: string): { state: DemoState; released: number } => {
  const held = state.companies.filter((c) => c.workspaceId === ws && c.claimedById === userId).length;
  return {
    released: held,
    state: {
      ...state,
      companies: state.companies.map((c) => (c.workspaceId === ws && c.claimedById === userId ? { ...c, claimedById: null, claimExpiresAt: null } : c)),
    },
  };
};

// Make Owner or Make Officer. The last owner cannot be made an officer.
export function changeMemberRole(state: DemoState, ws: string, memberId: string, role: string): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  if (!isRole(role)) return refuse(state, "Member not found.");
  const target = state.members.find((m) => m.id === memberId && m.workspaceId === ws);
  if (!target) return refuse(state, "Member not found.");
  if (target.role === "owner" && role !== "owner" && ownerCount(state, ws) <= 1) return refuse(state, LAST_OWNER);
  return done({ ...state, members: state.members.map((m) => (m.id === memberId ? { ...m, role } : m)) }, undefined);
}

// Hands the workspace to someone else: they become Owner and you become Officer, in one step. (The
// real app does it as Make Owner, then Make Officer.)
export function transferOwnership(state: DemoState, ws: string, memberId: string): Step<{ newOwnerId: string }> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const target = state.members.find((m) => m.id === memberId && m.workspaceId === ws);
  if (!target) return refuse(state, "Member not found.");
  if (target.userId === state.meId) return refuse(state, "Pick someone else to hand the workspace to.");
  return done(
    {
      ...state,
      members: state.members.map((m) => {
        if (m.id === target.id) return { ...m, role: "owner" as const };
        if (m.id === owner.member.id) return { ...m, role: "member" as const };
        return m;
      }),
    },
    { newOwnerId: target.userId },
  );
}

// Owner only. Removing someone also releases their claims, so their companies do not stay locked
// until the claims expire. Returns how many were released.
export function removeMember(state: DemoState, ws: string, memberId: string): Step<{ released: number }> {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const target = state.members.find((m) => m.id === memberId && m.workspaceId === ws);
  if (!target) return refuse(state, "Member not found.");
  if (target.userId === state.meId) return refuse(state, "You can't remove yourself. Use Leave workspace.");
  const released = releaseClaimsOf(state, ws, target.userId);
  return done({ ...released.state, members: released.state.members.filter((m) => m.id !== memberId) }, { released: released.released });
}

// Any member can leave, unless they are the last owner. Their claims are released first.
export function leaveWorkspace(state: DemoState, ws: string): Step<{ released: number }> {
  const me = membershipOf(state, ws);
  if (!me) return refuse(state, NOT_A_MEMBER);
  if (me.role === "owner" && ownerCount(state, ws) <= 1) return refuse(state, LAST_OWNER);
  const released = releaseClaimsOf(state, ws, state.meId);
  return done({ ...released.state, members: released.state.members.filter((m) => m.id !== me.id) }, { released: released.released });
}

// ----- Settings -----

// Owner only. Claims already taken keep the expiry they were given.
export function updateClaimWindow(state: DemoState, ws: string, days: number): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const checked = checkClaimWindow(days);
  if (!checked.ok) return refuse(state, checked.error);
  return done({ ...state, workspaces: state.workspaces.map((w) => (w.id === ws ? { ...w, claimWindowDays: checked.data } : w)) }, undefined);
}

// Owner only: the switch, and the limit on AI calls per 30 days. A limit of 0 pauses AI without
// switching it off.
export function updateAiSettings(state: DemoState, ws: string, settings: { enabled: boolean; limit: number }): Step {
  const owner = asOwner(state, ws);
  if (!owner.ok) return owner.step;
  const checked = checkAiLimit(settings.limit);
  if (!checked.ok) return refuse(state, checked.error);
  return done(
    { ...state, workspaces: state.workspaces.map((w) => (w.id === ws ? { ...w, aiEnabled: settings.enabled, aiMonthlyLimit: checked.data } : w)) },
    undefined,
  );
}

// ----- Demo-only switches for reviewers. The real app has nothing like these. -----

// Switches the signed-in person between Owner and Officer, in one workspace or in all of them. The
// seed data keeps a second owner in every workspace the person could switch out of, so none is left
// without one.
export function setRole(state: DemoState, role: Role, ws?: string): DemoState {
  return {
    ...state,
    members: state.members.map((m) => (m.userId === state.meId && (ws === undefined || m.workspaceId === ws) ? { ...m, role } : m)),
  };
}

// Moves the clock forward, so claims run out and follow-ups come due without waiting.
export const advanceClock = (state: DemoState, days: number): DemoState => ({ ...state, now: addDaysToIso(state.now, days) });

export type DemoFlags = Partial<Pick<DemoState, "serverAiConfigured" | "canCreateWorkspace" | "aiFailNext">>;
export const setFlags = (state: DemoState, flags: DemoFlags): DemoState => ({ ...state, ...flags });

// Plays a teammate editing a company, so the "someone else changed this" conflict can be reached.
export function simulateTeammateEdit(state: DemoState, ws: string, companyId: string, field: "name" | "industry" | "website" | "notes", value: string): DemoState {
  const checked = asMember(state, ws);
  if (!checked.ok) return state;
  const apply = (c: Company): Company => {
    const changed: Company = { ...c, updatedAt: state.now };
    if (field === "name") return { ...changed, name: value || c.name, nameKey: nameKey(value || c.name) };
    if (field === "website") return { ...changed, website: value || null, domainKey: domainKey(value) };
    return { ...changed, [field]: value || null };
  };
  return { ...state, companies: state.companies.map((c) => (c.id === companyId && c.workspaceId === ws ? apply(c) : c)) };
}

// Plays a teammate pressing Claim first, so the "claimed this first" refusal can be reached: a screen
// calls this just before the person's own claim, which then fails with the real message. The
// earliest-joined teammate takes the company for the workspace's claim window.
export function simulateTeammateClaim(state: DemoState, ws: string, companyId: string): DemoState {
  const checked = asMember(state, ws);
  if (!checked.ok) return state;
  const company = companyOf(state, ws, companyId);
  if (!company || company.archivedAt || isTerminalStage(company.stage)) return state;
  if (claimStateOf(company, state.now, state.meId) !== "free" && claimStateOf(company, state.now, state.meId) !== "expired") return state;
  const teammate = state.members
    .filter((m) => m.workspaceId === ws && m.userId !== state.meId)
    .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
  if (!teammate) return state;
  return mapCompany(state, companyId, (c) => ({
    ...c,
    claimedById: teammate.userId,
    claimExpiresAt: addDaysToIso(state.now, checked.workspace.claimWindowDays),
    updatedAt: state.now,
  }));
}
