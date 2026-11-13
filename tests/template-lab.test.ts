import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endExperiment as endAction, proposeVariants as proposeAction, startExperiment as startAction } from "@/app/(app)/[workspaceId]/stats/actions";
import { archiveTemplate as archiveAction, updateTemplate as updateAction } from "@/app/(app)/[workspaceId]/settings/template-actions";
import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { aiBreakdown } from "@/lib/ai/run";
import { toGeminiSchema } from "@/lib/ai/schema";
import { addFact } from "@/lib/facts";
import { rate, type Tally } from "@/lib/stats-math";
import * as templates from "@/lib/templates";
import { CONTACT_IN_TEMPLATE, type LabVariant } from "@/lib/template-lab/check";
import { experimentVerdict, suggestArm } from "@/lib/template-lab/experiment";
import { endExperiment, getExperimentView, startExperiment, VARIANTS_FAILED } from "@/lib/template-lab/lab";
import { EXPERIMENT_ALREADY_RUNNING, proposeVariants, TEMPLATE_GONE } from "@/lib/template-lab/propose";
import { labReplySchema } from "@/lib/validation";
import { form, redirectTo } from "./helpers/form";
import { answer, apiError, calls, fakeGemini } from "./helpers/gemini";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The Template Lab: proposing variants (recorded Gemini replies, never live), starting and ending
// an experiment, the lock on its templates, the picker's suggestion and the verdict. Real server
// actions and the real database as app_user.

const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };
const DAY = 24 * 60 * 60 * 1000;

const BODY = `Hi {{firstName}},

I'm {{senderName}} from {{orgName}}. We run an annual hackathon for 600 students and we are looking for sponsors.

Would you be open to a 10 minute call this month?

Thanks,
{{senderName}}
{{orgName}}`;
const ASK = "Would you be open to a 10 minute call this month?";

const ask = (text: string, summary = "Makes the ask softer."): LabVariant => ({ kind: "ask", summary, body: BODY.replace(ASK, text) });
const closing = (text: string): LabVariant => ({ kind: "closing", summary: "Ends on the packet.", body: BODY.replace(ASK, text) });
const shorter = (): LabVariant => ({ kind: "shorter", summary: "Cuts the pitch.", body: BODY.replace("We run an annual hackathon for 600 students and we are looking for sponsors.", "We run a hackathon.") });
const B = ask("Could we set up a short call?");
const C = shorter();
const recorded = (...variants: unknown[]) => answer(JSON.stringify({ variants }));

const template = async (owner: Membership, name: string, body = BODY) => {
  const result = await templates.createTemplate(owner, { name, body });
  if (!result.ok) throw new Error(result.error);
  return result.data.templateId;
};
const templateRows = (tenant: Membership = OWNER) =>
  withTenant(tenant, (tx) => tx.template.findMany({ select: { id: true, name: true, body: true, archivedAt: true, familyId: true, variantNote: true }, orderBy: { name: "asc" } }));
const experiments = (tenant: Membership = OWNER) =>
  withTenant(tenant, (tx) => tx.templateExperiment.findMany({ select: { id: true, status: true, baseTemplateId: true, keptTemplateId: true, endedAt: true, startedById: true, arms: { select: { label: true, kind: true, summary: true, templateId: true }, orderBy: { label: "asc" } } } }));
const runs = () => withTenant(OWNER, (tx) => tx.aiRun.findMany({ where: { feature: "TEMPLATE_LAB" }, select: { userId: true, model: true, status: true, error: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));

// Starts an experiment on `base` with these picks, failing the test if it can't.
async function start(base: string, picks: LabVariant[] = [B, C]) {
  const result = await startExperiment(OWNER, base, picks);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

let base: string;

beforeEach(async () => {
  await resetAndSeed();
  process.env.GEMINI_API_KEY = "test-key";
  await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true } });
  base = await template(OWNER, "Alumni angle");
  await addFact(OWNER, "The hackathon draws 1,200 attendees.");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("proposeVariants", () => {
  it("returns the variants that pass every check, and sends only the template text and verified facts", async () => {
    await addFact(OWNER, "Gold sponsors get a booth.");
    fakeGemini(recorded(B, closing("Reply to this email if you want the packet."), C));
    const result = await proposeVariants(OWNER, base);
    expect(result).toEqual({ ok: true, data: { templateId: base, templateName: "Alumni angle", variants: [B, closing("Reply to this email if you want the packet."), C], dropped: 0, model: "gemini-3.6-flash" } });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("models/gemini-3.6-flash:generateContent");
    expect(calls[0].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "LOW" }, responseJsonSchema: toGeminiSchema(labReplySchema) });
    const prompt = (calls[0].body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(prompt).toContain(`<template>\n${BODY}\n</template>`);
    expect(prompt).toContain("1. The hackathon draws 1,200 attendees.\n2. Gold sponsors get a booth.");
    expect(await runs()).toEqual([{ userId: "ownerA", model: "gemini-3.6-flash", status: "SUCCEEDED", error: null }]);
  });

  it("sends at most 40 verified facts", async () => {
    for (let i = 0; i < 45; i++) await addFact(OWNER, `Fact number ${i} about the group.`);
    fakeGemini(recorded(B));
    await proposeVariants(OWNER, base);
    const prompt = (calls[0].body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(prompt.match(/^\d+\. /gm)).toHaveLength(40);
  });

  it("drops each variant a check fails and keeps the rest", async () => {
    const lostPlaceholder = { ...B, body: BODY.replace(ASK, "Could we talk?").replace("{{orgName}}", "Riverbend") };
    const invented = ask("Could we talk about our 800 students?");
    fakeGemini(recorded(lostPlaceholder, B, invented));
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: true, data: { variants: [B], dropped: 2 } });
    // A copy of one already kept is dropped too.
    fakeGemini(recorded(B, { ...B, kind: "closing" }, C));
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: true, data: { variants: [B, C], dropped: 1 } });
    // The model is asked for three at most; a fourth never gets through.
    fakeGemini(recorded(B, C, closing("Reply if you want the packet."), ask("Could we meet?")));
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: true, data: { dropped: 0 } });
  });

  it("is broke_rules when no variant survives: logged FAILED, nothing proposed", async () => {
    fakeGemini(recorded({ ...B, body: BODY }, ask("Could we talk about 800 students?")));
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "The AI's answer didn't pass Coppice's checks. Try again." });
    expect(await runs()).toEqual([{ userId: "ownerA", model: "gemini-3.6-flash", status: "FAILED", error: "broke_rules" }]);
    expect(await experiments()).toEqual([]);
  });

  it("uses a number from a verified fact, and refuses it once the fact is gone", async () => {
    const withFact = ask("Could we talk? Our hackathon draws 1,200 attendees.");
    fakeGemini(recorded(withFact));
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: true, data: { variants: [withFact] } });
    await withTenant(OWNER, (tx) => tx.factSheetItem.deleteMany());
    fakeGemini(recorded(withFact));
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: false });
  });

  it("drops a variant of an invented kind or over the limit on its own, and cuts a long summary", async () => {
    const long = "x".repeat(200);
    fakeGemini(recorded({ ...B, kind: "rewrite" }, { ...C, summary: long }, { ...B, body: "x".repeat(6000) }));
    const result = await proposeVariants(OWNER, base);
    expect(result).toMatchObject({ ok: true, data: { variants: [{ kind: "shorter" }] } });
    if (result.ok) expect(result.data.variants[0].summary.length).toBeLessThanOrEqual(140);
  });

  it("restores angle brackets the model was shown as look-alikes", async () => {
    const original = "Hi {{firstName}},\n\nWe run <b>Hack Night</b> every spring. Would you like to help?\n\n{{senderName}}\n{{orgName}}";
    const id = await template(OWNER, "Brackets", original);
    const variant: LabVariant = { kind: "ask", summary: "Softer ask.", body: original.replace("Would you like to help?", "Could you help?").replace(/</g, "‹").replace(/>/g, "›") };
    fakeGemini(recorded(variant));
    const result = await proposeVariants(OWNER, id);
    expect(result).toMatchObject({ ok: true, data: { variants: [{ body: original.replace("Would you like to help?", "Could you help?") }] } });
    const prompt = (calls[0].body.contents as { parts: { text: string }[] }[])[0].parts[0].text;
    expect(prompt).toContain("‹b›Hack Night‹/b›");
  });

  it("refuses a template that holds an email address or phone number, before any AI call", async () => {
    const withEmail = await template(OWNER, "With contact", BODY.replace(ASK, "Write to dana@riverbend.org."));
    const withPhone = await template(OWNER, "With phone", BODY.replace(ASK, "Call 765-555-0142."));
    fakeGemini(recorded(B));
    expect(await proposeVariants(OWNER, withEmail)).toEqual({ ok: false, error: CONTACT_IN_TEMPLATE });
    expect(await proposeVariants(OWNER, withPhone)).toEqual({ ok: false, error: CONTACT_IN_TEMPLATE });
    expect(calls).toHaveLength(0);
    expect(await runs()).toEqual([]);
  });

  it("refuses an officer, another workspace's template and an archived one, before any AI call", async () => {
    fakeGemini(recorded(B));
    expect(await proposeVariants(OFFICER, base)).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    await prisma.workspace.update({ where: { id: "b" }, data: { aiEnabled: true } });
    expect(await proposeVariants(OTHER_ORG, base)).toEqual({ ok: false, error: TEMPLATE_GONE });
    expect(await proposeVariants(OWNER, "nope")).toEqual({ ok: false, error: TEMPLATE_GONE });
    await templates.archiveTemplate(OWNER, base);
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: TEMPLATE_GONE });
    expect(calls).toHaveLength(0);
  });

  it("refuses while an experiment is running, without an AI call", async () => {
    await start(base);
    const other = await template(OWNER, "Other");
    fakeGemini(recorded(B));
    expect(await proposeVariants(OWNER, other)).toEqual({ ok: false, error: EXPERIMENT_ALREADY_RUNNING });
    expect(calls).toHaveLength(0);
  });

  it("makes no call when AI is off or the workspace used its limit", async () => {
    fakeGemini(recorded(B), recorded(B));
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } });
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." });
    await prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: true, aiMonthlyLimit: 1 } });
    expect((await proposeVariants(OWNER, base)).ok).toBe(true);
    expect(await proposeVariants(OWNER, base)).toMatchObject({ ok: false, error: expect.stringContaining("has used its 1 AI calls") });
    expect(calls).toHaveLength(1);
  });

  it("reports a rate limit, a malformed reply and a timeout in plain words, and logs each", async () => {
    const limited = () => apiError(429, "Resource exhausted", "RESOURCE_EXHAUSTED");
    fakeGemini(limited(), limited());
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "The AI is busy right now. Try again in a minute." });
    expect(calls.map((c) => c.url.match(/models\/([\w.-]+):/)?.[1])).toEqual(["gemini-3.6-flash", "gemini-3.8-flash"]);
    fakeGemini(answer("Here are three variants!"));
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "The AI sent back something unusable. Try again." });
    fakeGemini(answer(JSON.stringify({ variants: [] })));
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "The AI sent back something unusable. Try again." });
    const aborted = () => new DOMException("The operation was aborted.", "AbortError");
    fakeGemini(aborted(), aborted(), aborted());
    expect(await proposeVariants(OWNER, base)).toEqual({ ok: false, error: "The AI took too long to answer. Try again." });
    expect((await runs()).map((r) => [r.status, r.error])).toEqual([
      ["FAILED", "rate_limited"],
      ["FAILED", "invalid_output"],
      ["FAILED", "invalid_output"],
      ["FAILED", "timeout"],
    ]);
  });

  it("counts against the workspace's AI limit as a Template stats call", async () => {
    fakeGemini(recorded(B), recorded(B));
    await proposeVariants(OWNER, base);
    await proposeVariants(OWNER, base);
    expect((await aiBreakdown(OWNER)).parts).toEqual([{ key: "template-stats", label: "2 Template stats calls", count: 2 }]);
  });

  it("saves nothing: no template and no experiment", async () => {
    fakeGemini(recorded(B, C));
    await proposeVariants(OWNER, base);
    expect(await templateRows()).toHaveLength(1);
    expect(await experiments()).toEqual([]);
  });
});

describe("startExperiment", () => {
  it("makes the variant templates, the experiment and its arms in one go", async () => {
    const started = await start(base);
    expect(started.arms).toEqual([
      { templateId: base, label: "A", name: "Alumni angle" },
      { templateId: expect.any(String), label: "B", name: "Alumni angle (B)" },
      { templateId: expect.any(String), label: "C", name: "Alumni angle (C)" },
    ]);
    const rows = await templateRows();
    expect(rows.map((r) => [r.name, r.familyId, r.variantNote, r.archivedAt])).toEqual([
      ["Alumni angle", null, null, null],
      ["Alumni angle (B)", base, "Makes the ask softer.", null],
      ["Alumni angle (C)", base, "Cuts the pitch.", null],
    ]);
    expect(rows.find((r) => r.name === "Alumni angle (B)")?.body).toBe(B.body);
    expect(await experiments()).toEqual([
      {
        id: started.experimentId,
        status: "RUNNING",
        baseTemplateId: base,
        keptTemplateId: null,
        endedAt: null,
        startedById: "ownerA",
        arms: [
          { label: "A", kind: "original", summary: "The original template.", templateId: base },
          { label: "B", kind: "ask", summary: "Makes the ask softer.", templateId: started.arms[1].templateId },
          { label: "C", kind: "shorter", summary: "Cuts the pitch.", templateId: started.arms[2].templateId },
        ],
      },
    ]);
  });

  it("runs against just one variant when the owner picks one", async () => {
    const started = await start(base, [B]);
    expect(started.arms.map((a) => a.label)).toEqual(["A", "B"]);
  });

  it("refuses no picks and three picks", async () => {
    expect(await startExperiment(OWNER, base, [])).toEqual({ ok: false, error: "Pick one or two variants to try." });
    expect(await startExperiment(OWNER, base, [B, C, ask("Could we meet?")])).toEqual({ ok: false, error: "Pick one or two variants to try." });
    expect(await experiments()).toEqual([]);
  });

  it("checks each pick again, against the template as it is now, and creates nothing if one fails", async () => {
    const lost = { ...B, body: B.body.replace("{{orgName}}", "Riverbend") };
    const result = await startExperiment(OWNER, base, [C, lost]);
    expect(result).toEqual({ ok: false, error: `${VARIANTS_FAILED} (The variant lost, added or changed a placeholder.)` });
    expect(await templateRows()).toHaveLength(1);
    expect(await experiments()).toEqual([]);
    // The template was edited after the variant was proposed: the variant now differs from it in two places.
    await templates.updateTemplate(OWNER, base, { name: "Alumni angle", body: BODY.replace("Thanks,", "Many thanks,") });
    expect(await startExperiment(OWNER, base, [B])).toEqual({ ok: false, error: `${VARIANTS_FAILED} (The variant changed more than one place.)` });
    expect(await templateRows()).toHaveLength(1);
  });

  it("refuses two picks that match, a pick with an invented number and an unchanged template", async () => {
    expect(await startExperiment(OWNER, base, [B, { ...B, kind: "closing" }])).toMatchObject({ ok: false, error: expect.stringContaining("(The variant matched another one.)") });
    expect(await startExperiment(OWNER, base, [ask("Could we talk about 900 students?")])).toMatchObject({ ok: false, error: expect.stringContaining("number") });
    expect(await startExperiment(OWNER, base, [{ ...B, body: BODY }])).toMatchObject({ ok: false, error: expect.stringContaining("same as the template") });
    expect(await templateRows()).toHaveLength(1);
  });

  it("allows one running experiment at a time", async () => {
    await start(base);
    const other = await template(OWNER, "Career fair");
    expect(await startExperiment(OWNER, other, [ask("Could we set up a short call?")])).toEqual({ ok: false, error: EXPERIMENT_ALREADY_RUNNING });
    expect(await experiments()).toHaveLength(1);
  });

  it("lets only one of two starts at the same moment through", async () => {
    const other = await template(OWNER, "Career fair");
    const results = await Promise.all([startExperiment(OWNER, base, [B]), startExperiment(OWNER, other, [ask("Could we meet?")]), startExperiment(OWNER, base, [C])]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.error))).toEqual([EXPERIMENT_ALREADY_RUNNING, EXPERIMENT_ALREADY_RUNNING]);
    expect(await withTenant(OWNER, (tx) => tx.templateExperiment.count({ where: { status: "RUNNING" } }))).toBe(1);
    // Only the winner's variants exist: three templates in all, not five or six.
    expect(await templateRows()).toHaveLength(3);
  });

  it("allows another experiment once the first has ended", async () => {
    const first = await start(base);
    expect((await endExperiment(OWNER, first.experimentId, base)).ok).toBe(true);
    const second = await startExperiment(OWNER, base, [B]);
    expect(second.ok).toBe(true);
  });

  it("names a variant afresh when an earlier experiment already made that name", async () => {
    const first = await start(base, [B]);
    await endExperiment(OWNER, first.experimentId, base);
    const second = await start(base, [C]);
    expect(second.arms[1].name).toBe("Alumni angle (B 2)");
    // A name taken in any case counts too.
    await endExperiment(OWNER, second.experimentId, base);
    await template(OWNER, "alumni angle (b 3)");
    const third = await start(base, [ask("Could we meet?")]);
    expect(third.arms[1].name).toBe("Alumni angle (B 4)");
  });

  it("keeps a variant's name inside the template name limit", async () => {
    const longName = "n".repeat(80);
    const id = await template(OWNER, longName);
    const started = await start(id, [B]);
    expect(started.arms[1].name).toHaveLength(80);
    expect(started.arms[1].name.endsWith(" (B)")).toBe(true);
  });

  it("refuses an officer, another workspace's template and an archived one", async () => {
    expect(await startExperiment(OFFICER, base, [B])).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await startExperiment(OTHER_ORG, base, [B])).toEqual({ ok: false, error: TEMPLATE_GONE });
    await templates.archiveTemplate(OWNER, base);
    expect(await startExperiment(OWNER, base, [B])).toEqual({ ok: false, error: TEMPLATE_GONE });
    expect(await experiments()).toEqual([]);
    expect(await experiments(OTHER_ORG)).toEqual([]);
  });

  it("refuses a template that holds an email address, even if a variant slips through", async () => {
    const id = await template(OWNER, "With contact", BODY.replace(ASK, "Write to dana@riverbend.org."));
    expect(await startExperiment(OWNER, id, [B])).toEqual({ ok: false, error: CONTACT_IN_TEMPLATE });
  });
});

describe("while an experiment runs", () => {
  it("locks its templates' bodies and archiving, and lets them be renamed", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    for (const id of [a, b, c]) {
      const row = (await templateRows()).find((r) => r.id === id)!;
      expect(await templates.updateTemplate(OWNER, id, { name: row.name, body: row.body + "\nP.S. Soon." })).toEqual({ ok: false, error: "End the experiment first." });
      expect(await templates.archiveTemplate(OWNER, id)).toEqual({ ok: false, error: "End the experiment first." });
      // A rename that leaves the body as it is.
      expect(await templates.updateTemplate(OWNER, id, { name: `${row.name} renamed`, body: row.body })).toEqual({ ok: true, data: undefined });
    }
    expect((await templateRows()).map((r) => r.name)).toEqual(["Alumni angle (B) renamed", "Alumni angle (C) renamed", "Alumni angle renamed"]);
    expect((await templateRows()).every((r) => r.archivedAt === null)).toBe(true);
  });

  it("refuses the same through the Settings actions", async () => {
    await start(base);
    expect(await asUser("ownerA", () => archiveAction(null, form({ workspaceId: "a", templateId: base })))).toEqual({ ok: false, error: "End the experiment first." });
    expect(await asUser("ownerA", () => updateAction(null, form({ workspaceId: "a", templateId: base, name: "Alumni angle", body: `${BODY}\nP.S.` })))).toEqual({
      ok: false,
      error: "End the experiment first.",
    });
  });

  it("leaves every other template alone", async () => {
    await start(base);
    const other = await template(OWNER, "Career fair");
    expect(await templates.updateTemplate(OWNER, other, { name: "Career fair", body: `${BODY}\nP.S.` })).toEqual({ ok: true, data: undefined });
    expect(await templates.archiveTemplate(OWNER, other)).toEqual({ ok: true, data: undefined });
    expect(await templates.unarchiveTemplate(OWNER, other)).toEqual({ ok: true, data: undefined });
  });

  it("does not lock another workspace's templates", async () => {
    await start(base);
    const theirs = await template(OTHER_ORG, "Theirs");
    expect(await templates.archiveTemplate(OTHER_ORG, theirs)).toEqual({ ok: true, data: undefined });
  });

  it("unlocks them when the experiment ends", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    await endExperiment(OWNER, started.experimentId, b);
    // The kept arm can be edited and archived again; the archived ones can't be edited (archived) but can come back.
    expect(await templates.updateTemplate(OWNER, b, { name: "Alumni angle (B)", body: `${B.body}\nP.S.` })).toEqual({ ok: true, data: undefined });
    expect(await templates.unarchiveTemplate(OWNER, a)).toEqual({ ok: true, data: undefined });
    expect(await templates.updateTemplate(OWNER, a, { name: "Alumni angle", body: `${BODY}\nP.S.` })).toEqual({ ok: true, data: undefined });
    expect(await templates.archiveTemplate(OWNER, c)).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("endExperiment", () => {
  it("keeps the chosen arm and archives the others, deleting nothing", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    expect(await endExperiment(OWNER, started.experimentId, b)).toEqual({ ok: true, data: undefined });

    const rows = await templateRows();
    expect(rows.map((r) => [r.name, r.archivedAt !== null])).toEqual([
      ["Alumni angle", true],
      ["Alumni angle (B)", false],
      ["Alumni angle (C)", true],
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual([a, b, c].sort());
    expect(await experiments()).toEqual([
      expect.objectContaining({ id: started.experimentId, status: "ENDED", keptTemplateId: b, endedAt: expect.any(Date), arms: expect.arrayContaining([{ label: "A", kind: "original", summary: expect.any(String), templateId: a }]) }),
    ]);
    // The archived arms are out of the pickers; the kept one is in.
    expect((await templates.activeTemplates(OFFICER)).map((t) => t.name)).toEqual(["Alumni angle (B)"]);
  });

  it("can keep the original, which stays as it is while the variants are archived", async () => {
    const started = await start(base);
    await endExperiment(OWNER, started.experimentId, base);
    expect((await templateRows()).map((r) => [r.name, r.archivedAt !== null])).toEqual([
      ["Alumni angle", false],
      ["Alumni angle (B)", true],
      ["Alumni angle (C)", true],
    ]);
  });

  it("keeps the stats history of every arm", async () => {
    const started = await start(base);
    const [a, b] = started.arms.map((arm) => arm.templateId);
    await sends(a, 3, { prefix: "a" });
    await sends(b, 2, { prefix: "b" });
    await endExperiment(OWNER, started.experimentId, b);
    const { workspaceStats } = await import("@/lib/stats");
    const stats = await workspaceStats(OWNER, "none");
    expect(stats.templates.map((t) => [t.name, t.archived, t.stat.sent]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ["Alumni angle", true, 3],
      ["Alumni angle (B)", false, 2],
      ["Alumni angle (C)", true, 0],
    ]);
  });

  it("refuses an officer, a template that isn't an arm, an experiment already ended, and another workspace's", async () => {
    const started = await start(base);
    const other = await template(OWNER, "Career fair");
    expect(await endExperiment(OFFICER, started.experimentId, base)).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await endExperiment(OWNER, started.experimentId, other)).toEqual({ ok: false, error: "Pick one of the experiment's templates." });
    expect(await endExperiment(OWNER, started.experimentId, "nope")).toEqual({ ok: false, error: "Pick one of the experiment's templates." });
    expect(await endExperiment(OTHER_ORG, started.experimentId, base)).toEqual({ ok: false, error: "That experiment isn't running." });
    expect(await endExperiment(OWNER, "nope", base)).toEqual({ ok: false, error: "That experiment isn't running." });
    expect((await experiments())[0].status).toBe("RUNNING");
    expect(await endExperiment(OWNER, started.experimentId, base)).toEqual({ ok: true, data: undefined });
    expect(await endExperiment(OWNER, started.experimentId, base)).toEqual({ ok: false, error: "That experiment isn't running." });
  });

  it("leaves the experiment running and every template as it was when the one to keep is not an arm", async () => {
    const started = await start(base);
    await endExperiment(OWNER, started.experimentId, "nope");
    expect((await experiments())[0]).toMatchObject({ status: "RUNNING", keptTemplateId: null });
    expect((await templateRows()).every((r) => r.archivedAt === null)).toBe(true);
  });
});

// ----- Sends, for the picker's suggestion and the experiment's numbers -----

let sendCount = 0;
// `count` sends of a template, `days` days ago by the database's clock, the first `replies` of them replied.
async function sends(templateId: string, count: number, { days = 0, replies = 0, prefix = "s" }: { days?: number; replies?: number; prefix?: string } = {}) {
  const at = new Date((await dbNow()).getTime() - days * DAY);
  const ids = Array.from({ length: count }, (_, i) => `${prefix}-${++sendCount}-${i}`);
  await withTenant(OWNER, async (tx) => {
    await tx.company.createMany({ data: ids.map((id) => ({ id, workspaceId: "a", name: id, nameKey: id })) });
    await tx.outreach.createMany({
      data: ids.map((id, i) => ({ id: `o-${id}`, workspaceId: "a", companyId: id, senderId: "ownerA", templateId, sentAt: at, gotReply: i < replies })),
    });
  });
}
const setStart = (experimentId: string, daysAgo: number) =>
  withTenant(OWNER, async (tx) => {
    const at = new Date((await dbNow()).getTime() - daysAgo * DAY);
    await tx.templateExperiment.update({ where: { id: experimentId }, data: { startedAt: at } });
  });

describe("the picker's suggestion", () => {
  it.each([
    ["no arms", [], null],
    ["all equal: A", [{ label: "A", sends: 0 }, { label: "B", sends: 0 }, { label: "C", sends: 0 }], "A"],
    ["B has the fewest", [{ label: "A", sends: 3 }, { label: "B", sends: 1 }, { label: "C", sends: 2 }], "B"],
    ["C has the fewest", [{ label: "A", sends: 3 }, { label: "B", sends: 2 }, { label: "C", sends: 1 }], "C"],
    ["a tie for fewest goes to A", [{ label: "A", sends: 1 }, { label: "B", sends: 4 }, { label: "C", sends: 1 }], "A"],
    ["a tie between B and C goes to B", [{ label: "A", sends: 5 }, { label: "B", sends: 2 }, { label: "C", sends: 2 }], "B"],
    ["arms given in another order", [{ label: "C", sends: 0 }, { label: "A", sends: 0 }, { label: "B", sends: 0 }], "A"],
    ["two arms", [{ label: "A", sends: 2 }, { label: "B", sends: 1 }], "B"],
  ])("suggestArm: %s", (_name, arms, expected) => {
    expect(suggestArm(arms)).toBe(expected);
  });

  it("returns the usual options, unchanged, when no experiment runs", async () => {
    const other = await template(OWNER, "Career fair");
    expect(await templates.activeTemplates(OFFICER)).toEqual([
      { id: base, name: "Alumni angle", body: BODY },
      { id: other, name: "Career fair", body: BODY },
    ]);
  });

  it("marks the arm with the fewest sends since the experiment started, ties going to A, then B, then C", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    const other = await template(OWNER, "Career fair");
    const suggested = async (tenant: Membership = OFFICER) => {
      const options = await templates.activeTemplates(tenant);
      return options.filter((o) => o.arm?.suggested).map((o) => o.arm?.label);
    };

    expect(await suggested()).toEqual(["A"]);
    const options = await templates.activeTemplates(OFFICER);
    expect(options.map((o) => [o.name, o.arm])).toEqual([
      ["Alumni angle", { experimentId: started.experimentId, label: "A", suggested: true, sends: 0 }],
      ["Alumni angle (B)", { experimentId: started.experimentId, label: "B", suggested: false, sends: 0 }],
      ["Alumni angle (C)", { experimentId: started.experimentId, label: "C", suggested: false, sends: 0 }],
      ["Career fair", undefined],
    ]);
    // A template outside the experiment carries no arm at all.
    expect(options.find((o) => o.id === other)).not.toHaveProperty("arm");

    await sends(a, 1);
    expect(await suggested()).toEqual(["B"]);
    await sends(b, 1);
    expect(await suggested()).toEqual(["C"]);
    await sends(c, 1);
    expect(await suggested()).toEqual(["A"]);
    await sends(a, 2);
    await sends(b, 1);
    expect(await suggested(OWNER)).toEqual(["C"]);
    // Sends to a template outside the experiment change nothing.
    await sends(other, 5);
    expect(await suggested()).toEqual(["C"]);
  });

  it("counts every send since the start, even one too young to count toward a rate, and none from before", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    // The original had a long history before the experiment: it is not "ahead" in sends.
    await sends(a, 12, { days: 40 });
    expect((await templates.activeTemplates(OFFICER)).find((o) => o.arm?.suggested)?.arm?.label).toBe("A");
    await sends(b, 1);
    await sends(c, 1);
    const options = await templates.activeTemplates(OFFICER);
    expect(options.map((o) => o.arm?.sends)).toEqual([0, 1, 1]);
    expect(options.find((o) => o.arm?.suggested)?.arm?.label).toBe("A");
  });

  it("does not suggest anything once the experiment has ended, and other workspaces see nothing", async () => {
    const started = await start(base);
    expect((await templates.activeTemplates(OTHER_ORG)).some((o) => o.arm)).toBe(false);
    await endExperiment(OWNER, started.experimentId, base);
    expect((await templates.activeTemplates(OFFICER)).some((o) => o.arm)).toBe(false);
  });
});

describe("the experiment verdict", () => {
  // Counted sends and replies as the scorecard would tally them (every send old enough).
  const arm = (label: string, replies: number, counted: number, sent = counted) => ({ label, stat: rate({ sent, counted, replies } satisfies Tally) });

  it.each([
    ["no arms", [], "too_early", null, "Too early to tell"],
    ["one arm is not rated yet", [arm("A", 10, 19), arm("B", 20, 40)], "too_early", null, "Too early to tell"],
    ["an arm with only young sends", [arm("A", 0, 0, 30), arm("B", 20, 40)], "too_early", null, "Too early to tell"],
    ["every arm rated, ranges overlap", [arm("A", 20, 40), arm("B", 22, 40)], "no_difference", null, "No clear difference yet"],
    ["B is wholly above A", [arm("A", 4, 40), arm("B", 32, 40)], "ahead", "B", "B is ahead"],
    ["A is wholly above B", [arm("A", 36, 40), arm("B", 10, 40)], "ahead", "A", "A is ahead"],
    ["the original is ahead of both variants", [arm("A", 36, 40), arm("B", 8, 40), arm("C", 10, 40)], "ahead", "A", "A is ahead"],
    ["C clears A but not B", [arm("A", 6, 40), arm("B", 28, 40), arm("C", 36, 40)], "no_difference", null, "No clear difference yet"],
    ["C clears both", [arm("A", 4, 40), arm("B", 8, 40), arm("C", 36, 40)], "ahead", "C", "C is ahead"],
    ["the same rate in every arm", [arm("A", 15, 30), arm("B", 15, 30), arm("C", 15, 30)], "no_difference", null, "No clear difference yet"],
    ["exactly twenty counted sends each is enough", [arm("A", 2, 20), arm("B", 19, 20)], "ahead", "B", "B is ahead"],
    ["nineteen is not", [arm("A", 2, 19), arm("B", 19, 20)], "too_early", null, "Too early to tell"],
  ])("%s", (_name, arms, status, leader, text) => {
    expect(experimentVerdict(arms)).toEqual({ status, leader, text });
  });

  it("is code only: reading it makes no AI call", async () => {
    fakeGemini();
    const started = await start(base);
    await getExperimentView(OFFICER);
    await getExperimentView(OWNER);
    expect(calls).toHaveLength(0);
    expect(started.experimentId).toBeTruthy();
  });
});

describe("getExperimentView", () => {
  it("is null with no experiment, for any workspace", async () => {
    expect(await getExperimentView(OWNER)).toBeNull();
    await start(base);
    expect(await getExperimentView(OTHER_ORG)).toBeNull();
  });

  it("shows each arm's sends since the start, counted by the scorecard's rules, for every member", async () => {
    const started = await start(base);
    const [a, b, c] = started.arms.map((arm) => arm.templateId);
    await setStart(started.experimentId, 60);
    // History from before the experiment is left out of every arm.
    await sends(a, 9, { days: 90, replies: 9 });
    // A: 25 counted, 5 replies, 3 still maturing. B: 25 counted, 20 replies. C: 8 counted (too few).
    await sends(a, 25, { days: 30, replies: 5 });
    await sends(a, 3, { days: 2 });
    await sends(b, 25, { days: 30, replies: 20 });
    await sends(c, 8, { days: 30, replies: 4 });

    for (const viewer of [OWNER, OFFICER]) {
      const view = await getExperimentView(viewer);
      expect(view).toMatchObject({ id: started.experimentId, status: "RUNNING", baseTemplateId: base, keptTemplateId: null, endedAt: null, suggested: "C" });
      expect(view?.arms.map((x) => [x.label, x.name, x.kind, x.kept, x.archived, x.stat.sent, x.stat.counted, x.stat.replies, x.stat.maturing, x.stat.status])).toEqual([
        ["A", "Alumni angle", "original", false, false, 28, 25, 5, 3, "rated"],
        ["B", "Alumni angle (B)", "ask", false, false, 25, 25, 20, 0, "rated"],
        ["C", "Alumni angle (C)", "shorter", false, false, 8, 8, 4, 0, "too_few"],
      ]);
      expect(view?.arms[0].stat.rate).toBeCloseTo(0.2, 6);
      expect(view?.arms[1].stat.interval?.low).toBeGreaterThan(0.6);
      // C is too few, so nobody is called ahead.
      expect(view?.verdict).toEqual({ status: "too_early", leader: null, text: "Too early to tell" });
    }
    // Once C is rated too, B's range clears A's but not C's, so nobody is called ahead.
    await sends(c, 12, { days: 30, replies: 6 });
    expect((await getExperimentView(OFFICER))?.verdict).toEqual({ status: "no_difference", leader: null, text: "No clear difference yet" });
  });

  it("calls an arm ahead only when its whole range clears the others", async () => {
    const started = await start(base, [B]);
    const [a, b] = started.arms.map((arm) => arm.templateId);
    await setStart(started.experimentId, 60);
    await sends(a, 30, { days: 30, replies: 4 });
    await sends(b, 30, { days: 30, replies: 22 });
    expect((await getExperimentView(OWNER))?.verdict).toEqual({ status: "ahead", leader: "B", text: "B is ahead" });
  });

  it("shows the last ended experiment, with the arm kept and only the sends from its own run", async () => {
    const started = await start(base, [B]);
    const [a, b] = started.arms.map((arm) => arm.templateId);
    await setStart(started.experimentId, 60);
    await sends(a, 25, { days: 30, replies: 5 });
    await sends(b, 25, { days: 30, replies: 20 });
    await endExperiment(OWNER, started.experimentId, b);
    // Sends after it ended belong to no experiment.
    await sends(b, 10, { days: 0 });

    const view = await getExperimentView(OFFICER);
    expect(view).toMatchObject({ id: started.experimentId, status: "ENDED", keptTemplateId: b, suggested: null, endedAt: expect.any(Date) });
    expect(view?.arms.map((x) => [x.label, x.kept, x.archived, x.stat.sent])).toEqual([
      ["A", false, true, 25],
      ["B", true, false, 25],
    ]);
    expect(view?.verdict.text).toBe("B is ahead");
  });

  it("prefers a running experiment to an ended one, and the latest ended one otherwise", async () => {
    const first = await start(base, [B]);
    await endExperiment(OWNER, first.experimentId, base);
    const second = await start(base, [C]);
    expect((await getExperimentView(OWNER))?.id).toBe(second.experimentId);
    await endExperiment(OWNER, second.experimentId, base);
    expect((await getExperimentView(OWNER))?.id).toBe(second.experimentId);
  });
});

describe("the Template Lab actions", () => {
  const propose = (userId: string, workspaceId = "a", templateId = base) => asUser(userId, () => proposeAction(null, form({ workspaceId, templateId })));
  const startForm = (variants: unknown, templateId = base) => form({ workspaceId: "a", templateId, variants: typeof variants === "string" ? variants : JSON.stringify(variants) });
  const end = (userId: string, experimentId: string, keepTemplateId: string, workspaceId = "a") =>
    asUser(userId, () => endAction(null, form({ workspaceId, experimentId, keepTemplateId })));

  it("runs the whole flow for an owner", async () => {
    fakeGemini(recorded(B, C));
    const proposed = await propose("ownerA");
    expect(proposed).toMatchObject({ ok: true, data: { variants: [B, C] } });
    const started = await asUser("ownerA", () => startAction(null, startForm([B, C])));
    expect(started).toMatchObject({ ok: true, data: { arms: [{ label: "A" }, { label: "B" }, { label: "C" }] } });
    if (!started.ok) return;
    expect(await end("ownerA", started.data.experimentId, started.data.arms[1].templateId)).toEqual({ ok: true, data: undefined });
  });

  it("refuses an officer on every one of them, and another workspace's owner, and a signed-out visitor", async () => {
    fakeGemini(recorded(B));
    expect(await propose("officerA")).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    expect(await asUser("officerA", () => startAction(null, startForm([B])))).toEqual({ ok: false, error: "Only the workspace owner can do that." });
    const started = await start(base);
    expect(await end("officerA", started.experimentId, base)).toEqual({ ok: false, error: "Only the workspace owner can do that." });

    expect(await propose("ownerB")).toEqual({ ok: false, error: "You are not a member of this workspace." });
    expect(await asUser("ownerB", () => startAction(null, startForm([B])))).toEqual({ ok: false, error: "You are not a member of this workspace." });
    expect(await end("ownerB", started.experimentId, base)).toEqual({ ok: false, error: "You are not a member of this workspace." });

    await expect(signedOut(() => proposeAction(null, form({ workspaceId: "a", templateId: base })))).rejects.toEqual(redirectTo("/signin"));
    await expect(signedOut(() => startAction(null, startForm([B])))).rejects.toEqual(redirectTo("/signin"));
    await expect(signedOut(() => endAction(null, form({ workspaceId: "a", experimentId: started.experimentId, keepTemplateId: base })))).rejects.toEqual(redirectTo("/signin"));
    expect(calls).toHaveLength(0);
    expect((await experiments())[0].status).toBe("RUNNING");
  });

  it("refuses ids from another workspace, even for its own owner", async () => {
    fakeGemini(recorded(B));
    await prisma.workspace.update({ where: { id: "b" }, data: { aiEnabled: true } });
    const theirs = await template(OTHER_ORG, "Theirs");
    // ownerB acts on workspace b with workspace a's template id: not found.
    expect(await propose("ownerB", "b", base)).toEqual({ ok: false, error: TEMPLATE_GONE });
    expect(await asUser("ownerB", () => startAction(null, form({ workspaceId: "b", templateId: base, variants: JSON.stringify([B]) })))).toEqual({ ok: false, error: TEMPLATE_GONE });
    // ownerA acts on workspace a with workspace b's template id: not found.
    expect(await propose("ownerA", "a", theirs)).toEqual({ ok: false, error: TEMPLATE_GONE });
    const started = await start(base);
    expect(await end("ownerB", started.experimentId, base, "b")).toEqual({ ok: false, error: "That experiment isn't running." });
    expect(await end("ownerA", started.experimentId, theirs)).toEqual({ ok: false, error: "Pick one of the experiment's templates." });
    expect(calls).toHaveLength(0);
  });

  it("refuses bad input with a message", async () => {
    expect(await asUser("ownerA", () => startAction(null, startForm("not json")))).toEqual({ ok: false, error: "Pick one or two variants to try." });
    expect(await asUser("ownerA", () => startAction(null, startForm([])))).toEqual({ ok: false, error: expect.any(String) });
    expect(await asUser("ownerA", () => startAction(null, startForm([B, C, B])))).toEqual({ ok: false, error: expect.any(String) });
    expect(await asUser("ownerA", () => startAction(null, startForm([{ kind: "rewrite", summary: "x", body: BODY }])))).toEqual({ ok: false, error: expect.any(String) });
    expect(await asUser("ownerA", () => startAction(null, startForm([{ ...B, body: "a\0b" }])))).toEqual({ ok: false, error: "This text has a character Coppice can't save." });
    expect(await asUser("ownerA", () => proposeAction(null, form({ workspaceId: "a" })))).toEqual({ ok: false, error: "Template not found." });
    expect(await asUser("ownerA", () => endAction(null, form({ workspaceId: "a" })))).toEqual({ ok: false, error: "Pick the template to keep." });
    expect(await experiments()).toEqual([]);
  });

  it("starts from the variants as the browser sends them back, and checks them again", async () => {
    const tampered = { ...B, body: B.body.replace("Could we set up a short call?", "Could we set up a short call? Email me at dana@riverbend.org.") };
    expect(await asUser("ownerA", () => startAction(null, startForm([tampered])))).toMatchObject({ ok: false, error: expect.stringContaining("no longer passes") });
    expect(await templateRows()).toHaveLength(1);
  });

  it.each([
    ["AI off", async () => prisma.workspace.update({ where: { id: "a" }, data: { aiEnabled: false } }), "AI is turned off for this workspace. An owner can turn it on in Settings."],
  ])("passes on the AI's own message: %s", async (_name, change, message) => {
    await change();
    fakeGemini(recorded(B));
    expect(await propose("ownerA")).toEqual({ ok: false, error: message });
  });
});
