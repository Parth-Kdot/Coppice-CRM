import { z } from "zod";

// Every server action parses its input with one of these before touching the database.

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
});

const id = z.string().min(1);
const role = z.enum(["member", "owner"]);

export const CLAIM_WINDOW_MIN_DAYS = 1;
export const CLAIM_WINDOW_MAX_DAYS = 60;

export const inviteMemberSchema = z.object({
  workspaceId: id,
  // Trim and lowercase first, then check the format, so " Sam@Purdue.edu " is accepted.
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role,
});

export const invitationIdSchema = id;

export const workspaceIdSchema = id;

export const cancelInvitationSchema = z.object({ workspaceId: id, invitationId: id });

export const memberSchema = z.object({ workspaceId: id, memberId: id });

export const changeRoleSchema = memberSchema.extend({ role });

export const claimWindowSchema = z.object({
  workspaceId: id,
  days: z.coerce
    .number()
    .int("Use whole days.")
    .min(CLAIM_WINDOW_MIN_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`)
    .max(CLAIM_WINDOW_MAX_DAYS, `Use ${CLAIM_WINDOW_MIN_DAYS} to ${CLAIM_WINDOW_MAX_DAYS} days.`),
});

// Shape every server action returns (project convention).
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
