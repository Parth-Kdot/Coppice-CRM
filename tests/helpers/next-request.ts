import { AsyncLocalStorage } from "node:async_hooks";
import { signedInHeaders } from "./session";

// Stand-in for next/headers, which only works inside a real Next.js request. Test files use it
// with: vi.mock("next/headers", () => import("./helpers/next-request")).
//
// Each call made inside asUser() sees that user's session cookie. AsyncLocalStorage keeps
// the user per call (Next.js uses the same mechanism), so two users can run actions at the
// same moment in a race test without seeing each other's identity.
const request = new AsyncLocalStorage<Headers>();

export async function headers(): Promise<Headers> {
  return request.getStore() ?? new Headers();
}

// Better Auth's nextCookies plugin writes cookies after sign-in changes; tests don't need them.
export async function cookies() {
  return { get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} };
}

export async function asUser<T>(userId: string, run: () => Promise<T>): Promise<T> {
  return request.run(await signedInHeaders(userId), run);
}

export function signedOut<T>(run: () => Promise<T>): Promise<T> {
  return request.run(new Headers(), run);
}
