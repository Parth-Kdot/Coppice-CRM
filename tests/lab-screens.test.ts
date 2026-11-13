import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeVariants as proposeAction } from "@/app/(app)/[workspaceId]/stats/actions";
import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { getCompanyPage } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import * as templates from "@/lib/templates";
import { describeChange } from "@/lib/template-lab/change";
import { startExperiment } from "@/lib/template-lab/lab";
import { form } from "./helpers/form";
import { answer, fakeGemini } from "./helpers/gemini";
import { asUser } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// What the Template Lab's screens read: the sentences a variant changed (the "Was" and "Now" lines of
// the Try a variant panel) and the templates the company page hands to the log form and the Pitch
// Drafter, which must carry the running experiment's arms and its suggestion.

const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const BODY = `Hi {{firstName}},

I'm {{senderName}} from {{orgName}}. We run an annual hackathon for 600 students and we are looking for sponsors.

Would you be open to a 10 minute call this month?

Thanks,
{{senderName}}
{{orgName}}`;
const ASK = "Would you be open to a 10 minute call this month?";
const PITCH = "We run an annual hackathon for 600 students and we are looking for sponsors.";

describe("describeChange", () => {
  it.each<[string, string, { was: string; now: string } | null]>([
    ["a replaced sentence", BODY.replace(ASK, "Could we set up a short call?"), { was: ASK, now: "Could we set up a short call?" }],
    ["a replaced opening", BODY.replace("Hi {{firstName}},", "Hello {{firstName}},"), { was: "Hi {{firstName}},", now: "Hello {{firstName}}," }],
    ["a removed sentence", BODY.replace(` ${PITCH}`, ""), { was: PITCH, now: "" }],
    ["an added sentence", BODY.replace(ASK, `${ASK} Reply to this email if not.`), { was: "", now: "Reply to this email if not." }],
    ["two sentences replaced as one run", BODY.replace(PITCH, "We run a hackathon. Sponsors get a booth."), { was: PITCH, now: "We run a hackathon. Sponsors get a booth." }],
    ["spacing alone is no change", BODY.replace("Hi {{firstName}},", "Hi   {{firstName}},").replace(/\n\n/g, "\n \n"), null],
    ["the same text", BODY, null],
  ])("%s", (_name, variant, expected) => {
    expect(describeChange(BODY, variant)).toEqual(expected);
  });

  it("keeps a line break inside the changed run as a break", () => {
    const original = "Hi {{firstName}},\n\nWe run a hackathon.\nCome see it.\n\nThanks,\n{{senderName}}";
    const variant = "Hi {{firstName}},\n\nWe run a hackathon.\nCome see it, and bring a friend.\n\nThanks,\n{{senderName}}";
    expect(describeChange(original, variant)).toEqual({ was: "Come see it.", now: "Come see it, and bring a friend." });
  });
});

const template = async (name: string) => {
  const result = await templates.createTemplate(OWNER, { name, body: BODY });
  if (!result.ok) throw new Error(result.error);
  return result.data.templateId;
};
let sendCount = 0;
async function sends(templateId: string, count: number) {
  const at = await dbNow();
  const ids = Array.from({ length: count }, (_, i) => `s-${++sendCount}-${i}`);
  await withTenant(OWNER, async (tx) => {
    await tx.company.createMany({ data: ids.map((id) => ({ id, workspaceId: "a", name: id, nameKey: id })) });
    await tx.outreach.createMany({ data: ids.map((id) => ({ id: `o-${id}`, workspaceId: "a", companyId: id, senderId: "ownerA", templateId, sentAt: at })) });
  });
}
const page = (companyId: string, tenant: Membership = OFFICER) => getCompanyPage(tenant, companyId);
const suggested = async (companyId: string) => (await page(companyId))?.templates.filter((t) => t.arm?.suggested).map((t) => t.arm?.label);

beforeEach(async () => {
  await resetAndSeed();
  process.env.GEMINI_API_KEY = "test-key";
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("the templates the company page gives the log form and the drafter", () => {
  it("are exactly what activeTemplates reads, with no arm anywhere while no experiment runs", async () => {
    await template("Alumni angle");
    await sends(await template("Career fair"), 1);
    const company = "s-1-0";
    const onPage = (await page(company))?.templates;
    expect(onPage).toEqual(await templates.activeTemplates(OFFICER));
    expect(onPage?.some((t) => "arm" in t)).toBe(false);
  });

  it("carry the arms and the suggestion of the running experiment, and the suggestion moves as sends are logged", async () => {
    const base = await template("Alumni angle");
    await template("Career fair");
    const started = await startExperiment(OWNER, base, [
      { kind: "ask", summary: "Softer ask.", body: BODY.replace(ASK, "Could we set up a short call?") },
      { kind: "shorter", summary: "Cuts the pitch.", body: BODY.replace(PITCH, "We run a hackathon.") },
    ]);
    if (!started.ok) throw new Error(started.error);
    const [a, b, c] = started.data.arms.map((arm) => arm.templateId);
    // Any company will do: the templates are the workspace's, not the company's.
    await withTenant(OWNER, (tx) => tx.company.create({ data: { id: "co", workspaceId: "a", name: "Co", nameKey: "co" } }));

    const first = (await page("co"))?.templates;
    expect(first).toEqual(await templates.activeTemplates(OFFICER));
    expect(first?.map((t) => [t.name, t.arm?.label, t.arm?.suggested])).toEqual([
      ["Alumni angle", "A", true],
      ["Alumni angle (B)", "B", false],
      ["Alumni angle (C)", "C", false],
      ["Career fair", undefined, undefined],
    ]);

    await sends(a, 1);
    expect(await suggested("co")).toEqual(["B"]);
    await sends(b, 1);
    expect(await suggested("co")).toEqual(["C"]);
    await sends(c, 2);
    expect(await suggested("co")).toEqual(["A"]);
  });

  it("do not carry another workspace's experiment", async () => {
    const base = await template("Alumni angle");
    const started = await startExperiment(OWNER, base, [{ kind: "ask", summary: "Softer ask.", body: BODY.replace(ASK, "Could we set up a short call?") }]);
    if (!started.ok) throw new Error(started.error);
    await withTenant({ userId: "ownerB", workspaceId: "b" }, (tx) => tx.company.create({ data: { id: "cob", workspaceId: "b", name: "Cob", nameKey: "cob" } }));
    expect((await getCompanyPage({ userId: "ownerB", workspaceId: "b" }, "cob"))?.templates).toEqual([]);
  });
});

describe("the Try a variant action", () => {
  it("gives each checked variant with the sentences it changed, set against the original", async () => {
    const base = await template("Alumni angle");
    const ask = BODY.replace(ASK, "Could we set up a short call?");
    const shorter = BODY.replace(PITCH, "We run a hackathon.");
    fakeGemini(
      answer(
        JSON.stringify({
          variants: [
            { kind: "ask", summary: "Makes the ask softer.", body: ask },
            { kind: "shorter", summary: "Cuts the pitch.", body: shorter },
          ],
        }),
      ),
    );
    const result = await asUser("ownerA", () => proposeAction(null, form({ workspaceId: "a", templateId: base })));
    expect(result).toMatchObject({
      ok: true,
      data: {
        templateName: "Alumni angle",
        variants: [
          { kind: "ask", change: { was: ASK, now: "Could we set up a short call?" } },
          { kind: "shorter", change: { was: PITCH, now: "We run a hackathon." } },
        ],
      },
    });
  });
});
