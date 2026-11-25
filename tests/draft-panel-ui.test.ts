import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DraftLetters, DraftPanel } from "@/components/draft-panel";
import type { DraftView } from "@/lib/drafts";

// The letters area under "Draft an email", rendered on the server. What matters here is what holds
// the page still while drafts are written: the wait line's slot, the placeholder cards, and that
// earlier letters stay on screen. The heights themselves live in company.css and were measured in
// a browser.

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({
    refresh() {},
    push() {},
    replace() {},
    prefetch() {},
    back() {},
    forward() {},
  }),
}));
vi.mock("@/components/ledger/providers", () => ({
  useNotify: () => vi.fn(),
  useConfirm: () => async () => true,
}));
vi.mock("@/components/ledger/focus", () => ({ focusSoon: vi.fn() }));

const draft = (n: number): DraftView => ({
  id: `d${n}`,
  kind: "FIRST_TOUCH",
  angle: `Angle ${n}`,
  subject: `Subject ${n}`,
  body: `Hi Elena,\n\nBody ${n}.\n\nDana`,
  to: "elena@lumenfield.example.com",
  createdAt: new Date("2026-11-20T15:00:00Z"),
  check: null,
});

const unused = async () => ({ ok: false as const, error: "not used" });

const props = {
  workspaceId: "w",
  companyId: "c",
  contacts: [],
  hasOutreach: false,
  factCount: 0,
  usage: { used: 0, limit: 300 },
  daily: { used: 0, limit: 40 },
  initialDrafts: [],
  today: "2026-11-25",
  rules: { factNumbers: [], website: null },
  actions: { draft: unused, check: unused, logOutreach: unused },
};

function render(pending: boolean, drafts: DraftView[]) {
  return renderToStaticMarkup(
    createElement(DraftLetters, { ...props, pending, drafts }),
  );
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("DraftLetters", () => {
  it("draws nothing before the first Draft click", () => {
    expect(render(false, [])).toBe("");
  });

  it("holds the letters' place with two hidden placeholder cards while the first drafts are written", () => {
    const html = render(true, []);
    expect(
      count(html, /class="lg-letter lg-letter-wait" aria-hidden="true"/g),
    ).toBe(2);
    expect(count(html, /role="status"/g)).toBe(1);
    // The wait line sits in the slot above the cards, never inside a hidden card, so screen
    // readers still hear it.
    expect(html).toMatch(
      /^<div class="lg-letters-slot"><div class="lg-quill-wait" role="status">.*Writing two drafts/,
    );
    expect(html).not.toMatch(
      /aria-hidden="true"[^>]*>[^<]*<div class="lg-quill-wait"/,
    );
    expect(html).not.toContain("<h3");
  });

  it("keeps earlier letters readable and usable while new ones are written, the wait line in its slot", () => {
    const html = render(true, [draft(1), draft(2)]);
    expect(html).toMatch(
      /^<div class="lg-letters-slot"><div class="lg-quill-wait" role="status">/,
    );
    expect(count(html, /<article class="lg-letter"/g)).toBe(2);
    expect(html).toContain("Angle 1");
    expect(html).toContain("Angle 2");
    expect(html).not.toContain("lg-letter-wait");
    // The copy buttons and the subject box are still there to use.
    expect(count(html, />Subject<\/button>/g)).toBe(2);
    expect(html).toContain('value="Subject 1"');
  });

  it("keeps the slot, empty, once the letters are in, so the letters don't move when the line goes", () => {
    const html = render(false, [draft(1), draft(2)]);
    expect(html).toMatch(
      /^<div class="lg-letters-slot"><\/div><div class="lg-letters">/,
    );
    expect(html).not.toContain("lg-quill-wait");
    expect(count(html, /<article class="lg-letter"/g)).toBe(2);
  });

  it("never writes a style attribute (strict CSP)", () => {
    for (const html of [
      render(true, []),
      render(true, [draft(1), draft(2)]),
      render(false, [draft(1), draft(2)]),
    ]) {
      expect(html).not.toMatch(/\sstyle=/);
    }
  });

  it("gives the Draft button both labels in one cell, so it keeps its width when drafting starts", () => {
    const html = renderToStaticMarkup(createElement(DraftPanel, props));
    expect(html).toContain(
      '<span class="lg-btn-stack"><span data-shown="true">Draft two emails</span><span data-shown="false">Drafting...</span></span>',
    );
    expect(html).not.toMatch(/\sstyle=/);
  });
});
