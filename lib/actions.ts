import { APIError } from "better-auth";
import { AuthzError } from "@/lib/authz";

// Raised by the membership_keep_an_owner trigger (prisma/migrations/*_keep_an_owner). It only
// reaches here when two owner changes race; otherwise Better Auth refuses first.
export const LAST_OWNER_MESSAGE = "A workspace must keep at least one owner.";

// Turns an expected failure into the { ok: false, error } shape; anything unexpected is rethrown.
export function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthzError) return { ok: false, error: e.message };
  // Better Auth's messages say "organization"; the app calls it a workspace.
  if (e instanceof APIError) {
    return { ok: false, error: e.message.replace(/organization/g, "workspace").replace(/Organization/g, "Workspace") };
  }
  if (e instanceof Error && e.message.includes(LAST_OWNER_MESSAGE)) return { ok: false, error: LAST_OWNER_MESSAGE };
  throw e;
}
