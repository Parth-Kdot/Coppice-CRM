import { z } from "zod";

// Every server action parses its input with one of these before touching the database.

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
});

export const inviteMemberSchema = z.object({
  workspaceId: z.string().min(1),
  // Trim and lowercase first, then check the format, so " Sam@Purdue.edu " is accepted.
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(["member", "owner"]),
});

export const invitationIdSchema = z.string().min(1);

// Shape every server action returns (project convention).
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
