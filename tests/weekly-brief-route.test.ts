import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/workspaces/[workspaceId]/weekly-brief/route";
import { prisma, withTenant } from "@/lib/db";
import { fakeGemini } from "./helpers/gemini";
import { groqAnswer } from "./helpers/groq";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";
import { aiOn, seedWeeklyFixture, WEEKLY_GOOD_REPLY } from "./helpers/weekly-brief";

vi.mock("next/headers", () => import("./helpers/next-request"));

// The route the queue home's browser calls to write the Monday brief: members only, this site
// only, POST only, never cached.

const ORIGIN = "http://localhost:3000";
const request = (workspaceId: string, headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" }) =>
  new Request(`${ORIGIN}/api/workspaces/${workspaceId}/weekly-brief`, { method: "POST", headers });
const ctx = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
const post = (userId: string, workspaceId: string, headers?: Record<string, string>) => asUser(userId, () => POST(request(workspaceId, headers), ctx(workspaceId)));
const briefRows = () => withTenant({ userId: "ownerA", workspaceId: "a" }, (tx) => tx.weeklyBrief.count());

beforeEach(async () => {
  await resetAndSeed();
  await seedWeeklyFixture();
  await aiOn();
  process.env.GROQ_API_KEY = "test-groq-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST", () => {
  it("writes the brief for a member and answers with its state, never cached", async () => {
    fakeGemini(groqAnswer(WEEKLY_GOOD_REPLY));
    const response = await post("officerA", "a");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.outcome).toBe("ready");
    expect(body.brief.state).toBe("ready");
    expect(body.brief.paragraphs.length).toBeGreaterThan(0);
  });

  it("answers 404 for a workspace the person isn't in, and writes nothing", async () => {
    fakeGemini();
    const response = await post("ownerB", "a");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await briefRows()).toBe(0);
  });

  it("answers 400 for a workspace id that isn't one", async () => {
    const response = await post("ownerA", "x".repeat(500));
    expect(response.status).toBe(400);
  });

  it.each([
    ["a cross-site Sec-Fetch-Site", { origin: ORIGIN, "sec-fetch-site": "cross-site" }],
    ["a foreign Origin", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }],
    ["no Origin", { "sec-fetch-site": "same-origin" }],
    ["a forwarded host that isn't the Origin's", { origin: "https://evil.example", "x-forwarded-host": "boilerpitch.vercel.app" }],
  ])("refuses %s with 403 and writes nothing", async (_, headers) => {
    fakeGemini();
    const response = await post("ownerA", "a", headers);
    expect(response.status).toBe(403);
    expect(await briefRows()).toBe(0);
  });

  it("accepts the site's own origin behind a proxy (the forwarded host)", async () => {
    fakeGemini(groqAnswer(WEEKLY_GOOD_REPLY));
    const response = await post("ownerA", "a", { origin: "https://boilerpitch.vercel.app", "x-forwarded-host": "boilerpitch.vercel.app", "sec-fetch-site": "same-origin" });
    expect(response.status).toBe(200);
  });

  it("sends a signed-out person to sign in", async () => {
    await expect(signedOut(() => POST(request("a"), ctx("a")))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await briefRows()).toBe(0);
  });

  it("answers off and no brief when AI is off", async () => {
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    fakeGemini();
    const body = await (await post("ownerA", "a")).json();
    expect(body).toEqual({ outcome: "off", brief: null });
  });
});

describe("GET", () => {
  it("is not allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
