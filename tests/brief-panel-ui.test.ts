import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BriefPanel } from "@/components/brief-panel";
import type { BriefView } from "@/lib/research/brief";

// The "Who to contact" card's sections, rendered on the server: what each section shows, when it
// draws nothing, and which empty-brief line appears. Asking for a brief and "Add to notes" are
// checked end to end in tests/research.test.ts.

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/ledger/providers", () => ({ useNotify: () => () => {}, useConfirm: () => async () => true }));
// A plain stand-in for ActionForm, so the hidden inputs and the button are what is checked.
vi.mock("@/components/action-form", () => ({
  ActionForm: (props: { submitLabel: string; children?: unknown }) =>
    createElement("form", { "data-form": "add" }, props.children as never, createElement("button", { type: "submit" }, props.submitLabel)),
}));

const PAGE = "https://acme.org/community";
const where = { page: 1, url: PAGE, accepted: false };

const brief = (over: Partial<BriefView> = {}): BriefView => ({
  id: "b1",
  status: "READY",
  createdAt: new Date("2026-11-20T12:00:00Z"),
  createdBy: "Dana",
  items: [],
  inboxes: [],
  ties: [],
  flags: [],
  hook: null,
  ask: null,
  pages: [{ position: 1, url: PAGE, finalUrl: PAGE, fetchedAt: new Date("2026-11-20T12:00:00Z"), skipped: null, injection: [] }],
  newer: null,
  ...over,
});
const tie = { id: "t1", title: "Purdue design challenge", detail: "A spring challenge with Purdue University.", quote: "Acme partners with Purdue University.", ...where };
const flag = { id: "r1", kind: "TIMING" as const, title: "Spring grants close March 1", quote: "Applications for spring grants close March 1, 2027.", ...where };
const hook = { id: "h1", line: "Acme opened a plant in Lafayette in 2024.", quote: "Acme opened a new plant in Lafayette in 2024.", ...where };
const ask = { id: "a1", factId: "f1", factText: "Gold Tier ($2,500)", reason: "Acme backs hackathons.", quote: "Acme supports hackathons.", changed: false, old: false, ...where };
const door = { id: "i1", door: "GIVING" as const, title: "Giving portal", detail: "Send requests.", deadline: null, quote: "The portal takes requests.", ...where };

const noop = async () => ({ ok: true as const, data: undefined });
const draw = (view: BriefView, extra: { isOwner?: boolean; hasTierFacts?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(BriefPanel, {
      workspaceId: "w1",
      companyId: "c1",
      sources: [{ id: "s1", label: "Acme community", host: "acme.org", url: PAGE, suggested: true }],
      isOwner: extra.isOwner ?? false,
      hasTierFacts: extra.hasTierFacts ?? true,
      usage: { used: 2, limit: 300 },
      initialBrief: view,
      actions: { request: async () => ({ ok: false as const, error: "x" }), accept: noop },
    }),
  );
const count = (html: string, text: string) => html.split(text).length - 1;

describe("the brief's sections", () => {
  it("shows each section with its quote, its page link and an Add to notes", () => {
    const html = draw(brief({ ties: [tie], flags: [flag], hook, ask }));
    for (const [heading, quote] of [
      ["Campus ties", tie.quote],
      ["Red flags", flag.quote],
      ["Outreach hook", hook.quote],
      ["Suggested ask", ask.quote],
    ]) {
      expect(html).toContain(heading);
      expect(html).toContain(`“${quote}”`);
    }
    expect(count(html, `href="${PAGE}"`)).toBeGreaterThanOrEqual(4);
    expect(count(html, "Add to notes")).toBe(4);
    for (const id of ["t1", "r1", "h1", "a1"]) expect(html).toContain(`name="itemId" value="${id}"`);
    expect(html).toContain("Deadline or window");
    expect(html).toContain("Gold Tier ($2,500)");
    expect(html).toContain("Verified fact");
    // A flag quotes a deadline; it never says whether it has passed.
    expect(html).not.toMatch(/has passed|is closed|closed already/i);
  });

  it("draws nothing for an empty section", () => {
    const html = draw(brief({ items: [door] }));
    for (const heading of ["Campus ties", "Red flags", "Outreach hook", "Suggested ask"]) expect(html).not.toContain(heading);
  });

  it("a changed ask shows its line and no Add to notes; an old one shows the stale badge", () => {
    const changed = draw(brief({ ask: { ...ask, changed: true } }));
    expect(changed).toContain("The tier this ask named changed or is no longer verified. Ask for a new brief.");
    expect(changed).not.toContain('value="a1"');
    expect(changed).toContain("Tier fact, since changed");
    expect(changed).not.toContain("Verified fact");
    const old = draw(brief({ ask: { ...ask, old: true } }));
    expect(old).toContain("Over a year old");
    expect(old).toContain('value="a1"');
    expect(draw(brief({ ask }))).not.toContain("Over a year old");
  });

  it("with no door but a flag, says no door was found instead of the nothing-checked-out line", () => {
    const html = draw(brief({ flags: [flag] }));
    expect(html).toContain("No door was found on these pages.");
    expect(html).not.toContain("Nothing on these pages checked out");
  });

  it("with every section empty, shows the nothing-checked-out line", () => {
    const html = draw(brief());
    expect(html).toContain("Nothing on these pages checked out as a way in. Try other pages.");
    expect(html).not.toContain("No door was found");
  });

  it("with no tier facts, an owner gets a link to the fact sheet and an officer plain text", () => {
    const owner = draw(brief({ items: [door] }), { isOwner: true, hasTierFacts: false });
    expect(owner).toMatch(/<a[^>]*href="\/w1\/facts"[^>]*>Verify a tier on the fact sheet to get a suggested ask<\/a>/);
    const officer = draw(brief({ items: [door] }), { isOwner: false, hasTierFacts: false });
    expect(officer).toContain("An owner can verify a tier on the fact sheet to get a suggested ask.");
    expect(officer).not.toContain('href="/w1/facts"');
  });
});
