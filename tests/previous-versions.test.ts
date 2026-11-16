import { readdirSync, readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as cronGet } from "@/app/api/cron/purge-previous-versions/route";
import type { Membership } from "@/lib/authz";
import { claimCompany, dbNow } from "@/lib/claims";
import {
  addContact,
  archiveCompany,
  createCompany,
  getCompanyDetail,
  getCompanyPage,
  removeContact,
  updateCompany,
  updateContact,
  type CompanyFields,
} from "@/lib/companies";
import { prisma, PURGE_BATCH, purgeExpiredPreviousVersions, withTenant } from "@/lib/db";
import { COMPANY_ARCHIVED } from "@/lib/messages";
import { PREVIOUS_VERSION_MS, VERSION_GONE, VERSION_SAME } from "@/lib/previous-versions-copy";
import { valueDigest } from "@/lib/previous-versions";
import { restoreRefusal, restoreVersion } from "@/lib/restore-version";
import { updateCompanySchema } from "@/lib/validation";
import { resetAndSeed } from "./helpers/seed";
import { ageVersion, allVersions, insertExpiredVersions, insertVersionAsOwner } from "./helpers/previous-versions";

// Previous versions, against the real database as app_user: what each edit keeps, when a slot stops
// being shown and is deleted, and what a restore does. Seed: workspace "a" (ownerA owner, officerA
// officer) and "b" (ownerB owner).
const A: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER_A: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const B: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

const loaded: CompanyFields = { name: "Acme", industry: "Tech", website: "acme.com", notes: "met at fair" };
const edit = (original: CompanyFields, changes: Partial<CompanyFields>) => ({ original, changes: { ...original, ...changes } });
const create = async (tenant: Membership = A, fields: CompanyFields = loaded) => {
  const result = await createCompany(tenant, fields);
  if (result.status !== "saved") throw new Error(`expected saved, got ${result.status}`);
  return result.companyId;
};
const row = (id: string) => withTenant(A, (tx) => tx.company.findUniqueOrThrow({ where: { id } }));
const contactRow = (id: string) => withTenant(A, (tx) => tx.contact.findUniqueOrThrow({ where: { id } }));
const newContact = async (companyId: string, fields: { name: string; email?: string | null; title?: string | null } = { name: "Sam Lee", title: "CEO" }) => {
  const result = await addContact(A, companyId, fields);
  if (!result.ok) throw new Error(result.error);
  return result.data.contactId;
};
const slotOf = async (field: string, contactId: string | null = null) => (await allVersions()).find((r) => r.field === field && r.contactId === contactId);
const restore = (member: Membership, companyId: string, versionId: string, current: string | null) =>
  restoreVersion(member, { companyId, versionId, expect: { value: current } }, "APP");

beforeEach(resetAndSeed);

afterEach(() => {
  delete process.env.CRON_SECRET;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("writes", () => {
  it("an edit keeps the value it replaced, in one slot per field", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { industry: "Fintech" }));
    const rows = await allVersions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "INDUSTRY", value: "Tech", via: "APP", replacedById: "ownerA", contactId: null, companyId: id, workspaceId: "a" });
  });

  it("editing two fields keeps two slots, and a field left alone keeps its slot", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { name: "Acme Corp", website: "acme-corp.com" }));
    const first = await allVersions();
    expect(first.map((r) => r.field).sort()).toEqual(["NAME", "WEBSITE"]);
    await updateCompany(A, id, edit({ ...loaded, name: "Acme Corp", website: "acme-corp.com" }, { notes: "new notes" }));
    const after = await allVersions();
    expect(after.map((r) => r.field).sort()).toEqual(["NAME", "NOTES", "WEBSITE"]);
    for (const field of ["NAME", "WEBSITE"]) expect(after.find((r) => r.field === field)?.id).toBe(first.find((r) => r.field === field)?.id);
  });

  it("the version before last is gone, even at 20 minutes old", async () => {
    const id = await create(A, { ...loaded, notes: "A" });
    await updateCompany(A, id, edit({ ...loaded, notes: "A" }, { notes: "B" }));
    const slot = await slotOf("NOTES");
    await ageVersion(slot!.id, "20 minutes");
    await updateCompany(A, id, edit({ ...loaded, notes: "B" }, { notes: "C" }));
    const rows = await allVersions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "NOTES", value: "B" });
    expect(rows[0].id).not.toBe(slot!.id);
    expect(Math.abs(rows[0].replacedAt.getTime() - (await dbNow()).getTime())).toBeLessThan(5000);
    expect(rows.some((r) => r.value === "A")).toBe(false);
  });

  it("a field changed back keeps the value just before", async () => {
    const id = await create(A, { ...loaded, notes: "A" });
    await updateCompany(A, id, edit({ ...loaded, notes: "A" }, { notes: "B" }));
    await updateCompany(A, id, edit({ ...loaded, notes: "B" }, { notes: "A" }));
    const rows = await allVersions();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("B");
  });

  it("clearing a field keeps its old value, and an empty field's slot is null", async () => {
    const id = await create(A, { name: "Acme", website: "acme.com" });
    await updateCompany(A, id, edit({ name: "Acme", website: "acme.com" }, { website: null }));
    expect(await slotOf("WEBSITE")).toMatchObject({ value: "acme.com" });
    await updateCompany(A, id, edit({ name: "Acme", website: null }, { industry: "Tech" }));
    expect(await slotOf("INDUSTRY")).toMatchObject({ value: null });
  });

  it("nothing is kept for a save with no change, a conflict, or a stop for look-alikes", async () => {
    const id = await create();
    await create(A, { name: "Globex" });
    expect(await updateCompany(A, id, edit(loaded, {}))).toMatchObject({ ok: true, data: { status: "saved" } });
    expect(await updateCompany(A, id, edit({ ...loaded, notes: "something else" }, { notes: "mine" }))).toMatchObject({ data: { status: "conflict" } });
    expect(await updateCompany(A, id, edit(loaded, { name: "Globex" }))).toMatchObject({ data: { status: "possible-duplicates" } });
    expect(await allVersions()).toEqual([]);
  });

  it("a contact edit keeps the replaced value; a field left out is not touched", async () => {
    const id = await create();
    const contactId = await newContact(id, { name: "Sam Lee", title: "CEO" });
    await updateContact(A, contactId, { title: "CTO" });
    expect((await allVersions()).map((r) => [r.field, r.value])).toEqual([["TITLE", "CEO"]]);
    expect(await contactRow(contactId)).toMatchObject({ name: "Sam Lee", email: null, title: "CTO" });
    await updateContact(A, contactId, { email: "sam@acme.com" });
    expect(await slotOf("EMAIL", contactId)).toMatchObject({ value: null });
    expect((await allVersions()).map((r) => r.field).sort()).toEqual(["EMAIL", "TITLE"]);
  });

  it("two simultaneous edits of one company field leave one slot with the value both saw (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      await resetAndSeed();
      const id = await create();
      await Promise.all([updateCompany(A, id, edit(loaded, { notes: "from owner" })), updateCompany(OFFICER_A, id, edit(loaded, { notes: "from officer" }))]);
      const rows = await allVersions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ field: "NOTES", value: "met at fair" });
    }
  });

  it("two simultaneous contact edits leave one slot holding the value just before the current one (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      await resetAndSeed();
      const id = await create();
      const contactId = await newContact(id, { name: "Sam Lee", title: "X" });
      await Promise.all([updateContact(A, contactId, { title: "Y" }), updateContact(OFFICER_A, contactId, { title: "Z" })]);
      const current = (await contactRow(contactId)).title;
      const rows = await allVersions();
      expect(rows).toHaveLength(1);
      expect(rows[0].field).toBe("TITLE");
      expect(rows[0].value).toBe(current === "Y" ? "Z" : "Y");
      expect(rows.some((r) => r.value === "X")).toBe(false);
    }
  });

  it("an edit and a restore of the same field at once: exactly one changes it, one slot (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      await resetAndSeed();
      const id = await create(A, { ...loaded, notes: "A" });
      await updateCompany(A, id, edit({ ...loaded, notes: "A" }, { notes: "B" }));
      const slot = (await slotOf("NOTES"))!;
      const [edited, restored] = await Promise.all([
        updateCompany(A, id, edit({ ...loaded, notes: "B" }, { notes: "C" })),
        restoreVersion(OFFICER_A, { companyId: id, versionId: slot.id, expect: { value: "B" } }, "APP"),
      ]);
      const editWon = edited.ok && edited.data.status === "saved";
      const restoreWon = restored.ok && restored.data.status === "restored";
      expect(editWon !== restoreWon).toBe(true);
      expect((await row(id)).notes).toBe(editWon ? "C" : "A");
      const rows = await allVersions();
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe("B");
    }
  });

  it("deleting a contact deletes its slots, the company's stay", async () => {
    const id = await create();
    const contactId = await newContact(id);
    await updateContact(A, contactId, { title: "CTO" });
    await updateCompany(A, id, edit(loaded, { notes: "new" }));
    expect(await allVersions()).toHaveLength(2);
    expect(await removeContact(A, contactId)).toMatchObject({ ok: true });
    expect((await allVersions()).map((r) => r.field)).toEqual(["NOTES"]);
  });

  it("deleting the company or the workspace deletes every slot", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new" }));
    const other = await create(B, loaded);
    await updateCompany(B, other, edit(loaded, { notes: "new" }));
    expect(await allVersions()).toHaveLength(2);
    await withTenant(A, (tx) => tx.company.deleteMany({ where: { id } }));
    expect((await allVersions()).map((r) => r.workspaceId)).toEqual(["b"]);
    await prisma.workspace.delete({ where: { id: "b" } });
    expect(await allVersions()).toEqual([]);
  });

  it("notes saved with LF can be edited from a form that sends CRLF, and the slot keeps the stored text", async () => {
    const id = await create(A, { ...loaded, notes: "Met Sam.\nAdded from a brief." });
    const result = await updateCompany(A, id, edit({ ...loaded, notes: "Met Sam.\r\nAdded from a brief." }, { notes: "Met Sam.\r\nAdded from a brief.\r\nThird line." }));
    expect(result).toEqual({ ok: true, data: { status: "saved", companyId: id } });
    expect((await row(id)).notes).toBe("Met Sam.\r\nAdded from a brief.\r\nThird line.");
    expect((await slotOf("NOTES"))?.value).toBe("Met Sam.\nAdded from a brief.");
  });

  it("the edit form's rules store notes with LF line breaks and compare originals the same way", () => {
    const parsed = updateCompanySchema.parse({
      workspaceId: "a",
      companyId: "c",
      separateFrom: null,
      changes: { name: "Acme", industry: "", website: "", notes: "one\r\ntwo\rthree" },
      original: { name: "Acme", industry: "", website: "", notes: "one\r\ntwo" },
    });
    expect(parsed.changes.notes).toBe("one\ntwo\nthree");
    expect(parsed.original.notes).toBe("one\ntwo");
  });

  it("a slot cannot name a contact of another company", async () => {
    const acme = await create();
    const other = await create(A, { name: "Other Co" });
    const theirs = await newContact(other, { name: "Pat" });
    await expect(
      withTenant(A, (tx) =>
        tx.previousVersion.create({ data: { workspaceId: "a", companyId: acme, contactId: theirs, subjectId: theirs, field: "TITLE", value: "z", replacedById: "ownerA" } }),
      ),
    ).rejects.toThrow();
    expect(await allVersions()).toEqual([]);
  });

  it("the database stamps the time: a slot added with a far future time is stored as of now", async () => {
    const id = await create();
    await withTenant(A, (tx) =>
      tx.previousVersion.create({ data: { workspaceId: "a", companyId: id, subjectId: id, field: "NOTES", value: "x", replacedById: "ownerA", replacedAt: new Date("2099-01-01") } }),
    );
    const [stored] = await allVersions();
    expect(Math.abs(stored.replacedAt.getTime() - (await dbNow()).getTime())).toBeLessThan(5000);
  });
});

describe("reads and expiry", () => {
  const changed = async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new notes" }));
    return id;
  };

  it("the company page reads the live slots; an officer sees the same as the owner", async () => {
    const id = await changed();
    const owner = (await getCompanyPage(A, id))?.previousVersions;
    expect(owner).toHaveLength(1);
    expect((await getCompanyPage(OFFICER_A, id))?.previousVersions).toEqual(owner);
  });

  it("a slot is shown until it is one hour old by the database clock, and not from then on", async () => {
    const id = await changed();
    const slot = (await slotOf("NOTES"))!;
    await ageVersion(slot.id, "59 minutes 50 seconds");
    expect((await getCompanyPage(A, id))?.previousVersions).toHaveLength(1);
    await ageVersion(slot.id, "60 minutes");
    expect((await getCompanyPage(A, id))?.previousVersions).toEqual([]);
    expect(await restore(A, id, slot.id, "new notes")).toEqual({ ok: true, data: { status: "gone" } });
  });

  it("the hour in TypeScript is the hour in the database", () => {
    expect(PREVIOUS_VERSION_MS).toBe(3_600_000);
    const folder = readdirSync("prisma/migrations").find((d) => d.endsWith("_previous_versions"));
    const migration = readFileSync(`prisma/migrations/${folder}/migration.sql`, "utf8");
    expect(migration.match(/interval '1 hour'/g)).toHaveLength(3);
  });

  it("another workspace, an outsider and an archived company see no slots", async () => {
    const id = await changed();
    expect(await getCompanyPage(B, id)).toBeNull();
    expect(await withTenant({ userId: "ownerB", workspaceId: "a" }, (tx) => tx.previousVersion.count())).toBe(0);
    await archiveCompany(A, id);
    expect((await getCompanyPage(A, id))?.previousVersions).toEqual([]);
  });

  it("the replacer is named, never by email", async () => {
    const id = await changed();
    const rows = (await getCompanyPage(A, id))!.previousVersions;
    expect(Object.keys(rows[0]).sort()).toEqual(["contactId", "field", "id", "replacedAt", "replacedById", "replacedByName", "value", "via"]);
    expect(JSON.stringify(rows)).not.toContain("@example.com");
  });

  it("Ask Coppice's company card never reads previous versions", async () => {
    const id = await changed();
    expect(await getCompanyDetail(A, id)).not.toHaveProperty("previousVersions");
  });
});

describe("the cleanup", () => {
  const slotFor = async (member: Membership, workspaceId: string) => {
    const id = await create(member, { name: `Co ${workspaceId}${Math.random()}`, notes: "a" });
    await updateCompany(member, id, edit({ name: (await row2(member, id)).name, notes: "a" }, { notes: "b" }));
    return id;
  };
  const row2 = (member: Membership, id: string) => withTenant(member, (tx) => tx.company.findUniqueOrThrow({ where: { id } }));

  it("deletes only slots past their hour, in every workspace", async () => {
    await slotFor(A, "a");
    await slotFor(A, "a");
    await slotFor(B, "b");
    const rows = await allVersions();
    expect(rows).toHaveLength(3);
    const [one, two, three] = rows;
    await ageVersion(one.id, "61 minutes");
    await ageVersion(three.id, "61 minutes");
    await ageVersion(two.id, "59 minutes");
    expect(await purgeExpiredPreviousVersions()).toBe(2);
    expect((await allVersions()).map((r) => r.id)).toEqual([two.id]);
  });

  it("deletes in batches of PURGE_BATCH", async () => {
    const id = await create();
    await insertExpiredVersions(PURGE_BATCH + 1, "a", id, "ownerA");
    expect(PURGE_BATCH).toBe(1000);
    expect(await purgeExpiredPreviousVersions()).toBe(1000);
    expect(await purgeExpiredPreviousVersions()).toBe(1);
    expect(await allVersions()).toEqual([]);
  });

  it("the app cannot change a slot, and cannot delete another workspace's", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new" }));
    const other = await create(B, loaded);
    await updateCompany(B, other, edit(loaded, { notes: "new" }));
    await expect(withTenant(A, (tx) => tx.previousVersion.updateMany({ data: { value: "x" } }))).rejects.toThrow(/permission denied/);
    expect(await withTenant(A, (tx) => tx.previousVersion.deleteMany({ where: { workspaceId: "b" } }))).toEqual({ count: 0 });
    expect(await prisma.previousVersion.deleteMany()).toEqual({ count: 0 });
    expect(await allVersions()).toHaveLength(2);
  });

  it("an edit cleans up lazily", async () => {
    const first = await create();
    await updateCompany(A, first, edit(loaded, { notes: "new" }));
    const old = (await allVersions())[0];
    await ageVersion(old.id, "2 hours");
    const second = await create(A, { name: "Globex", notes: "a" });
    await updateCompany(A, second, edit({ name: "Globex", notes: "a" }, { notes: "b" }));
    expect((await allVersions()).map((r) => r.id)).not.toContain(old.id);
    expect(await allVersions()).toHaveLength(1);
  });

  it("the company page cleans up lazily too", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new" }));
    await ageVersion((await allVersions())[0].id, "2 hours");
    await getCompanyPage(A, id);
    expect(await allVersions()).toEqual([]);
  });

  it("the cron route deletes expired slots, needs no secret and answers with no body", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new", industry: "Fintech" }));
    const [one, two] = await allVersions();
    await ageVersion(one.id, "2 hours");
    const response = await cronGet(new Request("http://localhost/api/cron/purge-previous-versions"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect((await allVersions()).map((r) => r.id)).toEqual([two.id]);
    expect((await cronGet(new Request("http://localhost/api/cron/purge-previous-versions"))).status).toBe(204);
  });

  it("with CRON_SECRET set, a call without it gets 401 and deletes nothing, and one with it gets 204", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { notes: "new" }));
    await ageVersion((await allVersions())[0].id, "2 hours");
    process.env.CRON_SECRET = "test-secret-value";
    const refused = await cronGet(new Request("http://localhost/api/cron/purge-previous-versions"));
    expect(refused.status).toBe(401);
    expect(await refused.text()).toBe("");
    expect(await allVersions()).toHaveLength(1);
    const wrong = await cronGet(new Request("http://localhost/api/cron/purge-previous-versions", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
    // The right length with one wrong character, a longer token, a lower-case scheme and no scheme.
    for (const header of ["Bearer test-secret-valuX", "Bearer test-secret-value-and-more", "bearer test-secret-value", "test-secret-value", "Bearer  test-secret-value"]) {
      expect((await cronGet(new Request("http://localhost/api/cron/purge-previous-versions", { headers: { authorization: header } }))).status).toBe(401);
    }
    const allowed = await cronGet(new Request("http://localhost/api/cron/purge-previous-versions", { headers: { authorization: "Bearer test-secret-value" } }));
    expect(allowed.status).toBe(204);
    expect(await allVersions()).toEqual([]);
  });

  it("vercel.json runs the cleanup at most once a day", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toEqual([{ path: "/api/cron/purge-previous-versions", schedule: expect.stringMatching(/^\d{1,2} \d{1,2} \* \* \*$/) }]);
    expect(config.regions).toEqual(["iad1"]);
    expect(config.git).toEqual({ deploymentEnabled: { "feature/**": false, "fix/**": false } });
  });
});

describe("restore", () => {
  const setup = async () => {
    const id = await create(A, { ...loaded, notes: "A" });
    await updateCompany(A, id, edit({ ...loaded, notes: "A" }, { notes: "B" }));
    return { id, slot: (await slotOf("NOTES"))! };
  };

  it("swaps: the field gets the old value and the replaced value becomes the new slot", async () => {
    const { id, slot } = await setup();
    const result = await restoreVersion(OFFICER_A, { companyId: id, versionId: slot.id, expect: { digest: valueDigest("B") } }, "APP");
    expect(result).toEqual({ ok: true, data: { status: "restored", field: "NOTES", contactId: null } });
    expect((await row(id)).notes).toBe("A");
    const rows = await allVersions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "NOTES", value: "B", via: "APP", replacedById: "officerA" });
    expect(rows[0].id).not.toBe(slot.id);
  });

  it("a restore can be restored", async () => {
    const { id, slot } = await setup();
    await restore(A, id, slot.id, "B");
    const again = (await slotOf("NOTES"))!;
    expect(await restore(A, id, again.id, "A")).toMatchObject({ ok: true, data: { status: "restored" } });
    expect((await row(id)).notes).toBe("B");
    expect((await slotOf("NOTES"))?.value).toBe("A");
  });

  it("a stale expected value is a conflict and nothing changes", async () => {
    const { id, slot } = await setup();
    expect(await restoreVersion(A, { companyId: id, versionId: slot.id, expect: { digest: valueDigest("something else") } }, "APP")).toEqual({ ok: true, data: { status: "changed" } });
    expect(await restore(A, id, slot.id, "something else")).toEqual({ ok: true, data: { status: "changed" } });
    expect((await row(id)).notes).toBe("B");
    expect((await slotOf("NOTES"))?.id).toBe(slot.id);
  });

  it("a missing, expired, overwritten or other company's version is gone, and an equal one changes nothing", async () => {
    const { id, slot } = await setup();
    const gone = { ok: true, data: { status: "gone" } };
    expect(await restore(A, id, "no-such-version", "B")).toEqual(gone);
    const other = await create(A, { name: "Globex", notes: "x" });
    expect(await restore(A, other, slot.id, "x")).toEqual(gone);
    await updateCompany(A, id, edit({ ...loaded, notes: "B" }, { notes: "C" }));
    expect(await restore(A, id, slot.id, "C")).toEqual(gone);
    const fresh = (await slotOf("NOTES"))!;
    await ageVersion(fresh.id, "61 minutes");
    expect(await restore(A, id, fresh.id, "C")).toEqual(gone);
    expect((await row(id)).notes).toBe("C");
    expect(restoreRefusal({ status: "gone" })).toBe(VERSION_GONE);
    // A slot that already equals the field now.
    await insertVersionAsOwner({ id: "same-1", workspaceId: "a", companyId: id, contactId: null, field: "INDUSTRY", value: "Tech", replacedById: "ownerA" });
    expect(await restore(A, id, "same-1", "Tech")).toEqual({ ok: true, data: { status: "unchanged" } });
    expect(restoreRefusal({ status: "unchanged" })).toBe(VERSION_SAME);
  });

  it("a stored value that trims to the value now restores nothing and writes no slot", async () => {
    const id = await create(A, { ...loaded, notes: "Met at fair" });
    // An older row could hold trailing spaces, which the form's rules would trim away.
    await insertVersionAsOwner({ id: "pad-1", workspaceId: "a", companyId: id, contactId: null, field: "NOTES", value: "Met at fair  ", replacedById: "ownerA" });
    expect(await restore(A, id, "pad-1", "Met at fair")).toEqual({ ok: true, data: { status: "unchanged" } });
    expect((await row(id)).notes).toBe("Met at fair");
    expect((await allVersions()).map((r) => r.id)).toEqual(["pad-1"]);
    // The same text with CRLF where the field has LF is the same value too.
    const lines = await create(A, { name: "Globex", notes: "one\ntwo" });
    await insertVersionAsOwner({ id: "crlf-1", workspaceId: "a", companyId: lines, contactId: null, field: "NOTES", value: "one\r\ntwo", replacedById: "ownerA" });
    expect(await restore(A, lines, "crlf-1", "one\ntwo")).toEqual({ ok: true, data: { status: "unchanged" } });
  });

  it("an id overwritten by a newer change of the same field is changed, one that expired is gone", async () => {
    const { id, slot } = await setup();
    const subject = { field: "NOTES" as const, contactId: null };
    const ask = (versionId: string, current: string) => restoreVersion(A, { companyId: id, versionId, expect: { value: current }, subject }, "APP");
    await updateCompany(A, id, edit({ ...loaded, notes: "B" }, { notes: "C" }));
    expect(await ask(slot.id, "C")).toEqual({ ok: true, data: { status: "changed" } });
    expect((await row(id)).notes).toBe("C");
    // Another field named the same is not this one: no slot, so gone.
    expect(await restoreVersion(A, { companyId: id, versionId: slot.id, expect: { value: "C" }, subject: { field: "INDUSTRY", contactId: null } }, "APP")).toEqual({ ok: true, data: { status: "gone" } });
    // Once the newer slot's hour is up as well, nothing is kept for the field.
    await ageVersion((await slotOf("NOTES"))!.id, "61 minutes");
    expect(await ask(slot.id, "C")).toEqual({ ok: true, data: { status: "gone" } });
    // Without a subject (an older caller) the answer is gone, and its sentence covers both reasons.
    expect(VERSION_GONE).toMatch(/Its hour is up, or the field was changed again/);
  });

  it("a contact's overwritten slot is changed too, and a company field of the same name is not", async () => {
    const id = await create();
    const contactId = await newContact(id, { name: "Sam Lee", email: "sam@acme.com" });
    await updateContact(A, contactId, { email: "sam@acme.org" });
    const old = (await slotOf("EMAIL", contactId))!;
    await updateContact(A, contactId, { email: "sam@acme.net" });
    expect(await restoreVersion(A, { companyId: id, versionId: old.id, expect: { value: "sam@acme.net" }, subject: { field: "EMAIL", contactId } }, "APP")).toEqual({ ok: true, data: { status: "changed" } });
    expect(await restoreVersion(A, { companyId: id, versionId: old.id, expect: { value: "sam@acme.net" }, subject: { field: "NAME", contactId: null } }, "APP")).toEqual({ ok: true, data: { status: "gone" } });
  });

  it("another workspace's version with this workspace's company is gone", async () => {
    const { id } = await setup();
    const theirs = await create(B, loaded);
    await updateCompany(B, theirs, edit(loaded, { notes: "new" }));
    const theirSlot = (await allVersions()).find((r) => r.workspaceId === "b")!;
    expect(await restore(A, id, theirSlot.id, "B")).toEqual({ ok: true, data: { status: "gone" } });
  });

  it("an archived company is refused", async () => {
    const { id, slot } = await setup();
    await archiveCompany(A, id);
    expect(await restore(A, id, slot.id, "B")).toEqual({ ok: false, error: COMPANY_ARCHIVED });
    expect((await row(id)).notes).toBe("B");
  });

  it("follows the edit rule for claims: an officer may restore on a company the owner holds", async () => {
    const { id, slot } = await setup();
    await claimCompany(A, id);
    expect(await restore(OFFICER_A, id, slot.id, "B")).toMatchObject({ ok: true, data: { status: "restored" } });
    expect((await row(id)).notes).toBe("A");
  });

  it("restoring a website recomputes its domain key", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { website: "acme.org" }));
    expect((await row(id)).domainKey).toBe("acme.org");
    const slot = (await slotOf("WEBSITE"))!;
    expect(await restore(A, id, slot.id, "acme.org")).toMatchObject({ ok: true, data: { status: "restored" } });
    expect(await row(id)).toMatchObject({ website: "acme.com", domainKey: "acme.com" });
  });

  it("restoring a name that matches another company stops for look-alikes; with separateFrom it restores and remembers the pair", async () => {
    const id = await create(A, { name: "Acme" });
    await updateCompany(A, id, edit({ name: "Acme" }, { name: "Initech" }));
    const slot = (await slotOf("NAME"))!;
    const newer = await create(A, { name: "Acme" });
    const stopped = await restoreVersion(A, { companyId: id, versionId: slot.id, expect: { value: "Initech" } }, "APP");
    expect(stopped).toMatchObject({ ok: true, data: { status: "possible-duplicates", total: 1 } });
    expect((await row(id)).name).toBe("Initech");
    expect(restoreRefusal(stopped.ok ? stopped.data : { status: "gone" })).toBe(
      "Restoring it would make this company look like Acme. Use Edit details to make the change there and say whether they are the same company.",
    );
    const done = await restoreVersion(A, { companyId: id, versionId: slot.id, expect: { value: "Initech" }, separateFrom: [newer] }, "APP");
    expect(done).toMatchObject({ ok: true, data: { status: "restored" } });
    expect((await row(id)).name).toBe("Acme");
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count())).toBe(1);
  });

  it("a contact's previous email is restored through the contact rules", async () => {
    const id = await create();
    const contactId = await newContact(id, { name: "Sam Lee", email: "sam@acme.com" });
    await updateContact(A, contactId, { email: "sam@acme.org" });
    const slot = (await slotOf("EMAIL", contactId))!;
    expect(await restore(A, id, slot.id, "sam@acme.org")).toEqual({ ok: true, data: { status: "restored", field: "EMAIL", contactId } });
    expect((await contactRow(contactId)).email).toBe("sam@acme.com");
    expect((await slotOf("EMAIL", contactId))?.value).toBe("sam@acme.org");
    // A slot that holds something the form would refuse.
    await updateContact(A, contactId, { title: "CTO" });
    await withTenant(A, (tx) => tx.previousVersion.deleteMany({ where: { subjectId: contactId, field: "EMAIL" } }));
    await insertVersionAsOwner({ id: "bad-email", workspaceId: "a", companyId: id, contactId, field: "EMAIL", value: "not-an-email", replacedById: "ownerA" });
    const refused = await restore(A, id, "bad-email", "sam@acme.com");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? "" : refused.error).toMatch(/^That previous email can't be restored\. .+/);
    expect((await contactRow(contactId)).email).toBe("sam@acme.com");
  });

  it("a contact restore never touches another field", async () => {
    const id = await create();
    const contactId = await newContact(id, { name: "Sam Lee", email: "sam@acme.com" });
    await updateContact(A, contactId, { email: "sam@acme.org" });
    const slot = (await slotOf("EMAIL", contactId))!;
    await updateContact(A, contactId, { name: "Samuel Lee" });
    expect(await restore(A, id, slot.id, "sam@acme.org")).toMatchObject({ ok: true, data: { status: "restored" } });
    expect(await contactRow(contactId)).toMatchObject({ name: "Samuel Lee", email: "sam@acme.com" });
    expect((await slotOf("NAME", contactId))?.value).toBe("Sam Lee");
  });

  it("records who made the change: the app or the assistant", async () => {
    const id = await create(A, { ...loaded, notes: "A" });
    await updateCompany(A, id, edit({ ...loaded, notes: "A" }, { notes: "B" }), [], "ASSISTANT");
    const slot = (await slotOf("NOTES"))!;
    expect(slot.via).toBe("ASSISTANT");
    await restoreVersion(A, { companyId: id, versionId: slot.id, expect: { value: "B" } }, "ASSISTANT");
    expect((await slotOf("NOTES"))?.via).toBe("ASSISTANT");
  });
});
