import { afterAll, beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { disconnectAssistant } from "@/app/(app)/[workspaceId]/settings/assistant-actions";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { appUrl } from "@/lib/mcp/config";
import { NOT_CONNECTED, accessLabel, disconnect, endGrantsWithoutConsent, listConnections, redirectLabel } from "@/lib/mcp/connections";
import { form, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { authorize, consent, deleteOAuthClients, exchangeCode, fromNewIp, mcpClient, mcpPost, pkce, refresh, registerClient, restoreFetch, routeAppFetches } from "./helpers/oauth";
import { resetAndSeed } from "./helpers/seed";
import { signedInHeaders } from "./helpers/session";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Settings > AI assistants > Your connected assistants: list and Disconnect (lib/mcp/connections.ts,
// app/(app)/[workspaceId]/settings/assistant-actions.ts), against the real database and the real
// Better Auth plugins. Every token comes from the plugins' own endpoints; nothing is forged.
// Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner).

const ALL = "openid offline_access coppice:read coppice:write";
const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const LEGACY = { "mcp-protocol-version": "2025-06-18" };

async function newClient(name = "Test Assistant") {
  const { status, body } = await registerClient({ client_name: name });
  if (status !== 201) throw new Error(`registration failed: ${JSON.stringify(body)}`);
  return body.client_id as string;
}

// One person allows one (already registered) client and gets its tokens, as an assistant would.
// A person who already allowed it goes straight back to the assistant with a code (no consent page).
async function connect(clientId: string, userId: string, scope = ALL) {
  const { verifier, challenge } = pkce();
  const { location, headers } = await authorize(clientId, userId, { scope, challenge });
  const back = location.pathname === "/oauth/consent" ? await consent(location, headers, true) : location;
  const code = back.searchParams.get("code");
  if (!code) throw new Error(`no code in ${back}`);
  const token = await exchangeCode(clientId, code, verifier);
  if (token.status !== 200) throw new Error(`token exchange failed: ${JSON.stringify(token.body)}`);
  return { clientId, accessToken: token.body.access_token, refreshToken: token.body.refresh_token };
}

// Every row of the plugin's grant tables for one person and client.
async function rows(userId: string, clientId: string) {
  const where = { userId, clientId };
  const [consents, accessTokens, refreshTokens] = await Promise.all([
    prisma.oauthConsent.count({ where }),
    prisma.oauthAccessToken.count({ where }),
    prisma.oauthRefreshToken.count({ where }),
  ]);
  return { consents, accessTokens, refreshTokens };
}

const works = async (accessToken: string) => (await mcpPost(listTools, accessToken, LEGACY)).status === 200;
async function expectRefused(accessToken: string) {
  const response = await mcpPost(listTools, accessToken, LEGACY);
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  expect(response.json.error.message).toMatch(/revoked/);
}

const action = (userId: string, fields: Record<string, string>) => asUser(userId, () => disconnectAssistant(null, form(fields)));

beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
});

beforeEach(async () => {
  await deleteOAuthClients();
  await prisma.mcpRateLimit.deleteMany();
  await prisma.workspace.updateMany({ data: { mcpEnabled: true } });
});

afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.$disconnect();
});

describe("listConnections", () => {
  it("lists the assistants this person allowed, with name, return address, access and dates", async () => {
    const reader = await newClient("Reader Bot");
    const writer = await newClient("Writer Bot");
    const before = new Date(Date.now() - 1000);
    await connect(reader, "ownerA", "openid coppice:read");
    await connect(writer, "ownerA");

    const list = await listConnections("ownerA");
    expect(list.map((c) => c.name).sort()).toEqual(["Reader Bot", "Writer Bot"]);
    const r = list.find((c) => c.clientId === reader)!;
    const w = list.find((c) => c.clientId === writer)!;
    expect(r).toMatchObject({ returnsTo: "an app on this computer", canWrite: false });
    expect(accessLabel(r)).toBe("Can read");
    expect(w.canWrite).toBe(true);
    expect(accessLabel(w)).toBe("Can read and make changes");
    expect(w.scopes).toEqual(expect.arrayContaining(["coppice:read", "coppice:write", "offline_access"]));
    expect(w.allowedAt.getTime()).toBeGreaterThan(before.getTime());
    // The writer got a refresh token, so its last token is known.
    expect(w.lastRenewedAt?.getTime()).toBeGreaterThan(before.getTime());
  });

  it("shows only this person's connections, never another person's", async () => {
    const shared = await newClient("Shared Bot");
    const theirs = await newClient("Their Bot");
    await connect(shared, "ownerA");
    await connect(shared, "officerA");
    await connect(theirs, "ownerB");

    expect((await listConnections("ownerA")).map((c) => c.clientId)).toEqual([shared]);
    expect((await listConnections("officerA")).map((c) => c.clientId)).toEqual([shared]);
    expect((await listConnections("ownerB")).map((c) => c.clientId)).toEqual([theirs]);
  });

  it("an assistant this person registered but never allowed is not listed", async () => {
    await newClient("Never Allowed");
    expect(await listConnections("ownerA")).toEqual([]);
  });

  it("shows a client-supplied name without control or formatting characters", async () => {
    const clientId = await newClient("Plain");
    await connect(clientId, "ownerA");
    // Registration refuses these characters; a row stored some other way is still cleaned on the way out.
    await prisma.oauthClient.update({ where: { clientId }, data: { name: "‮tob  ​evil\u0007 <b>x</b>" } });
    const [row] = await listConnections("ownerA");
    expect(row.name).toBe("tob evil <b>x</b>");
    await prisma.oauthClient.update({ where: { clientId }, data: { name: null } });
    expect((await listConnections("ownerA"))[0].name).toBe("An unnamed app");
  });
});

test.each([
  [["http://127.0.0.1:43123/callback"], "an app on this computer"],
  [["http://localhost:8080/cb"], "an app on this computer"],
  [["https://assistant.example.com/oauth/callback"], "assistant.example.com"],
  [["cursor://anysphere.cursor-retrieval/oauth/callback"], 'the app "cursor"'],
  [["not a url"], "an unknown address"],
  [[], "an unknown address"],
])("redirectLabel(%j) is %s", (uris, label) => {
  expect(redirectLabel(uris)).toBe(label);
});

describe("disconnect", () => {
  it("removes this person's consent and every access and refresh token for that client, and only those", async () => {
    const shared = await newClient("Shared Bot");
    const other = await newClient("Other Bot");
    const mine = await connect(shared, "ownerA");
    // A second sign-in of the same assistant, and a renewal: several token rows for one connection.
    await connect(shared, "ownerA");
    const renewed = await refresh(shared, mine.refreshToken);
    expect(renewed.status).toBe(200);
    const officers = await connect(shared, "officerA");
    const myOther = await connect(other, "ownerA");
    const ownerBs = await connect(shared, "ownerB");

    const before = await rows("ownerA", shared);
    expect(before.consents).toBeGreaterThan(0);
    expect(before.refreshTokens).toBeGreaterThan(1);
    const untouched = { officerA: await rows("officerA", shared), other: await rows("ownerA", other), ownerB: await rows("ownerB", shared) };

    const result = await disconnect("ownerA", shared);
    expect(result).toEqual({ ok: true, data: { consents: before.consents, accessTokens: before.accessTokens, refreshTokens: before.refreshTokens } });
    expect(await rows("ownerA", shared)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });
    // Everyone else's rows, and this person's other assistant, are exactly as they were.
    expect(await rows("officerA", shared)).toEqual(untouched.officerA);
    expect(await rows("ownerA", other)).toEqual(untouched.other);
    expect(await rows("ownerB", shared)).toEqual(untouched.ownerB);
    // The client itself stays registered: other people still use it.
    expect(await prisma.oauthClient.count({ where: { clientId: shared } })).toBe(1);

    expect(await works(officers.accessToken)).toBe(true);
    expect(await works(myOther.accessToken)).toBe(true);
    expect(await works(ownerBs.accessToken)).toBe(true);
    expect((await refresh(shared, officers.refreshToken)).status).toBe(200);
  });

  it("the old access token is refused on the very next MCP call", async () => {
    const clientId = await newClient();
    const { accessToken } = await connect(clientId, "ownerA");
    expect(await works(accessToken)).toBe(true);
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    await expectRefused(accessToken);
  });

  it("the old access token is refused by the official MCP client too", async () => {
    const clientId = await newClient();
    const { accessToken } = await connect(clientId, "ownerA");
    const client = await mcpClient(accessToken);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    await expect(client.listTools()).rejects.toThrow();
    await client.close();
  });

  it("a token without offline_access (no refresh token) is refused as well", async () => {
    const clientId = await newClient();
    const { accessToken, refreshToken } = await connect(clientId, "ownerA", "openid coppice:read");
    expect(refreshToken).toBeUndefined();
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    await expectRefused(accessToken);
  });

  it("refresh is refused afterwards, for the newest refresh token and older ones alike", async () => {
    const clientId = await newClient();
    const first = await connect(clientId, "ownerA");
    const rotated = await refresh(clientId, first.refreshToken);
    expect(rotated.status).toBe(200);
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    expect((await refresh(clientId, rotated.body.refresh_token)).status).toBe(400);
    expect((await refresh(clientId, first.refreshToken)).status).toBe(400);
    await expectRefused(rotated.body.access_token);
  });

  it("allowing it again afterwards starts a fresh connection that works", async () => {
    const clientId = await newClient();
    const old = await connect(clientId, "ownerA");
    await disconnect("ownerA", clientId);
    const again = await connect(clientId, "ownerA");
    expect(await works(again.accessToken)).toBe(true);
    // The old token stays dead: its own refresh token was deleted.
    expect((await refresh(clientId, old.refreshToken)).status).toBe(400);
  });

  it("disconnecting a client this person never allowed changes nothing and says so", async () => {
    const clientId = await newClient();
    const theirs = await connect(clientId, "officerA");
    const before = await rows("officerA", clientId);
    expect(await disconnect("ownerA", clientId)).toEqual({ ok: false, error: NOT_CONNECTED });
    expect(await disconnect("ownerA", "no-such-client")).toEqual({ ok: false, error: NOT_CONNECTED });
    expect(await rows("officerA", clientId)).toEqual(before);
    expect(await works(theirs.accessToken)).toBe(true);
  });

  it("a second disconnect of the same assistant is refused as already done", async () => {
    const clientId = await newClient();
    await connect(clientId, "ownerA");
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    expect(await disconnect("ownerA", clientId)).toEqual({ ok: false, error: NOT_CONNECTED });
  });
});

// Recorded with the official MCP client: after Better Auth's own
// POST /oauth2/delete-consent the access token was refused, but the token endpoint went on issuing
// and rotating tokens for the revoked grant, and the client failed with "Server returned 401 after
// re-authentication" instead of sending the person back to sign in.
describe("a consent removed some other way than Disconnect", () => {
  async function deleteConsentOverHttp(userId: string, clientId: string) {
    const consent = await prisma.oauthConsent.findFirstOrThrow({ where: { userId, clientId }, select: { id: true } });
    const headers = await signedInHeaders(userId);
    const response = await auth.handler(
      new Request(new URL("/api/auth/oauth2/delete-consent", appUrl()), {
        method: "POST",
        headers: { ...Object.fromEntries(headers), "content-type": "application/json", ...fromNewIp() },
        body: JSON.stringify({ id: consent.id }),
      }),
    );
    return response.status;
  }

  it("Better Auth's delete-consent also ends that client's tokens, so a refresh gets invalid_grant", async () => {
    const clientId = await newClient();
    const first = await connect(clientId, "ownerA");
    const rotated = await refresh(clientId, first.refreshToken);
    expect(rotated.status).toBe(200);
    const officers = await connect(clientId, "officerA");
    const before = await rows("officerA", clientId);

    expect(await deleteConsentOverHttp("ownerA", clientId)).toBe(200);
    expect(await rows("ownerA", clientId)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });
    const refused = await refresh(clientId, rotated.body.refresh_token);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_grant");
    await expectRefused(rotated.body.access_token);
    // Another person's connection to the same assistant is untouched.
    expect(await rows("officerA", clientId)).toEqual(before);
    expect(await works(officers.accessToken)).toBe(true);
  });

  it("a consent gone from the database is caught by the grant check, which ends the leftover tokens too", async () => {
    const clientId = await newClient();
    const { accessToken, refreshToken } = await connect(clientId, "ownerA");
    // Removed without any hook (a direct delete), the way the real client run left it.
    await prisma.oauthConsent.deleteMany({ where: { userId: "ownerA", clientId } });
    expect((await rows("ownerA", clientId)).refreshTokens).toBeGreaterThan(0);
    await expectRefused(accessToken);
    expect(await rows("ownerA", clientId)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });
    expect((await refresh(clientId, refreshToken)).body.error).toBe("invalid_grant");
  });

  it("a refused token says invalid_token in its challenge, so the assistant signs in again cleanly", async () => {
    const clientId = await newClient();
    const { accessToken } = await connect(clientId, "ownerA");
    expect((await disconnect("ownerA", clientId)).ok).toBe(true);
    const response = await mcpPost(listTools, accessToken, LEGACY);
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer error="invalid_token", error_description="This connection to Coppice was revoked\. Connect your assistant again\.", /);
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).toContain('scope="coppice:read coppice:write"');
  });

  it("connecting again afterwards works, and the tokens from before stay dead", async () => {
    const clientId = await newClient();
    const old = await connect(clientId, "ownerA");
    expect(await deleteConsentOverHttp("ownerA", clientId)).toBe(200);
    const again = await connect(clientId, "ownerA");
    expect(await works(again.accessToken)).toBe(true);
    expect((await refresh(clientId, old.refreshToken)).status).toBe(400);
    expect((await refresh(clientId, again.refreshToken)).status).toBe(200);
  });

  it("endGrantsWithoutConsent never touches a client the person still allows", async () => {
    const kept = await newClient("Kept");
    const { accessToken } = await connect(kept, "ownerA");
    const before = await rows("ownerA", kept);
    expect(await endGrantsWithoutConsent("ownerA")).toEqual({ accessTokens: 0, refreshTokens: 0 });
    expect(await rows("ownerA", kept)).toEqual(before);
    expect(await works(accessToken)).toBe(true);
  });
});

describe("disconnectAssistant (the Settings action)", () => {
  it("disconnects the signed-in person's own assistant", async () => {
    const clientId = await newClient();
    const { accessToken } = await connect(clientId, "officerA");
    expect(await action("officerA", { workspaceId: "a", clientId })).toEqual({ ok: true, data: undefined });
    expect(await rows("officerA", clientId)).toEqual({ consents: 0, accessTokens: 0, refreshTokens: 0 });
    await expectRefused(accessToken);
  });

  it("an owner can't disconnect a member's assistant: only the person's own rows are ever touched", async () => {
    const clientId = await newClient();
    const officers = await connect(clientId, "officerA");
    const before = await rows("officerA", clientId);
    expect(await action("ownerA", { workspaceId: "a", clientId })).toEqual({ ok: false, error: NOT_CONNECTED });
    expect(await rows("officerA", clientId)).toEqual(before);
    expect(await works(officers.accessToken)).toBe(true);
  });

  it("is refused from a workspace the person isn't in, and touches nothing", async () => {
    const clientId = await newClient();
    const owners = await connect(clientId, "ownerB");
    const before = await rows("ownerB", clientId);
    // ownerB names workspace a (not theirs): refused before anything is read.
    expect(await action("ownerB", { workspaceId: "a", clientId })).toEqual({ ok: false, error: "You are not a member of this workspace." });
    expect(await rows("ownerB", clientId)).toEqual(before);
    expect(await works(owners.accessToken)).toBe(true);
  });

  it("cross-workspace: one person's disconnect in workspace b leaves workspace a's members connected to the same assistant", async () => {
    const clientId = await newClient("Shared Bot");
    const a = await connect(clientId, "ownerA");
    const b = await connect(clientId, "ownerB");
    expect(await action("ownerB", { workspaceId: "b", clientId })).toEqual({ ok: true, data: undefined });
    await expectRefused(b.accessToken);
    expect(await works(a.accessToken)).toBe(true);
    expect((await refresh(clientId, a.refreshToken)).status).toBe(200);
    expect((await listConnections("ownerA")).map((c) => c.clientId)).toEqual([clientId]);
  });

  it("a connection is the person's, so disconnecting from one workspace's Settings ends it for every workspace", async () => {
    // ownerA joins workspace b as an officer; the assistant reached both workspaces with one grant.
    await prisma.membership.create({ data: { id: "m-ownerA-b", workspaceId: "b", userId: "ownerA", role: "member", createdAt: new Date() } });
    try {
      const clientId = await newClient();
      const { accessToken } = await connect(clientId, "ownerA");
      expect(await action("ownerA", { workspaceId: "b", clientId })).toEqual({ ok: true, data: undefined });
      await expectRefused(accessToken);
      expect(await listConnections("ownerA")).toEqual([]);
    } finally {
      await prisma.membership.delete({ where: { id: "m-ownerA-b" } });
    }
  });

  it("refuses bad input before touching anything", async () => {
    const clientId = await newClient();
    await connect(clientId, "ownerA");
    const before = await rows("ownerA", clientId);
    expect(await action("ownerA", { workspaceId: "a" })).toEqual({ ok: false, error: "Assistant not found." });
    expect(await action("ownerA", { workspaceId: "a", clientId: "x".repeat(65) })).toEqual({ ok: false, error: "Assistant not found." });
    expect(await action("ownerA", { clientId })).toEqual({ ok: false, error: "Assistant not found." });
    expect(await rows("ownerA", clientId)).toEqual(before);
  });

  it("sends a signed-out visitor to sign in", async () => {
    const clientId = await newClient();
    await connect(clientId, "ownerA");
    await expect(signedOut(() => disconnectAssistant(null, form({ workspaceId: "a", clientId })))).rejects.toEqual(redirectTo("/signin"));
    expect((await rows("ownerA", clientId)).consents).toBeGreaterThan(0);
  });
});
