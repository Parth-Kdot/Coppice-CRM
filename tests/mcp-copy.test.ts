import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURES, TRUST } from "@/components/landing/copy";
import { GUIDE } from "@/lib/copilot/guide";
import { READ_SCOPE, SCOPE_LABELS, WRITE_SCOPE } from "@/lib/mcp/config";
import { MCP_LIMITS } from "@/lib/mcp/rate-limit";
import { READ_ONLY } from "@/lib/mcp/tools";

// The sentences people read about assistants (the consent page, Settings, the README, the landing
// page and the product guide) describe the whole tool set, say where every change is listed, and
// follow the writing rules. These are plain text checks: no database.

// The two vendor names the project keeps out of the repository, built at run time so this file
// never spells them.
const vendorNames = new RegExp(
  [[67, 108, 97, 117, 100, 101], [65, 110, 116, 104, 114, 111, 112, 105, 99]].map((codes) => String.fromCharCode(...codes)).join("|"),
  "i",
);

const readme = readFileSync("README.md", "utf8");
// The words of a part of a page's source: the text between two markers, without tags or code.
const words = (path: string, from: string, to: string) => {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(from);
  expect(start, `${path} has ${from}`).toBeGreaterThan(-1);
  return source
    .slice(start, source.indexOf(to, start))
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\s+/g, " ");
};
// Settings: the AI assistants section, and the privacy paragraph above it that mentions assistants.
const settingsSource = words("app/(app)/[workspaceId]/settings/page.tsx", 'summary="AI assistants (MCP)"', "{isOwner && (\n          <Disclosure summary=\"Workspace\"");
const consentSource = words("app/(auth)/oauth/consent/page.tsx", 'className="lg-consent-note"', "<ConsentButtons");
const assistantsGuide = GUIDE.find((t) => t.id === "assistants")!.body.join(" ");
const assistantsReadme = readme.slice(readme.indexOf("### Assistants"), readme.indexOf("###", readme.indexOf("### Assistants") + 5));
const featureCard = FEATURES.items.find((i) => i.icon === "assistants")!;
const trustLine = TRUST.items.find((i) => i.title.startsWith("Coppice's AI does not change your pipeline"))!.body;

const sentences: [string, string][] = [
  ["read scope label", SCOPE_LABELS[READ_SCOPE]],
  ["write scope label", SCOPE_LABELS[WRITE_SCOPE]],
  ["read-only message", READ_ONLY],
  ["guide topic", assistantsGuide],
  ["README section", assistantsReadme],
  ["landing feature card", `${featureCard.short} ${featureCard.detail}`],
  ["landing trust line", trustLine],
  ["Settings section", settingsSource],
  ["consent page", consentSource],
];

describe("what people are told about assistants", () => {
  it.each(sentences)("%s follows the writing rules", (_name, text) => {
    expect(text).not.toMatch(/[—–→]|->/);
    expect(text).not.toMatch(/ \+ | = /);
    expect(text).not.toMatch(vendorNames);
    expect(text).not.toMatch(/it's not [^.]*, it's/i);
  });

  it("the scope labels name everything the tools do, and only say deletes happen after the person agrees", () => {
    const read = SCOPE_LABELS[READ_SCOPE];
    for (const word of ["companies", "contacts", "notes", "outreach", "claims", "queue", "members' names", "facts", "templates", "stats", "research briefs", "handoff"]) {
      expect(read, word).toContain(word);
    }
    const write = SCOPE_LABELS[WRITE_SCOPE];
    for (const word of ["companies and contacts", "claim and release", "log outreach", "follow-up dates", "stages", "duplicates", "import", "facts", "templates", "research pages", "experiments", "handoff", "Permanent deletes happen only after you agree"]) {
      expect(write, word).toContain(word);
    }
  });

  it("says where every change is listed, in each place that describes what assistants do", () => {
    for (const [name, text] of [
      ["consent page", consentSource],
      ["Settings section", settingsSource],
      ["README section", assistantsReadme],
      ["landing feature card", featureCard.detail],
      ["landing trust line", trustLine],
      ["guide topic", assistantsGuide],
    ] as const) {
      expect(text, name).toMatch(/listed (below|in Settings|for the whole)/);
    }
    expect(settingsSource).toContain("Every member sees this list, with each assistant&apos;s name.");
    expect(settingsSource).toContain("Only you see this list.");
    expect(readme).toContain("the list of what assistants changed");
  });

  it("says via assistant only of claims, outreach and stage moves", () => {
    for (const [name, text] of sentences) {
      for (const sentence of text.split(/(?<=[.!?])\s+/).filter((s) => /via assistant/i.test(s))) {
        expect(sentence, `${name}: ${sentence}`).toMatch(/claims|outreach|stage/i);
      }
    }
  });

  it("keeps what an assistant cannot do true in Settings, the README and the guide", () => {
    for (const text of [settingsSource, assistantsReadme]) {
      expect(text).toMatch(/cannot (change members|invite)/);
      expect(text).toMatch(/Permanent deletes/i);
    }
    expect(assistantsGuide).toContain("It cannot change members, roles, invitations, the claim window, the AI settings or the assistants switch.");
    // The README names what really asks first.
    for (const word of ["verifying a fact", "starting or ending an experiment", "Committed or Declined", "importing a CSV", "publish the handoff", "releasing someone else's claim"]) {
      expect(assistantsReadme, word).toContain(word);
    }
    expect(assistantsGuide).toContain(`${MCP_LIMITS.read} reads and ${MCP_LIMITS.action} changes a minute`);
    expect(trustLine).toContain("Coppice's own AI");
  });
});
