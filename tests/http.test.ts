import { organization } from "better-auth/plugins/organization";
import { afterAll, beforeEach, describe, expect, it, test } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";
import { signedInHeaders } from "./helpers/session";

// Real HTTP requests to /api/auth/*, as a browser would send them, through Better Auth's handler.
const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

async function request(path: string, method: "GET" | "POST", cookieHeaders: Headers) {
  const headers = new Headers(cookieHeaders);
  headers.set("origin", BASE);
  if (method === "POST") headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify({ organizationId: "a" }) : undefined,
    }),
  );
}

// Listed independently of lib/auth.ts, straight from the plugin, so the test can't just
// repeat the code's own list back to itself.
const workspaceEndpoints = Object.values(organization({}).endpoints)
  .filter((endpoint) => typeof endpoint.path === "string")
  // Each endpoint object carries its HTTP method at runtime, but Better Auth's types don't expose it.
  .map((endpoint) => {
    const { method } = endpoint as unknown as { method: string | string[] };
    return [endpoint.path as string, method === "GET" ? "GET" : "POST"] as const;
  });

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Better Auth's workspace endpoints are closed to the browser", () => {
  it("covers every endpoint the plugin has", () => {
    expect(workspaceEndpoints.length).toBeGreaterThanOrEqual(20);
    expect(workspaceEndpoints.map(([path]) => path)).toContain("/organization/list-members");
  });

  test.for(workspaceEndpoints)("%s returns 404 even to a signed-in owner", async ([path, method]) => {
    const response = await request(path, method, await signedInHeaders("ownerA"));
    expect(response.status).toBe(404);
  });

  it("so an officer can't read member emails through list-members", async () => {
    const response = await request("/organization/list-members?organizationId=a", "GET", await signedInHeaders("officerA"));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("@example.com");
  });
});

describe("the endpoints the browser does need still work", () => {
  it("get-session returns the signed-in user", async () => {
    const response = await request("/get-session", "GET", await signedInHeaders("officerA"));
    expect(response.status).toBe(200);
    expect((await response.json())?.user?.id).toBe("officerA");
  });

  it("ok responds", async () => {
    const response = await request("/ok", "GET", new Headers());
    expect(response.status).toBe(200);
  });
});
