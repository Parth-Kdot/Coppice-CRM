import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/(app)/[workspaceId]/settings/page";
import { createCompany } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { ACTIVITY_LINES } from "@/lib/mcp/activity";
import { ACTIVITY_SHOWN, listActivity } from "@/lib/mcp/activity-list";
import { OWNER_A, activityRows, clearActivity, tokenCache } from "./helpers/mcp-tools";
import { deleteOAuthClients, mcpClient, resultJson, restoreFetch, routeAppFetches } from "./helpers/oauth";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The page's forms are client components that ask for the router while rendering on the server.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
  usePathname: () => "/a/settings",
  useSearchParams: () => new URLSearchParams(),
}));

// "What assistants changed" in Settings: the list every member sees, built from the rows the tools
// write. The rows are made by real tool calls through the official client, the page is the real
// Settings page rendered as a signed-in member, and the labels are checked for what each viewer may
// see. Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner).

const tokenFor = tokenCache();
const OFFICER = { userId: "officerA", workspaceId: "a", role: "member" } as const;
const B = { userId: "ownerB", workspaceId: "b", role: "owner" } as const;

async function callAs(userId: string, name: string, args: Record<string, unknown> = {}) {
  const client = await mcpClient(await tokenFor(userId));
  return client.callTool({ name, arguments: { workspaceId: "a", ...args } });
}
async function company(name: string) {
  const made = await createCompany(OWNER_A, { name });
  if (made.status !== "saved") throw new Error("seed flagged");
  return made.companyId;
}
const page = async (userId: string, workspaceId = "a") =>
  renderToStaticMarkup(await asUser(userId, async () => SettingsPage({ params: Promise.resolve({ workspaceId }) } as Parameters<typeof SettingsPage>[0])));
// The part of the page between the list's heading and the next one.
const section = (markup: string) => {
  const start = markup.indexOf("What assistants changed");
  expect(start).toBeGreaterThan(-1);
  const end = markup.indexOf("Allow AI assistants in this workspace", start);
  return markup.slice(start, end === -1 ? undefined : end);
};

beforeAll(async () => {
  routeAppFetches();
  await resetAndSeed();
  await deleteOAuthClients();
});

beforeEach(async () => {
  await prisma.mcpRateLimit.deleteMany();
  await clearActivity();
  await withTenant(OWNER_A, (tx) => tx.company.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(B, (tx) => tx.company.deleteMany({ where: { workspaceId: "b" } }));
  await withTenant(OWNER_A, (tx) => tx.template.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.researchSource.deleteMany({ where: { workspaceId: "a" } }));
  await withTenant(OWNER_A, (tx) => tx.factSheetItem.deleteMany({ where: { workspaceId: "a" } }));
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false, mcpEnabled: true } });
});

afterAll(async () => {
  restoreFetch();
  await deleteOAuthClients();
  await prisma.session.deleteMany();
  await clearActivity();
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
  await prisma.$disconnect();
});

describe("the list on the Settings page", () => {
  it("is one sentence saying so for a workspace with no activity, and shows no list", async () => {
    for (const user of ["ownerA", "officerA"]) {
      const text = section(await page(user));
      expect(text).toContain("Nothing yet. Changes an assistant makes will be listed here.");
      expect(text).not.toContain("<ul");
      expect(text).toContain("Every member sees this list, with each assistant&#x27;s name.");
    }
    // Your own connections keep their own line.
    expect(await page("ownerA")).toContain("Only you see this list.");
  });

  it("lists what assistants did, newest first, as the person and the assistant, with the company as a link and every name in <bdi>", async () => {
    const acme = await company("Acme Corp");
    await callAs("officerA", "claim_company", { companyId: acme });
    await callAs("ownerA", "set_company_archived", { companyId: acme, archived: true });
    const markup = await page("officerA");
    const text = section(markup);
    expect(text).toContain(`<bdi>ownerA</bdi>&#x27;s assistant archived`);
    expect(text).toContain(`<bdi>officerA</bdi>&#x27;s assistant claimed`);
    expect(text).toContain(`<a class="lg-link" href="/a/companies/${acme}"><bdi>Acme Corp</bdi></a>`);
    expect(text).toContain("<bdi>Test Assistant</bdi>");
    expect(text).toContain("<time dateTime=");
    // Newest first: the archive came after the claim.
    expect(text.indexOf("assistant archived")).toBeLessThan(text.indexOf("assistant claimed"));
  });

  it("escapes a name that is HTML or tries to steer the line, and keeps it inside <bdi>", async () => {
    const odd = await company("<script>alert(1)</script> ‮evil");
    await callAs("ownerA", "claim_company", { companyId: odd });
    const text = section(await page("ownerA"));
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).toMatch(/<bdi>&lt;script&gt;[^<]*<\/bdi>/);
  });

  it("shows an officer a fixed phrase for a fact an owner's assistant saved, never the fact's text", async () => {
    const secret = "Our budget is 4,200 dollars and Pat Kim runs it.";
    const saved = resultJson(await callAs("ownerA", "save_fact", { text: secret }));
    expect(saved.verified).toBe(false);
    for (const user of ["officerA", "ownerA"]) {
      const markup = await page(user);
      const text = section(markup);
      expect(text).toContain("assistant added a fact.");
      expect(markup).not.toContain("4,200");
      expect(markup).not.toContain("Pat Kim runs it");
    }
  });

  it("names a contact, a template and a source by what the viewer may see, and uses a fixed phrase once the target is gone", async () => {
    const acme = await company("Acme Corp");
    await callAs("officerA", "save_contact", { companyId: acme, name: "Sam Lee", email: "sam@acme.example.com" });
    await callAs("ownerA", "save_template", { name: "Alumni angle", body: "Hi {{firstName}}" });
    await callAs("ownerA", "save_research_source", { url: "https://acme.example.com/careers", label: "Acme careers page" });

    const owner = section(await page("ownerA"));
    expect(owner).toContain("added the contact <bdi>Sam Lee</bdi>");
    expect(owner).toContain("added the template <bdi>Alumni angle</bdi>");
    expect(owner).toContain("added the research source <bdi>Acme careers page</bdi>");

    // An officer sees research sources only while AI is on, so the label stays out until then.
    const officerOff = section(await page("officerA"));
    expect(officerOff).toContain("added the template <bdi>Alumni angle</bdi>");
    expect(officerOff).toContain("added a research source.");
    expect(officerOff).not.toContain("Acme careers page");
    // "AI on" is the Settings page's own rule: the workspace switch and a key on the server.
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
    const key = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    try {
      expect(section(await page("officerA"))).toContain("added the research source <bdi>Acme careers page</bdi>");
    } finally {
      if (key === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = key;
      await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    }

    // Delete the contact, the template and the company: the lines stay and name nothing.
    const contactId = (await withTenant(OWNER_A, (tx) => tx.contact.findFirstOrThrow({ where: { companyId: acme } }))).id;
    await withTenant(OWNER_A, (tx) => tx.contact.deleteMany({ where: { id: contactId } }));
    await withTenant(OWNER_A, (tx) => tx.template.deleteMany({ where: { workspaceId: "a" } }));
    await withTenant(OWNER_A, (tx) => tx.company.deleteMany({ where: { id: acme } }));
    const after = section(await page("officerA"));
    expect(after).toContain("added a contact.");
    expect(after).toContain("added a template.");
    expect(after).not.toContain("Sam Lee");
    expect(after).not.toContain("Alumni angle");
    // The row of the deleted company is kept, with no company to link.
    expect(await activityRows("a")).toHaveLength(3);
  });

  it("shows who is leaving to owners only: an owner reads the name, an officer reads no such line", async () => {
    await prisma.user.create({ data: { id: "sam", name: "Sam Lee", email: "sam@example.com", emailVerified: true } });
    await prisma.membership.create({ data: { id: "m-sam", workspaceId: "a", userId: "sam", role: "member", createdAt: new Date() } });
    try {
      const acme = await company("Acme Corp");
      await callAs("sam", "claim_company", { companyId: acme });
      await callAs("ownerA", "set_departing", { userId: "sam", departing: true });
      await callAs("ownerA", "release_departing_claims", { confirm: true });
      await callAs("ownerA", "set_departing", { userId: "sam", departing: false });
      await callAs("ownerA", "set_departing", { userId: "sam", departing: true });
      expect(await activityRows("a")).toHaveLength(5);

      const owner = section(await page("ownerA"));
      expect(owner).toContain("<bdi>ownerA</bdi>&#x27;s assistant marked <bdi>Sam Lee</bdi> as leaving.");
      expect(owner).toContain("<bdi>ownerA</bdi>&#x27;s assistant cleared the leaving mark for <bdi>Sam Lee</bdi>.");
      expect(owner).toContain("assistant released the claims of members who are leaving.");

      // An officer sees the other lines, and nothing about who is leaving, not even that a mark was made.
      const officer = section(await page("officerA"));
      const list = officer.slice(officer.indexOf("<ul"), officer.indexOf("</ul>"));
      expect(list).toContain("assistant claimed");
      expect(list).not.toMatch(/leaving|marked|cleared/);
      // Sam's name appears once, as the person whose assistant claimed the company.
      expect(list.match(/Sam Lee/g)).toHaveLength(1);
      const items = await listActivity({ ...OFFICER }, { aiOn: false });
      expect(items.map((i) => i.verb)).toEqual(["claimed"]);

      // The name is read now: once the member is gone the line says so in a fixed phrase.
      await prisma.membership.delete({ where: { id: "m-sam" } });
      const gone = section(await page("ownerA"));
      expect(gone).toContain("marked a member who is no longer here as leaving.");
      expect(gone).toContain("cleared the leaving mark for a member who is no longer here.");
      expect(gone).not.toContain("marked <bdi>Sam Lee");
    } finally {
      // Sam's own claim row keeps the user from being deleted, so the log is cleared first.
      await clearActivity();
      await prisma.user.deleteMany({ where: { id: "sam" } });
    }
  });

  it("does not let rows an officer may not see use up the officer's fifty lines", async () => {
    const acme = await company("Acme Corp");
    await withTenant(OWNER_A, async (tx) => {
      await tx.assistantActivity.create({ data: { workspaceId: "a", userId: "ownerA", clientId: null, tool: "log_outreach", action: "logged", companyId: acme, createdAt: new Date(Date.now() - 3_600_000) } });
      await tx.assistantActivity.createMany({
        data: Array.from({ length: ACTIVITY_SHOWN + 5 }, () => ({ workspaceId: "a", userId: "ownerA", clientId: null, tool: "set_departing", action: "departing_set", targetId: "officerA" })),
      });
    });
    expect((await listActivity({ ...OFFICER }, { aiOn: false })).map((i) => i.verb)).toEqual(["logged outreach for"]);
    expect(await listActivity({ ...OWNER_A }, { aiOn: false })).toHaveLength(ACTIVITY_SHOWN);
  });

  it("shows a deleted contact as a fixed phrase and an unknown pair as the plain fallback", async () => {
    const acme = await company("Acme Corp");
    const contact = resultJson(await callAs("ownerA", "save_contact", { companyId: acme, name: "Sam Lee" }));
    await callAs("ownerA", "delete_permanently", { what: "contact", id: contact.contactId, confirm: true });
    // A row from a later version of Coppice, with a tool and action this one does not know.
    await withTenant(OWNER_A, (tx) => tx.assistantActivity.create({ data: { workspaceId: "a", userId: "ownerA", clientId: null, tool: "a_future_tool", action: "done", companyId: acme } }));
    const text = section(await page("officerA"));
    expect(text).toContain("assistant deleted a contact.");
    expect(text).toContain("assistant changed <a class=\"lg-link\"");
    expect(text).not.toContain("Sam Lee");
  });

  it("shows only the last 50 rows, newest first, with Show all for the older ones, and never another workspace's rows", async () => {
    const acme = await company("Acme Corp");
    const beta = await withTenant(B, async (tx) => (await tx.company.create({ data: { workspaceId: "b", name: "Beta Only", nameKey: "beta only" }, select: { id: true } })).id);
    await withTenant(B, (tx) => tx.assistantActivity.create({ data: { workspaceId: "b", userId: "ownerB", clientId: "x", tool: "claim_company", action: "claimed", companyId: beta } }));
    await withTenant(OWNER_A, (tx) =>
      tx.assistantActivity.createMany({
        data: Array.from({ length: ACTIVITY_SHOWN + 5 }, (_, i) => ({
          workspaceId: "a",
          userId: "ownerA",
          clientId: null,
          tool: "log_outreach",
          action: "logged",
          companyId: acme,
          createdAt: new Date(Date.now() - (ACTIVITY_SHOWN + 5 - i) * 60_000),
        })),
      }),
    );
    const items = await listActivity({ ...OWNER_A }, { aiOn: false });
    expect(items).toHaveLength(ACTIVITY_SHOWN);
    expect([...items].sort((a, b) => b.at.getTime() - a.at.getTime()).map((i) => i.id)).toEqual(items.map((i) => i.id));
    const text = section(await page("officerA"));
    expect(text).toContain(`Show all ${ACTIVITY_SHOWN} changes`);
    expect(text).not.toContain("Beta Only");
    // The other workspace sees only its own row.
    const beta2 = section(await page("ownerB", "b"));
    expect(beta2).toContain("Beta Only");
    expect(beta2).not.toContain("Acme Corp");
  });

  it("shows a fixed phrase for a leaving row that never recorded its member", async () => {
    await withTenant(OWNER_A, (tx) => tx.assistantActivity.create({ data: { workspaceId: "a", userId: "ownerA", clientId: null, tool: "set_departing", action: "departing_set" } }));
    const items = await listActivity({ ...OWNER_A }, { aiOn: false });
    expect(items).toHaveLength(1);
    expect(items[0].label).toMatchObject({ text: "a member" });
  });

  it("reads the rows in one transaction and gives an unknown assistant no name", async () => {
    const acme = await company("Acme Corp");
    await withTenant(OWNER_A, (tx) => tx.assistantActivity.create({ data: { workspaceId: "a", userId: "ownerA", clientId: "gone-client", tool: "claim_company", action: "claimed", companyId: acme } }));
    const [item] = await listActivity({ ...OWNER_A }, { aiOn: false });
    expect(item).toMatchObject({ person: "ownerA", assistant: null, verb: "claimed", label: { kind: "name", prefix: "", text: "Acme Corp", href: `/a/companies/${acme}` } });
    expect(section(await page("ownerA"))).not.toContain("gone-client");
  });
});

describe("what each action says", () => {
  it("every verb in the table reads as a sentence with the person's assistant in front", () => {
    for (const [tool, lines] of Object.entries(ACTIVITY_LINES)) {
      for (const [action, found] of Object.entries(lines)) {
        expect(`ownerA's assistant ${found?.verb}`, `${tool} ${action}`).toMatch(/^ownerA's assistant [a-z]/);
        expect(found?.verb, `${tool} ${action}`).not.toMatch(/[.!?]$/);
      }
    }
  });
});

describe("an officer's view of the list stays inside their workspace", () => {
  it("lists nothing when the officer opens a workspace they are not in", async () => {
    await company("Acme Corp");
    await callAs("ownerA", "claim_company", { companyId: (await withTenant(OWNER_A, (tx) => tx.company.findFirstOrThrow({ select: { id: true } }))).id });
    // listActivity as a member of b asking for a: row-level security hides the rows.
    const rows = await listActivity({ userId: "ownerB", workspaceId: "a", role: "owner" }, { aiOn: false });
    expect(rows).toEqual([]);
    const own = await listActivity({ ...OFFICER }, { aiOn: false });
    expect(own).toHaveLength(1);
    expect(own[0].person).toBe("ownerA");
  });
});

