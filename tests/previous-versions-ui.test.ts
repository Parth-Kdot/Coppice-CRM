import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviousVersions } from "@/components/ledger/company/previous-versions";
import { previousItems, valueDigest, type PreviousVersionRow } from "@/lib/previous-versions";
import { PREVIOUS_VERSION_MS, replacedLine, type PreviousItem } from "@/lib/previous-versions-copy";

// The previous versions list on the company page, rendered on the server: the wording of each line,
// what the button is called, and when a row is not drawn. The form's own behavior (pending, errors,
// focus) is ActionForm's and is checked with the other forms.

const notify = vi.fn();
const focusSoon = vi.fn();
const forms: { action: (prev: null, form: FormData) => Promise<unknown>; submitAriaLabel?: string; focusAfter?: string; quietError?: boolean }[] = [];

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/ledger/providers", () => ({ useNotify: () => notify, useConfirm: () => async () => true }));
vi.mock("@/components/ledger/focus", () => ({ focusSoon: (target: unknown) => focusSoon(target) }));
// A plain stand-in for ActionForm, so the row's own wiring is what is checked: its action, its button
// name, and the hidden inputs.
vi.mock("@/components/action-form", () => ({
  ActionForm: (props: { action: (prev: null, form: FormData) => Promise<unknown>; submitLabel: string; submitAriaLabel?: string; focusAfter?: string; quietError?: boolean; className?: string; children?: unknown }) => {
    forms.push(props);
    return createElement("form", { className: props.className }, props.children as never, createElement("button", { type: "submit", "aria-label": props.submitAriaLabel }, props.submitLabel));
  },
}));

const item = (over: Partial<PreviousItem> = {}): PreviousItem => ({
  versionId: "v1",
  field: "WEBSITE",
  contactId: null,
  label: "Website",
  value: "acme.com",
  long: false,
  ageMs: 12.5 * 60_000,
  exactTime: "Nov 16, 2026, 3:42 PM",
  byName: "Sam",
  byAssistant: false,
  mine: false,
  expected: "e".repeat(64),
  restoreLabel: "Restore the previous website",
  focusAfter: ".lg-company h1",
  ...over,
});
const ids = { workspaceId: "w1", companyId: "c1" };
const restore = vi.fn(async () => ({ ok: true as const, data: undefined }));
const draw = (items: PreviousItem[], extra: { boxed?: boolean; defaultOpen?: boolean } = {}) =>
  renderToStaticMarkup(createElement(PreviousVersions, { items, ids, restore, boxed: extra.boxed ?? false, drawnAt: 1, defaultOpen: extra.defaultOpen }));

beforeEach(() => {
  notify.mockClear();
  focusSoon.mockClear();
  forms.length = 0;
});

describe("the list", () => {
  it("says how long ago, and by whom", () => {
    expect(draw([item()])).toContain("Previous version, replaced 12 min ago by Sam");
  });

  it("reads just now, you, an assistant and your assistant", () => {
    expect(draw([item({ ageMs: 20_000, mine: true })])).toContain("Previous version, replaced just now by you");
    expect(draw([item({ byAssistant: true })])).toContain("replaced 12 min ago by Sam&#x27;s assistant");
    expect(draw([item({ byAssistant: true, mine: true })])).toContain("replaced 12 min ago by your assistant");
  });

  it("puts the exact time in the line's tooltip", () => {
    expect(draw([item()])).toContain('title="Nov 16, 2026, 3:42 PM"');
  });

  it("reads Empty for an empty previous value", () => {
    expect(draw([item({ value: null })])).toContain("Empty");
  });

  it("puts long notes in a disclosure, and short values straight in the page", () => {
    const long = draw([item({ label: "Notes", value: "line one\nline two", long: true })]);
    expect(long).toContain("<details");
    expect(long).toContain("Show the previous notes");
    expect(long).toContain("line one\nline two");
    expect(draw([item()])).not.toContain("<details");
  });

  it("names the button and carries the six hidden inputs", () => {
    const html = draw([item({ restoreLabel: "Restore Sam Lee's previous email" })]);
    expect(html).toContain('aria-label="Restore Sam Lee&#x27;s previous email"');
    for (const name of ["workspaceId", "companyId", "versionId", "expected", "field", "contactId"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('value="v1"');
    expect(html).toContain(`value="${"e".repeat(64)}"`);
    expect(html).toContain(">Restore<");
  });

  it("draws nothing for a row at exactly one hour, or a list of only such rows", () => {
    expect(draw([item({ ageMs: PREVIOUS_VERSION_MS })])).toBe("");
    expect(draw([item({ ageMs: PREVIOUS_VERSION_MS + 1 }), item({ versionId: "v2", ageMs: PREVIOUS_VERSION_MS })], { boxed: true })).toBe("");
    expect(draw([item({ ageMs: PREVIOUS_VERSION_MS - 1 })])).toContain("Previous version");
  });

  it("boxed: a Previous versions disclosure with the count, open when asked", () => {
    const closed = draw([item(), item({ versionId: "v2", label: "Industry", value: "Tech" })], { boxed: true });
    expect(closed).toContain("Previous versions");
    expect(closed).toContain(">2<");
    expect(closed).not.toContain("<details open");
    expect(draw([item()], { boxed: true, defaultOpen: true })).toContain("<details");
    expect(draw([item()], { boxed: true, defaultOpen: true })).toMatch(/<details[^>]* open/);
  });

  it("a refusal is written as a margin note in the error tone, and focus goes to where a restore sends it", async () => {
    draw([item()]);
    const { action, focusAfter } = forms[0];
    restore.mockResolvedValueOnce({ ok: false as never, error: "That previous version is no longer kept." } as never);
    const result = await action(null, new FormData());
    expect(result).toEqual({ ok: false, error: "That previous version is no longer kept." });
    expect(notify).toHaveBeenCalledWith("That previous version is no longer kept.", "error");
    expect(focusSoon).toHaveBeenCalledWith(focusAfter);
  });

  it("a refusal is not written a second time under the button", () => {
    draw([item()]);
    expect(forms[0].quietError).toBe(true);
  });

  it("a success is left to the form's own note: no error note, no focus move from the row", async () => {
    draw([item()]);
    expect(await forms[0].action(null, new FormData())).toEqual({ ok: true, data: undefined });
    expect(notify).not.toHaveBeenCalled();
    expect(focusSoon).not.toHaveBeenCalled();
  });
});

describe("replacedLine", () => {
  it.each([
    [0, "just now"],
    [59_999, "just now"],
    [60_000, "1 min ago"],
    [59 * 60_000 + 59_000, "59 min ago"],
  ])("age %i ms reads %s", (ageMs, text) => {
    expect(replacedLine({ byName: "Sam", byAssistant: false, mine: false }, ageMs)).toBe(`Previous version, replaced ${text} by Sam`);
  });
});

describe("previousItems", () => {
  const now = new Date("2026-11-16T20:00:00Z");
  const row = (over: Partial<PreviousVersionRow>): PreviousVersionRow => ({
    id: "r",
    contactId: null,
    field: "NOTES",
    value: "old",
    via: "APP",
    replacedAt: new Date(now.getTime() - 10 * 60_000),
    replacedById: "u1",
    replacedByName: "Sam",
    ...over,
  });
  const current = {
    company: { name: "Acme", industry: null, website: "acme.com", notes: "now" },
    contacts: [{ id: "ct1", name: "Sam Lee", email: "sam@acme.com", title: null }],
  };

  it("orders the company's fields name, industry, website, notes and each contact's name, email, title", () => {
    const rows = [
      row({ id: "n", field: "NOTES" }),
      row({ id: "w", field: "WEBSITE" }),
      row({ id: "i", field: "INDUSTRY" }),
      row({ id: "a", field: "NAME" }),
      row({ id: "t", field: "TITLE", contactId: "ct1" }),
      row({ id: "e", field: "EMAIL", contactId: "ct1" }),
    ];
    const items = previousItems(rows, current, "u1", now);
    expect(items.company.map((i) => i.versionId)).toEqual(["a", "i", "w", "n"]);
    expect(items.contacts.ct1.map((i) => i.versionId)).toEqual(["e", "t"]);
  });

  it("marks long notes: over 140 characters or with a line break, notes only", () => {
    const longOf = (field: PreviousVersionRow["field"], value: string) => previousItems([row({ id: "x", field, value })], current, "u1", now).company[0].long;
    expect(longOf("NOTES", "y".repeat(141))).toBe(true);
    expect(longOf("NOTES", "a\nb")).toBe(true);
    expect(longOf("NOTES", "y".repeat(140))).toBe(false);
    expect(longOf("NAME", "x".repeat(300))).toBe(false);
    expect(longOf("WEBSITE", "a\nb")).toBe(false);
  });

  it("knows which are the viewer's, and opens the box for anyone who made one of the company's changes", () => {
    expect(previousItems([row({ replacedById: "u1" })], current, "u1", now).mine).toBe(true);
    expect(previousItems([row({ replacedById: "u2" })], current, "u1", now).mine).toBe(false);
    expect(previousItems([row({ contactId: "ct1", field: "TITLE" })], current, "u1", now).mine).toBe(false);
  });

  it("carries the digest of the current value, the age, the assistant mark and the labels", () => {
    const items = previousItems([row({ id: "w", field: "WEBSITE", via: "ASSISTANT" }), row({ id: "i", field: "INDUSTRY", value: null }), row({ id: "e", field: "EMAIL", contactId: "ct1" })], current, "u1", now);
    const website = items.company.find((i) => i.versionId === "w")!;
    expect(website).toMatchObject({ expected: valueDigest("acme.com"), ageMs: 10 * 60_000, byAssistant: true, restoreLabel: "Restore the previous website", focusAfter: ".lg-company h1" });
    expect(items.company.find((i) => i.versionId === "i")).toMatchObject({ expected: valueDigest(null), restoreLabel: "Restore the previous industry (empty)" });
    expect(items.contacts.ct1[0]).toMatchObject({ restoreLabel: "Restore Sam Lee's previous email", focusAfter: "#contact-ct1 .lg-omenu-btn", expected: valueDigest("sam@acme.com") });
  });

  it("an empty value and no value have different digests", () => {
    expect(valueDigest(null)).not.toBe(valueDigest(""));
    expect(valueDigest("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
