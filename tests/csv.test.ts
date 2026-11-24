import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { previewImport as previewAction, runImport as runAction } from "@/app/(app)/[workspaceId]/import/actions";
import { createCompany } from "@/lib/companies";
import { checkRows, guessMapping, parseCsv, previewImport, runImport, type ImportPreview } from "@/lib/csv";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import type { ImportMapping } from "@/lib/validation";
import { redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";
import { testDatabaseUrls } from "./test-db";

vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Real database as app_user. The fixture is a messy Google Sheets export: byte-order mark,
// Windows line endings, quoted commas, a line break inside a note, trailing spaces, accents,
// blank lines, three bad rows, a look-alike inside the file and one matching a company that
// already exists.
const OWNER: Tenant = { userId: "ownerA", workspaceId: "a" };
const OTHER_ORG: Tenant = { userId: "ownerB", workspaceId: "b" };
const MESSY = readFileSync("tests/fixtures/messy-sponsors.csv", "utf8");
const MAPPING: ImportMapping = { name: 0, industry: 1, website: 2, contactName: 3, contactEmail: 4, notes: 5 };

const ok = <T>(result: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
const companies = (tenant: Tenant = OWNER) =>
  withTenant(tenant, (tx) => tx.company.findMany({ select: { name: true, industry: true, website: true, notes: true, stage: true, claimedById: true, nextFollowUpAt: true }, orderBy: { name: "asc" } }));
const company = async (name: string) => (await companies()).find((c) => c.name === name);

// The workspace already has Initech, which row 11 of the file repeats.
let initechId: string;
beforeEach(async () => {
  await resetAndSeed();
  const created = await createCompany(OWNER, { name: "Initech", website: "initech.com" });
  if (created.status !== "saved") throw new Error("seed");
  initechId = created.companyId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("parseCsv", () => {
  it("reads the messy export: byte-order mark, line endings, quoted commas and line breaks, blank lines", () => {
    const table = ok(parseCsv(MESSY));
    expect(table.headers).toEqual(["Company Name", "Industry", "Website", "Contact", "Contact Email", "Notes"]);
    expect(table.rows).toHaveLength(40);
    expect(table.rows[1]).toEqual({ row: 3, cells: ["Smith, Jones & Co", "Consulting", "smithjones.com", "", "", "Name has a comma in it"] });
    expect(table.rows[8].cells[5]).toBe("Line one\nLine two");
    // Rows 17 and 18 are blank in the sheet, so row numbers jump from 16 to 19, like in Sheets.
    expect(table.rows.map((r) => r.row).slice(13, 16)).toEqual([15, 16, 19]);
  });

  it("names blank headers and numbers repeated ones", () => {
    expect(ok(parseCsv("Name,,Name,Notes\nAcme,x,y,z")).headers).toEqual(["Name", "Column 2", "Name (2)", "Notes"]);
  });

  test.for([
    ["", "The file needs a header row with column names."],
    [" , ,\nAcme,x", "The file needs a header row with column names."],
    ["Name,Website\n\n , \n", "The file has no rows under its header."],
    ['Name,Notes\nAcme,"never closed\nGlobex,ok', "Row 2 has a quote that never closes. Fix it in the sheet and export again."],
  ] as const)("refuses %j", ([text, error]) => {
    expect(parseCsv(text)).toEqual({ ok: false, error });
  });

  it("refuses more than 2,000 rows or 200 columns", () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `Company ${i}`).join("\n");
    expect(parseCsv(`Name\n${rows}`)).toEqual({ ok: false, error: "The file has 2001 rows; the limit is 2000. Split it into smaller files." });
    expect(parseCsv(Array.from({ length: 201 }, (_, i) => `c${i}`).join(","))).toEqual({ ok: false, error: "The file has more than 200 columns." });
  });
});

describe("guessMapping", () => {
  test.for([
    [["Company Name", "Industry", "Website", "Contact", "Contact Email", "Notes"], MAPPING],
    [["Sponsor", "Sector", "URL", "Recruiter", "E-mail", "Status"], MAPPING],
    [["Org", "Notes", "Point of Contact", "Email"], { name: 0, industry: null, website: null, notes: 1, contactName: 2, contactEmail: 3 }],
    // Nothing looks like a company name: the first unused column is assumed to be it.
    [["Foo", "Bar"], { name: 0, industry: null, website: null, notes: null, contactName: null, contactEmail: null }],
    [["Email", "Something"], { name: 1, industry: null, website: null, notes: null, contactName: null, contactEmail: 0 }],
    // One column, and it looks like an email: it becomes the name instead, never both.
    [["Email"], { name: 0, industry: null, website: null, notes: null, contactName: null, contactEmail: null }],
  ] as const)("%j", ([headers, expected]) => {
    expect(guessMapping([...headers])).toEqual(expected);
  });
});

describe("checkRows", () => {
  it("cleans good rows and explains bad ones, with the same rules as the forms", () => {
    const rows = ok(checkRows(ok(parseCsv(MESSY)), MAPPING));
    const byRow = new Map(rows.map((r) => [r.row, r]));
    expect(byRow.get(5)).toEqual({
      row: 5,
      company: { name: "Globex", industry: "Energy", website: "globex.com", notes: "trailing spaces everywhere" },
      contact: { name: "Hank Scorpio", email: "hank@globex.com", title: null },
      errors: [],
    });
    expect(byRow.get(2)?.contact).toEqual({ name: "Jen Park", email: "jpark@acme.com", title: null });
    expect(byRow.get(7)?.errors).toEqual(["Enter a company name."]);
    expect(byRow.get(8)?.errors).toEqual(["Enter a website like acme.com or https://acme.com."]);
    expect(byRow.get(9)?.errors).toEqual(["Contact: Enter a valid email address."]);
  });

  it("asks for a contact name when only an email is given", () => {
    const rows = ok(checkRows(ok(parseCsv("Name,Email\nAcme,a@acme.com")), { ...MAPPING, industry: null, website: null, notes: null, contactName: null, contactEmail: 1 }));
    expect(rows[0].errors).toEqual(["Contact: Enter the contact's name."]);
  });

  it("treats missing cells at the end of a short row as empty", () => {
    const rows = ok(checkRows(ok(parseCsv("Name,Industry,Website\nAcme\n")), { ...MAPPING, contactName: null, contactEmail: null, notes: null }));
    expect(rows[0]).toMatchObject({ company: { name: "Acme", industry: null, website: null }, errors: [] });
  });

  it("shows a bad row's typed values, trimmed", () => {
    const fourColumns: ImportMapping = { name: 0, industry: 1, website: 2, notes: 3, contactName: null, contactEmail: null };
    const rows = ok(checkRows(ok(parseCsv("Name,Industry,Website,Notes\n , Tech , bad site , a note \n")), fourColumns));
    expect(rows[0].company).toEqual({ name: "", industry: "Tech", website: "bad site", notes: "a note" });
  });

  it("refuses a mapping that points past the file's columns", () => {
    expect(checkRows(ok(parseCsv("Name\nAcme")), MAPPING)).toEqual({ ok: false, error: "The column choices don't match this file. Choose them again." });
  });
});

describe("previewImport", () => {
  it("guesses the mapping and lists errors, look-alikes and suggested skips", async () => {
    const preview = ok(await previewImport(OWNER, MESSY, null));
    expect(preview.mapping).toEqual(MAPPING);
    expect(preview.rowCount).toBe(40);
    expect(preview.sample).toHaveLength(10);
    expect(preview.errors.map((e) => e.row)).toEqual([7, 8, 9]);
    expect(preview.groups).toEqual([
      { rows: [2, 4], existing: [], matchedOn: ["name"] },
      { rows: [11], existing: [{ id: initechId, name: "Initech", website: "initech.com", archived: false }], matchedOn: ["name", "website"] },
    ]);
    expect(preview.defaultSkips).toEqual([4, 11]);
    expect(preview.seen).toEqual([initechId]);
    expect(preview.labels).toEqual([
      { row: 2, name: "Acme Corp", website: "https://www.acme.com/" },
      { row: 4, name: "ACME, Inc.", website: null },
      { row: 11, name: "Initech", website: "initech.com" },
    ]);
  });

  it("joins rows that match each other through different keys into one group", async () => {
    const text = "Name,Website\nAcme,acme.com\nAcme Labs,acme.com\nACME Inc,\n";
    const preview = ok(await previewImport(OWNER, text, { name: 0, website: 1, industry: null, notes: null, contactName: null, contactEmail: null }));
    expect(preview.groups).toEqual([{ rows: [2, 3, 4], existing: [], matchedOn: ["name", "website"] }]);
    expect(preview.defaultSkips).toEqual([3, 4]);
  });

  it("has nothing to compare when every row has errors", async () => {
    const preview = ok(await previewImport(OWNER, "Name,Website\n,acme.com\n", { name: 0, website: 1, industry: null, notes: null, contactName: null, contactEmail: null }));
    expect(preview).toMatchObject({ rowCount: 1, groups: [], defaultSkips: [], seen: [] });
    expect(preview.errors).toEqual([{ row: 2, messages: ["Enter a company name."] }]);
  });

  it("passes on file and mapping problems", async () => {
    expect(await previewImport(OWNER, "", null)).toEqual({ ok: false, error: "The file needs a header row with column names." });
    expect(await previewImport(OWNER, "Name\nAcme", MAPPING)).toEqual({ ok: false, error: "The column choices don't match this file. Choose them again." });
    expect(await runImport(OWNER, "", MAPPING, [], [])).toEqual({ ok: false, error: "The file needs a header row with column names." });
    expect(await runImport(OWNER, "Name\nAcme", MAPPING, [], [])).toEqual({ ok: false, error: "The column choices don't match this file. Choose them again." });
  });

  it("flags archived companies too, and never another workspace's", async () => {
    await createCompany(OTHER_ORG, { name: "Globex" });
    const preview = ok(await previewImport(OWNER, "Name\nGlobex\nInitech\n", { ...MAPPING, industry: null, website: null, notes: null, contactName: null, contactEmail: null }));
    expect(preview.groups.map((g) => g.rows)).toEqual([[3]]);
  });
});

describe("previewImport: names inside other names", () => {
  const nameSite: ImportMapping = { name: 0, website: 1, industry: null, notes: null, contactName: null, contactEmail: null };

  it("flags Avum and Avum Space without Smart import, and suggests no skips for them", async () => {
    const text = "Name,Website\nAvum,avum.example.com\nAvum Space,avumspace.example.com\nGlobex,globex.com\n";
    const preview = ok(await previewImport(OWNER, text, nameSite));
    expect(preview.groups).toEqual([]);
    expect(preview.contained).toEqual([
      {
        rows: [
          { row: 2, name: "Avum", website: "avum.example.com" },
          { row: 3, name: "Avum Space", website: "avumspace.example.com" },
        ],
        existing: [],
        why: "One name contains the other",
      },
    ]);
    expect(preview.defaultSkips).toEqual([]);
    expect(preview.seen).toEqual([]);
    expect(preview.names).toEqual([
      { row: 2, name: "Avum" },
      { row: 3, name: "Avum Space" },
      { row: 4, name: "Globex" },
    ]);
  });

  it("flags a row whose name holds a saved company's name, archived ones too, and never another workspace's", async () => {
    await createCompany(OTHER_ORG, { name: "Globex" });
    const archived = await createCompany(OWNER, { name: "Hooli" });
    if (archived.status !== "saved") throw new Error("seed");
    await withTenant(OWNER, (tx) => tx.company.update({ where: { id: archived.companyId }, data: { archivedAt: new Date() } }));
    const text = "Name,Website\nInitech Labs,initechlabs.com\nGlobex Energy,\nHooli XYZ,\n";
    const preview = ok(await previewImport(OWNER, text, nameSite));
    expect(preview.contained).toEqual([
      { rows: [{ row: 2, name: "Initech Labs", website: "initechlabs.com" }], existing: [{ id: initechId, name: "Initech", website: "initech.com", archived: false }], why: "One name contains the other" },
      { rows: [{ row: 4, name: "Hooli XYZ", website: null }], existing: [{ id: archived.companyId, name: "Hooli", website: null, archived: true }], why: "One name contains the other" },
    ]);
    // Not exact matches, so the import's own check of `seen` doesn't change.
    expect(preview.groups).toEqual([]);
    expect(preview.seen).toEqual([]);
  });

  it("gives a group only the reasons a row of the file shares", async () => {
    // Initech Inc shares Initech's website; the row (no website) only shares their name.
    const inc = await createCompany(OWNER, { name: "Initech Inc", website: "initech.com" }, [initechId]);
    if (inc.status !== "saved") throw new Error("seed");
    const preview = ok(await previewImport(OWNER, "Name,Website\nInitech Co,\n", nameSite));
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0].existing.map((c) => c.name).sort()).toEqual(["Initech", "Initech Inc"]);
    expect(preview.groups[0].matchedOn).toEqual(["name"]);
  });

  it("leaves pairs the exact check already groups to that check, and short names alone", async () => {
    const text = "Name,Website\nAcme,acme.com\nAcme Labs,acme.com\nIBM,\nIBM Research,\n";
    const preview = ok(await previewImport(OWNER, text, nameSite));
    expect(preview.groups).toEqual([{ rows: [2, 3], existing: [], matchedOn: ["website"] }]);
    // Acme and Acme Labs share a website, so they are one exact group; IBM is under 4 letters.
    expect(preview.contained).toEqual([]);
  });

  it("shows at most 100 pairs", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `Northwind ${String.fromCharCode(65 + (i % 26))}${i}`);
    const text = `Name\nNorthwind\n${rows.join("\n")}\nNorthwind Alpha\n`;
    const many = `Name\n${["Northwind", ...Array.from({ length: 120 }, (_, i) => `Northwind Unit${i}`)].join("\n")}\n`;
    expect(ok(await previewImport(OWNER, text, { ...nameSite, website: null })).contained).toHaveLength(31);
    expect(ok(await previewImport(OWNER, many, { ...nameSite, website: null })).contained).toHaveLength(100);
  });

  it("imports both rows of a contained-name pair with the suggested choices", async () => {
    const text = "Name,Website\nAvum,avum.example.com\nAvum Space,avumspace.example.com\n";
    const preview = ok(await previewImport(OWNER, text, nameSite));
    expect(await runImport(OWNER, text, nameSite, preview.defaultSkips, preview.seen)).toEqual({ ok: true, data: { imported: 2, skipped: 0, errored: 0 } });
    expect((await companies()).map((c) => c.name)).toEqual(["Avum", "Avum Space", "Initech"]);
  });
});

describe("runImport", () => {
  async function preview(text = MESSY): Promise<ImportPreview> {
    return ok(await previewImport(OWNER, text, MAPPING));
  }

  it("imports the messy 40-row sheet with the suggested choices", async () => {
    const p = await preview();
    expect(await runImport(OWNER, MESSY, MAPPING, p.defaultSkips, p.seen)).toEqual({ ok: true, data: { imported: 35, skipped: 2, errored: 3 } });

    const all = await companies();
    expect(all).toHaveLength(36); // Initech already there, plus 35
    expect(all.filter((c) => c.name === "Initech")).toHaveLength(1);
    expect(await company("ACME, Inc.")).toBeUndefined();
    expect(await company("Smith, Jones & Co")).toMatchObject({ industry: "Consulting", website: "smithjones.com" });
    expect(await company("Globex")).toMatchObject({ industry: "Energy", website: "globex.com", notes: "trailing spaces everywhere" });
    expect(await company("Café Nero")).toBeDefined();
    expect((await company("Multiline Co"))?.notes).toBe("Line one\nLine two");
    // Fresh leads: Not contacted, no follow-up, nobody holding them.
    for (const c of all) expect(c).toMatchObject({ stage: "NOT_CONTACTED", claimedById: null, nextFollowUpAt: null });
    // One contact per row that named one; email lowercased.
    const contacts = await withTenant(OWNER, (tx) => tx.contact.findMany({ select: { name: true, email: true } }));
    expect(contacts).toHaveLength(17);
    expect(contacts).toContainEqual({ name: "Jen Park", email: "jpark@acme.com" });
  });

  it("imports look-alikes the person chose to keep, and remembers them as separate", async () => {
    const p = await preview();
    const result = ok(await runImport(OWNER, MESSY, MAPPING, [], p.seen));
    expect(result).toEqual({ imported: 37, skipped: 0, errored: 3 });
    expect((await companies()).filter((c) => c.name === "Initech")).toHaveLength(2);
    // Acme Corp and ACME, Inc. are one pair; the two Initechs another.
    expect(await withTenant(OWNER, (tx) => tx.companyPairDecision.count())).toBe(2);
  });

  it("refuses choices for rows that aren't in the file, or that have errors", async () => {
    const p = await preview();
    for (const skip of [[99], [7], [1]]) {
      expect(await runImport(OWNER, MESSY, MAPPING, skip, p.seen)).toEqual({ ok: false, error: "The import choices don't match this file. Review it again." });
    }
    expect(await companies()).toHaveLength(1);
  });

  it("notices a look-alike added after the preview, and imports nothing", async () => {
    const p = await preview();
    await createCompany(OWNER, { name: "Café Nero Holdings" });
    await createCompany(OWNER, { name: "Cafe Nero" }, []);
    const result = await runImport(OWNER, MESSY, MAPPING, p.defaultSkips, p.seen);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("was added since your preview") });
    expect(await companies()).toHaveLength(3);
  });

  it("is all or nothing: a failure part-way through leaves no companies or contacts behind", async () => {
    // A temporary trigger, added as the database owner, makes one contact insert fail.
    const owner = new Client({ connectionString: testDatabaseUrls().ownerUrl });
    await owner.connect();
    try {
      await owner.query(`
        CREATE FUNCTION public.test_fail_contact() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
        BEGIN IF NEW.name = 'Contact 39' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_fail_contact BEFORE INSERT ON public."Contact" FOR EACH ROW EXECUTE FUNCTION public.test_fail_contact();`);
      const p = await preview();
      await expect(runImport(OWNER, MESSY, MAPPING, p.defaultSkips, p.seen)).rejects.toThrow("test failure");
      expect(await companies()).toHaveLength(1);
      expect(await withTenant(OWNER, (tx) => tx.contact.count())).toBe(0);
    } finally {
      await owner.query(`DROP TRIGGER IF EXISTS test_fail_contact ON public."Contact"; DROP FUNCTION IF EXISTS public.test_fail_contact();`);
      await owner.end();
    }
  });

  it("skipping every row imports nothing and still succeeds", async () => {
    const nameOnly: ImportMapping = { name: 0, industry: null, website: null, notes: null, contactName: null, contactEmail: null };
    const p = ok(await previewImport(OWNER, "Name\nInitech\n", nameOnly));
    expect(await runImport(OWNER, "Name\nInitech\n", nameOnly, [2], p.seen)).toEqual({ ok: true, data: { imported: 0, skipped: 1, errored: 0 } });
    expect(await companies()).toHaveLength(1);
  });
});

describe("import actions", () => {
  const file = (text: string, name = "sponsors.csv") => new File([text], name, { type: "text/csv" });
  const formOf = (fields: Record<string, string | File>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  const previewForm = (extra: Record<string, string | File> = {}) => formOf({ workspaceId: "a", file: file(MESSY), ...extra });

  it("previews and imports through the forms", async () => {
    const preview = ok(await asUser("officerA", () => previewAction(null, previewForm())));
    expect(preview.defaultSkips).toEqual([4, 11]);
    const run = formOf({
      workspaceId: "a",
      file: file(MESSY),
      mapping: JSON.stringify(preview.mapping),
      skip: JSON.stringify(preview.defaultSkips),
      seen: JSON.stringify(preview.seen),
    });
    expect(await asUser("officerA", () => runAction(null, run))).toEqual({ ok: true, data: { imported: 35, skipped: 2, errored: 3 } });
  });

  test.for([
    [{ file: "not a file" }, "Choose a .csv file."],
    [{ file: file("") }, "Choose a .csv file."],
    [{ file: file("Name\nAcme", "sponsors.xlsx") }, "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values."],
    [{ file: file("x".repeat(3 * 1024 * 1024 + 1)) }, "The file is over 3 MB. Split it into smaller files."],
    [{ mapping: "{not json" }, "Choose a column for each field."],
    [{ mapping: JSON.stringify({ ...MAPPING, name: 0, notes: 0 }) }, "Each column can only fill one field."],
    [{ mapping: JSON.stringify({ ...MAPPING, name: 250 }) }, expect.any(String)],
    [{ mapping: JSON.stringify({ ...MAPPING, name: 9 }) }, "The column choices don't match this file. Choose them again."],
  ] as const)("refuses %j", async ([extra, error]) => {
    expect(await asUser("ownerA", () => previewAction(null, previewForm(extra as Record<string, string | File>)))).toEqual({ ok: false, error });
  });

  test.for([
    ["the header row as a skipped row", { skip: "[1]" }],
    ["skip that isn't JSON", { skip: "not json" }],
    ["skip that isn't a list of numbers", { skip: '["2"]' }],
    ["2,001 skipped rows", { skip: JSON.stringify(Array.from({ length: 2001 }, (_, i) => i + 2)) }],
    ["2,001 seen companies", { seen: JSON.stringify(Array.from({ length: 2001 }, () => "x")) }],
    ["an empty seen id", { seen: '[""]' }],
  ] as const)("refuses an import with %s", async ([, extra]) => {
    const run = formOf({ workspaceId: "a", file: file(MESSY), mapping: JSON.stringify(MAPPING), skip: "[]", seen: "[]", ...extra });
    expect(await asUser("ownerA", () => runAction(null, run))).toEqual({ ok: false, error: "Review the duplicates again." });
    expect(await companies()).toHaveLength(1);
  });

  it("passes on the import's own refusals, and imports nothing", async () => {
    const run = formOf({ workspaceId: "a", file: file(MESSY), mapping: JSON.stringify(MAPPING), skip: "[99]", seen: "[]" });
    expect(await asUser("ownerA", () => runAction(null, run))).toEqual({ ok: false, error: "The import choices don't match this file. Review it again." });
    expect(await companies()).toHaveLength(1);
  });

  it("refuses a bad file on import too", async () => {
    const run = formOf({ workspaceId: "a", file: file(""), mapping: JSON.stringify(MAPPING), skip: "[]", seen: "[]" });
    expect(await asUser("ownerA", () => runAction(null, run))).toEqual({ ok: false, error: "Choose a .csv file." });
  });

  it("refuses signed-out visitors and other workspaces, and imports nothing", async () => {
    const run = () => formOf({ workspaceId: "a", file: file(MESSY), mapping: JSON.stringify(MAPPING), skip: "[]", seen: JSON.stringify([initechId]) });
    await expect(signedOut(() => previewAction(null, previewForm()))).rejects.toEqual(redirectTo("/signin"));
    await expect(signedOut(() => runAction(null, run()))).rejects.toEqual(redirectTo("/signin"));
    expect(await asUser("ownerB", () => previewAction(null, previewForm()))).toEqual({ ok: false, error: expect.any(String) });
    expect(await asUser("ownerB", () => runAction(null, run()))).toEqual({ ok: false, error: expect.any(String) });
    expect(await companies()).toHaveLength(1);
    expect(await companies(OTHER_ORG)).toHaveLength(0);
  });

  it("refuses a malformed workspace id", async () => {
    expect(await asUser("ownerA", () => previewAction(null, previewForm({ workspaceId: "" })))).toEqual({ ok: false, error: expect.any(String) });
  });
});
