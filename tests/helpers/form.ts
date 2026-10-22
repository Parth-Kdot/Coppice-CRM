import { expect } from "vitest";

// Builds the FormData a browser form would send.
export function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

// redirect() and notFound() work by throwing an error whose digest says where to go.
export const redirectTo = (path: string) =>
  expect.objectContaining({ digest: expect.stringContaining(`;${path};`) });
export const notFoundError = expect.objectContaining({ digest: expect.stringContaining("404") });
