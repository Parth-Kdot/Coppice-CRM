import { APIError } from "better-auth";
import { unstable_rethrow } from "next/navigation";
import { AuthzError } from "@/lib/authz";

// Raised by the membership_keep_an_owner trigger (prisma/migrations/*_keep_an_owner). It only
// reaches here when two owner changes race; otherwise Better Auth refuses first.
export const LAST_OWNER_MESSAGE = "A workspace must keep at least one owner.";

// What a person reads when the database was too busy to finish (a burst of requests on the pooler).
// Nothing was written: each of these fails its whole transaction.
export const BUSY_MESSAGE = "The server is busy and nothing was saved. Try again.";
// What a person reads when the database refused a value or a date couldn't be worked out: trying
// again fails the same way, so it doesn't say to.
export const SAVE_FAILED_MESSAGE = "Something went wrong and nothing was saved.";

// Prisma's codes for "too busy" failures: P2024 (no pooled connection free within the wait),
// P2028 (the interactive transaction timed out or was already closed), P2034 (a serialization
// failure or deadlock that withTenant's caller didn't retry).
const BUSY_PRISMA_CODES = new Set(["P2024", "P2028", "P2034"]);
// The same from Postgres itself, as the pg driver adapter (DriverAdapterError) carries it in
// `cause`: a serialization failure, a deadlock, too many connections, a statement timeout, a lock
// not available, or any connection failure (class 08).
const BUSY_POSTGRES_CODES = new Set(["40001", "40P01", "53300", "57014", "55P03"]);
const BUSY_ADAPTER_KINDS = new Set(["TransactionWriteConflict", "SocketTimeout", "DatabaseNotReachable", "TooManyConnections", "ConnectionClosed"]);

type Failure = "busy" | "failed" | null;

// Errors from the pg driver adapter carry the Postgres failure in `cause`. A load problem is
// "busy"; anything else from the adapter (a NUL byte, a number out of range) is "failed". Neither
// is the person's fault, and neither left anything written.
function classify(e: unknown): Failure {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const err = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (typeof err.code === "string" && BUSY_PRISMA_CODES.has(err.code)) return "busy";
    if (err.name === "DriverAdapterError") {
      const cause = (typeof err.cause === "object" && err.cause !== null ? err.cause : {}) as { kind?: unknown; code?: unknown; originalCode?: unknown };
      const raw = cause.code ?? cause.originalCode;
      const code = typeof raw === "string" ? raw : "";
      const busy = BUSY_POSTGRES_CODES.has(code) || code.startsWith("08") || (typeof cause.kind === "string" && BUSY_ADAPTER_KINDS.has(cause.kind));
      return busy ? "busy" : "failed";
    }
    current = err.cause;
  }
  return e instanceof RangeError ? "failed" : null;
}

// The trigger's message, on the error itself or on a cause the driver adapter wrapped it in.
function mentionsLastOwner(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const err = current as { message?: unknown; cause?: unknown };
    if (typeof err.message === "string" && err.message.includes(LAST_OWNER_MESSAGE)) return true;
    current = err.cause;
  }
  return false;
}

// Turns an expected failure into the { ok: false, error } shape; anything unexpected is rethrown.
// Next's own control flow (redirect(), notFound()) always passes straight through.
// `action` names the server action in the server log when the database was busy or refused a value.
export function failure(e: unknown, action = "server action"): { ok: false; error: string } {
  unstable_rethrow(e);
  if (e instanceof AuthzError) return { ok: false, error: e.message };
  // Better Auth's messages say "organization"; the app calls it a workspace.
  if (e instanceof APIError) {
    return { ok: false, error: e.message.replace(/organization/g, "workspace").replace(/Organization/g, "Workspace") };
  }
  if (mentionsLastOwner(e)) return { ok: false, error: LAST_OWNER_MESSAGE };
  const kind = classify(e);
  if (kind) {
    console.error(`[${action}] failed and nothing was saved:`, e);
    return { ok: false, error: kind === "busy" ? BUSY_MESSAGE : SAVE_FAILED_MESSAGE };
  }
  throw e;
}
