import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import {
  addContact,
  archiveAsDuplicate,
  archiveCompany,
  claimCompany,
  createCompany,
  forceRelease,
  logOutreach,
  moveStage,
  releaseClaim,
  removeContact,
  unarchiveCompany,
  updateCompany,
  updateContact,
} from "@/app/(app)/[workspaceId]/companies/actions";
import type { Membership } from "@/lib/authz";
import * as companies from "@/lib/companies";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { isWebAddress, websiteHref } from "@/lib/validation";
import { form, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

// Real server actions, real database as app_user. Only Next.js's request APIs are swapped.
vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const A: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const B: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };
const OK = { ok: true, data: undefined };
const NOT_OK = { ok: false, error: expect.any(String) };

const make = async (tenant: Tenant, name: string, extra: Partial<companies.CompanyFields> = {}) => {
  const result = await companies.createCompany(tenant, { name, ...extra });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
};
const row = (id: string) => withTenant(A, (tx) => tx.company.findUnique({ where: { id } }));
const contactsOf = (companyId: string) =>
  withTenant(A, (tx) => tx.contact.findMany({ where: { companyId }, select: { name: true, email: true, title: true } }));
const companyPage = (id: string) => `/a/companies/${id}`;
// Redirected to the page of a company that was just created (its id isn't known in advance).
const toNewCompany = expect.objectContaining({ digest: expect.stringMatching(/;\/a\/companies\/[a-z0-9]+;/) });

// The fields the edit form sends: what's in the boxes, plus "original.*" from when it loaded.
const editForm = (companyId: string, original: Record<string, string>, changes: Record<string, string>) =>
  form({
    workspaceId: "a",
    companyId,
    ...Object.fromEntries(Object.entries(original).map(([k, v]) => [`original.${k}`, v])),
    ...original,
    ...changes,
  });
const BLANK = { name: "", industry: "", website: "", notes: "" };

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("every company action refuses outsiders", () => {
  let acme: string;
  let contact: string;
  beforeEach(async () => {
    acme = await make(A, "Acme");
    const added = await companies.addContact(A, acme, { name: "Sam" });
    if (!added.ok) throw new Error("seed contact");
    contact = added.data.contactId;
  });

  const calls = (): [string, () => Promise<unknown>][] =>
    [
      ["createCompany", () => createCompany(null, form({ workspaceId: "a", name: "New Co" }))],
      ["updateCompany", () => updateCompany(null, editForm(acme, { ...BLANK, name: "Acme" }, { name: "Hacked" }))],
      ["archiveCompany", () => archiveCompany(null, form({ workspaceId: "a", companyId: acme }))],
      ["unarchiveCompany", () => unarchiveCompany(null, form({ workspaceId: "a", companyId: acme }))],
      ["archiveAsDuplicate", () => archiveAsDuplicate(null, form({ workspaceId: "a", companyId: acme, keepId: acme }))],
      ["moveStage", () => moveStage(null, form({ workspaceId: "a", companyId: acme, stage: "CONTACTED" }))],
      ["addContact", () => addContact(null, form({ workspaceId: "a", companyId: acme, name: "Eve" }))],
      ["updateContact", () => updateContact(null, form({ workspaceId: "a", companyId: acme, contactId: contact, name: "Eve" }))],
      ["removeContact", () => removeContact(null, form({ workspaceId: "a", companyId: acme, contactId: contact }))],
      ["claimCompany", () => claimCompany(null, form({ workspaceId: "a", companyId: acme }))],
      ["releaseClaim", () => releaseClaim(null, form({ workspaceId: "a", companyId: acme }))],
      ["forceRelease", () => forceRelease(null, form({ workspaceId: "a", companyId: acme }))],
      ["logOutreach", () => logOutreach(null, form({ workspaceId: "a", companyId: acme, channel: "EMAIL", followUpOn: "2026-12-01" }))],
    ];

  const unchanged = async () => {
    expect(await row(acme)).toMatchObject({ name: "Acme", stage: "NOT_CONTACTED", archivedAt: null, claimedById: null });
    expect(await withTenant(A, (tx) => tx.outreach.count())).toBe(0);
    expect(await withTenant(A, (tx) => tx.company.count())).toBe(1);
    expect(await contactsOf(acme)).toEqual([{ name: "Sam", email: null, title: null }]);
  };

  it("sends a signed-out visitor to /signin", async () => {
    for (const [, run] of calls()) await expect(signedOut(run)).rejects.toEqual(redirectTo("/signin"));
    await unchanged();
  });

  it("refuses a signed-in user from another workspace", async () => {
    for (const [, run] of calls()) expect(await asUser("ownerB", run)).toEqual(NOT_OK);
    await unchanged();
  });

  it("refuses workspace B's member who passes their own workspace id with A's company ids", async () => {
    const asB = (fields: Record<string, string>) => form({ ...fields, workspaceId: "b" });
    const results = await asUser("ownerB", () =>
      Promise.all([
        updateCompany(null, asB({ companyId: acme, "original.name": "Acme", name: "Hacked" })),
        archiveCompany(null, asB({ companyId: acme })),
        archiveAsDuplicate(null, asB({ companyId: acme, keepId: acme })),
        moveStage(null, asB({ companyId: acme, stage: "CONTACTED" })),
        addContact(null, asB({ companyId: acme, name: "Eve" })),
        updateContact(null, asB({ companyId: acme, contactId: contact, name: "Eve" })),
        removeContact(null, asB({ companyId: acme, contactId: contact })),
        claimCompany(null, asB({ companyId: acme })),
        releaseClaim(null, asB({ companyId: acme })),
        forceRelease(null, asB({ companyId: acme })),
        logOutreach(null, asB({ companyId: acme, channel: "EMAIL", followUpOn: "2026-12-01" })),
      ]),
    );
    for (const result of results) expect(result).toEqual(NOT_OK);
    await unchanged();
  });
});

describe("createCompany", () => {
  const create = (fields: Record<string, string>) => createCompany(null, form({ workspaceId: "a", ...fields }));

  it("saves the company and opens its page", async () => {
    await expect(asUser("officerA", () => create({ name: "  Acme  ", website: "acme.com", industry: "", notes: "" }))).rejects.toEqual(toNewCompany);
    expect(await withTenant(A, (tx) => tx.company.findFirst({ select: { name: true, website: true, industry: true, notes: true } }))).toEqual({
      name: "Acme",
      website: "acme.com",
      industry: null,
      notes: null,
    });
  });

  it("asks about a look-alike, then saves once the person says they're separate", async () => {
    const acme = await make(A, "Acme Corp", { website: "acme.com" });
    const first = await asUser("ownerA", () => create({ name: "ACME, Inc." }));
    expect(first).toEqual({
      ok: true,
      data: { status: "possible-duplicates", matches: [{ id: acme, name: "Acme Corp", website: "acme.com", archived: false, matchedOn: ["name"] }] },
    });
    await expect(asUser("ownerA", () => create({ name: "ACME, Inc.", separateFrom: acme }))).rejects.toEqual(toNewCompany);
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count())).toBe(1);
  });

  it("flags an archived look-alike too, so it can be unarchived instead", async () => {
    const old = await make(A, "Acme");
    await companies.archiveCompany(A, old);
    const result = await asUser("ownerA", () => create({ name: "acme" }));
    expect(result).toMatchObject({ ok: true, data: { status: "possible-duplicates", matches: [{ id: old, archived: true }] } });
    await expect(asUser("ownerA", () => unarchiveCompany(null, form({ workspaceId: "a", companyId: old })))).rejects.toEqual(
      redirectTo(companyPage(old)),
    );
    expect((await row(old))?.archivedAt).toBeNull();
  });

  test.for([
    [{ name: "" }, "Enter a company name."],
    [{ name: "   " }, "Enter a company name."],
    [{ name: "x".repeat(121) }, "Name can be at most 120 characters."],
    [{ name: "Acme", industry: "x".repeat(81) }, "Industry can be at most 80 characters."],
    [{ name: "Acme", notes: "x".repeat(5001) }, "Notes can be at most 5000 characters."],
    [{ name: "Acme", website: "javascript:alert(1)" }, "Enter a website like acme.com or https://acme.com."],
    [{ name: "Acme", website: "data:text/html,<script>alert(1)</script>" }, "Enter a website like acme.com or https://acme.com."],
    [{ name: "Acme", website: "ftp://acme.com" }, "Enter a website like acme.com or https://acme.com."],
    [{ name: "Acme", website: "not a website" }, "Enter a website like acme.com or https://acme.com."],
    [{ name: "Acme", separateFrom: Array.from({ length: 21 }, (_, i) => `id${i}`).join(",") }, expect.any(String)],
    [{ name: "Acme", workspaceId: "x".repeat(65) }, expect.any(String)],
  ] as const)("refuses %j before touching anything", async ([fields, error]) => {
    expect(await asUser("ownerA", () => create(fields))).toEqual({ ok: false, error });
    expect(await withTenant(A, (tx) => tx.company.count())).toBe(0);
  });

  test.for(["a'; DROP TABLE \"Company\"; --", "<script>alert(1)</script>", "Robert'); DELETE FROM contact; --"])(
    "stores the name %j as plain text",
    async (name) => {
      await expect(asUser("ownerA", () => create({ name }))).rejects.toEqual(toNewCompany);
      expect(await withTenant(A, (tx) => tx.company.findFirst({ select: { name: true } }))).toEqual({ name });
    },
  );
});

describe("updateCompany", () => {
  let acme: string;
  const loaded = { name: "Acme", industry: "Tech", website: "acme.com", notes: "" };
  beforeEach(async () => {
    acme = await make(A, "Acme", { industry: "Tech", website: "acme.com" });
  });
  const save = (changes: Record<string, string>, original = loaded, user = "ownerA", extra: Record<string, string> = {}) =>
    asUser(user, () => updateCompany(null, editForm(acme, original, { ...changes, ...extra })));

  it("saves only what changed", async () => {
    expect(await save({ notes: "Met at the fair" })).toEqual({ ok: true, data: { status: "saved", companyId: acme } });
    expect(await row(acme)).toMatchObject({ name: "Acme", industry: "Tech", notes: "Met at the fair" });
  });

  it("clears a field when its box is emptied", async () => {
    await save({ industry: "" });
    expect((await row(acme))?.industry).toBeNull();
  });

  it("reports a conflict when someone else changed the same field first, and keeps theirs", async () => {
    await save({ industry: "Finance" }, loaded, "officerA");
    expect(await save({ industry: "Energy" })).toEqual({
      ok: true,
      data: { status: "conflict", conflicts: [{ field: "industry", theirs: "Finance", yours: "Energy" }] },
    });
    expect((await row(acme))?.industry).toBe("Finance");
    // Saving again from the value they now see replaces it on purpose.
    expect(await save({ industry: "Energy" }, { ...loaded, industry: "Finance" })).toMatchObject({ data: { status: "saved" } });
    expect((await row(acme))?.industry).toBe("Energy");
  });

  it("asks before a rename makes it look like another company, then remembers 'separate'", async () => {
    const other = await make(A, "Globex");
    expect(await save({ name: "Globex Inc" })).toMatchObject({ ok: true, data: { status: "possible-duplicates", matches: [{ id: other }] } });
    expect((await row(acme))?.name).toBe("Acme");
    expect(await save({ name: "Globex Inc" }, loaded, "ownerA", { separateFrom: other })).toMatchObject({ data: { status: "saved" } });
    expect((await row(acme))?.name).toBe("Globex Inc");
  });

  it("refuses a bad website on edit", async () => {
    expect(await save({ website: "javascript:alert(1)" })).toEqual({ ok: false, error: "Enter a website like acme.com or https://acme.com." });
  });

  it("refuses a form without its original values", async () => {
    const tampered = form({ workspaceId: "a", companyId: acme, name: "Hacked" });
    expect(await asUser("ownerA", () => updateCompany(null, tampered))).toEqual({ ok: false, error: "Reload the page and try again." });
    expect((await row(acme))?.name).toBe("Acme");
  });

  it("says not found for a company id that doesn't exist", async () => {
    const missing = editForm("missing", loaded, { name: "X" });
    expect(await asUser("ownerA", () => updateCompany(null, missing))).toEqual({ ok: false, error: "Company not found." });
  });
});

describe("archive, unarchive and 'same company'", () => {
  let acme: string;
  const ref = (companyId: string) => form({ workspaceId: "a", companyId });
  beforeEach(async () => {
    acme = await make(A, "Acme");
  });

  it("archives (any member) and unarchives, and archiving twice says not found", async () => {
    expect(await asUser("officerA", () => archiveCompany(null, ref(acme)))).toEqual(OK);
    expect((await row(acme))?.archivedAt).toBeInstanceOf(Date);
    expect(await asUser("officerA", () => archiveCompany(null, ref(acme)))).toEqual({ ok: false, error: "Company not found." });
    await expect(asUser("officerA", () => unarchiveCompany(null, ref(acme)))).rejects.toEqual(redirectTo(companyPage(acme)));
    expect(await asUser("officerA", () => unarchiveCompany(null, ref(acme)))).toEqual({ ok: false, error: "Company not found." });
  });

  it("refuses a malformed id", async () => {
    expect(await asUser("ownerA", () => archiveCompany(null, ref("")))).toEqual({ ok: false, error: "Company not found." });
    expect(await asUser("ownerA", () => unarchiveCompany(null, ref("")))).toEqual({ ok: false, error: "Company not found." });
  });

  it("'same company' archives the one being edited and opens the one kept", async () => {
    const keep = await make(A, "Globex");
    const same = form({ workspaceId: "a", companyId: acme, keepId: keep });
    await expect(asUser("ownerA", () => archiveAsDuplicate(null, same))).rejects.toEqual(redirectTo(companyPage(keep)));
    expect((await row(acme))?.archivedAt).toBeInstanceOf(Date);
    expect((await row(keep))?.archivedAt).toBeNull();
  });

  it("'same company' refuses when the one to keep is archived, or ids are bad", async () => {
    const keep = await make(A, "Globex");
    await companies.archiveCompany(A, keep);
    expect(await asUser("ownerA", () => archiveAsDuplicate(null, form({ workspaceId: "a", companyId: acme, keepId: keep })))).toEqual(NOT_OK);
    expect(await asUser("ownerA", () => archiveAsDuplicate(null, form({ workspaceId: "a", companyId: acme })))).toEqual(NOT_OK);
    expect((await row(acme))?.archivedAt).toBeNull();
  });
});

describe("moveStage", () => {
  const move = (companyId: string, stage: string) => asUser("officerA", () => moveStage(null, form({ workspaceId: "a", companyId, stage })));

  it("moves the stage and records who did it", async () => {
    const acme = await make(A, "Acme");
    expect(await move(acme, "CONTACTED")).toEqual(OK);
    const detail = await companies.getCompanyDetail(A, acme);
    expect(detail?.stage).toBe("CONTACTED");
    expect(detail?.stageChanges).toMatchObject([{ fromStage: "NOT_CONTACTED", toStage: "CONTACTED", changedBy: { name: "officerA" } }]);
  });

  it("refuses a stage that doesn't exist", async () => {
    const acme = await make(A, "Acme");
    expect(await move(acme, "WON")).toEqual({ ok: false, error: "Pick a stage." });
  });

  it("refuses an archived company", async () => {
    const acme = await make(A, "Acme");
    await companies.archiveCompany(A, acme);
    expect(await move(acme, "CONTACTED")).toEqual({ ok: false, error: "Company not found." });
  });
});

describe("contacts", () => {
  let acme: string;
  beforeEach(async () => {
    acme = await make(A, "Acme");
  });
  const add = (fields: Record<string, string>) => asUser("officerA", () => addContact(null, form({ workspaceId: "a", companyId: acme, ...fields })));

  it("adds, edits and removes a contact, lowercasing the email and storing blanks as null", async () => {
    expect(await add({ name: " Sam Lee ", email: " Sam@Acme.COM ", title: "" })).toEqual(OK);
    expect(await contactsOf(acme)).toEqual([{ name: "Sam Lee", email: "sam@acme.com", title: null }]);

    const [{ id }] = await withTenant(A, (tx) => tx.contact.findMany({ select: { id: true } }));
    const ref = { workspaceId: "a", companyId: acme, contactId: id };
    expect(await asUser("officerA", () => updateContact(null, form({ ...ref, name: "Sam Lee", title: "Recruiter", email: "" })))).toEqual(OK);
    expect(await contactsOf(acme)).toEqual([{ name: "Sam Lee", email: null, title: "Recruiter" }]);

    expect(await asUser("officerA", () => removeContact(null, form(ref)))).toEqual(OK);
    expect(await contactsOf(acme)).toEqual([]);
    expect(await asUser("officerA", () => removeContact(null, form(ref)))).toEqual({ ok: false, error: "Contact not found." });
    expect(await asUser("officerA", () => updateContact(null, form({ ...ref, name: "X" })))).toEqual({ ok: false, error: "Contact not found." });
  });

  test.for([
    [{ name: "" }, "Enter the contact's name."],
    [{ name: "Sam", email: "not-an-email" }, "Enter a valid email address."],
    [{ name: "Sam", email: `${"x".repeat(250)}@a.com` }, "Enter a valid email address."],
    [{ name: "Sam", title: "x".repeat(121) }, "Title can be at most 120 characters."],
  ] as const)("refuses %j", async ([fields, error]) => {
    expect(await add(fields)).toEqual({ ok: false, error });
    expect(await contactsOf(acme)).toEqual([]);
  });

  it("refuses an edit that blanks the contact's name", async () => {
    await add({ name: "Sam" });
    const [{ id }] = await withTenant(A, (tx) => tx.contact.findMany({ select: { id: true } }));
    const blank = form({ workspaceId: "a", companyId: acme, contactId: id, name: " " });
    expect(await asUser("officerA", () => updateContact(null, blank))).toEqual({ ok: false, error: "Enter the contact's name." });
    expect(await contactsOf(acme)).toEqual([{ name: "Sam", email: null, title: null }]);
  });

  it("refuses a malformed contact id on remove, and adding to a company that doesn't exist", async () => {
    expect(await asUser("ownerA", () => removeContact(null, form({ workspaceId: "a", companyId: acme, contactId: "" })))).toEqual({
      ok: false,
      error: "Contact not found.",
    });
    expect(await asUser("ownerA", () => addContact(null, form({ workspaceId: "a", companyId: "missing", name: "Sam" })))).toEqual({
      ok: false,
      error: "Company not found.",
    });
  });
});

describe("company page data", () => {
  it("lists each industry once, sorted, and only this workspace's", async () => {
    await make(A, "One", { industry: "Tech" });
    await make(A, "Two", { industry: "Finance" });
    await make(A, "Three", { industry: "Tech" });
    await make(A, "Four");
    await make(B, "Other", { industry: "Mining" });
    expect(await companies.listIndustries(A)).toEqual(["Finance", "Tech"]);
  });

  it("returns nothing for another workspace's company", async () => {
    const acme = await make(A, "Acme");
    expect(await companies.getCompanyDetail(B, acme)).toBeNull();
    expect(await companies.getCompanyDetail(A, acme)).toMatchObject({ name: "Acme", contacts: [], stageChanges: [] });
  });
});

describe("websites", () => {
  test.for([
    ["acme.com", "https://acme.com"],
    ["www.acme.com/careers", "https://www.acme.com/careers"],
    ["https://acme.com", "https://acme.com"],
    ["HTTP://acme.com", "HTTP://acme.com"],
    ["acme.com:8080", "https://acme.com:8080"],
  ] as const)("%j is a web address, linked as %j", ([input, href]) => {
    expect(isWebAddress(input)).toBe(true);
    expect(websiteHref(input)).toBe(href);
  });

  test.for(["javascript:alert(1)", "JavaScript://acme.com", "data:text/html,hi", "mailto:a@acme.com", "ftp://acme.com", "acme", "acme .com", "localhost"])(
    "%j is refused and never linked",
    (input) => {
      expect(isWebAddress(input)).toBe(false);
      expect(websiteHref(input)).toBeNull();
    },
  );

  it("links nothing when there is no website", () => {
    expect(websiteHref(null)).toBeNull();
    expect(websiteHref("")).toBeNull();
  });
});
