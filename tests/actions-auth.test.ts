import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Project rule 1: every server action checks who you are before it touches anything.
// This reads each actions file (actions.ts, draft-actions.ts, ...) and checks that the first
// awaited call in every exported action is one of the auth checks. Validating form input before
// that is fine: it doesn't touch the database or the session.
const AUTH_CHECKS = ["requireUser", "requireMembership", "requireOwner"];

function exportedActions(source: string): { name: string; body: string }[] {
  const parts = source.split(/export async function /).slice(1);
  return parts.map((part) => ({ name: part.slice(0, part.indexOf("(")), body: part }));
}

describe("server actions", () => {
  const files = globSync("app/**/*actions.ts");

  it("finds the action files (so this test can't pass by checking nothing)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    for (const action of exportedActions(readFileSync(file, "utf8"))) {
      it(`${file}: ${action.name} starts with an auth check`, () => {
        const firstAwait = action.body.match(/await\s+([\w.]+)\(/)?.[1];
        expect(AUTH_CHECKS).toContain(firstAwait);
      });
    }
  }
});
