import { APIError } from "better-auth";
import { AuthzError } from "@/lib/authz";

// Turns an expected failure into the { ok: false, error } shape; anything unexpected is rethrown.
export function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof AuthzError || e instanceof APIError) return { ok: false, error: e.message };
  throw e;
}
