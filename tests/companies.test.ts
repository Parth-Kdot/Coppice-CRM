import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { changeStage } from "@/lib/claims";
import {
  addContact,
  archiveCompany,
  createCompany,
  getCompanyDetail,
  getCompanyPage,
  MATCH_LIMIT,
  listPossibleDuplicatePairs,
  markSeparate,
  removeContact,
  resolveAsDuplicate,
  unarchiveCompany,
  updateCompany,
  updateContact,
  type CompanyFields,
  type SaveResult,
} from "@/lib/companies";
import type { Membership } from "@/lib/authz";
import { prisma, withTenant, type Tenant } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";

// Real database, connected as app_user, so row-level security applies to every call.
const A: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER_A: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const B: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

const saved = (r: SaveResult) => {
  if (r.status !== "saved") throw new Error(`expected saved, got ${r.status}`);
  return r.companyId;
};
// An edit as the form sends it: what the person typed, and what the form showed when it loaded.
const edit = (original: CompanyFields, changes: Partial<CompanyFields>) => ({ original, changes: { ...original, ...changes } });
const companyRow = (id: string) => withTenant(A, (tx) => tx.company.findUnique({ where: { id } }));
const countIn = (tenant: Tenant) => withTenant(tenant, (tx) => tx.company.count());

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("creating companies and duplicate flags", () => {
  it("creates a company and stores its match keys", async () => {
    const id = saved(await createCompany(A, { name: "Acme, Inc.", website: "https://www.acme.com/", industry: "Tech" }));
    expect(await companyRow(id)).toMatchObject({ name: "Acme, Inc.", nameKey: "acme", domainKey: "acme.com", stage: "NOT_CONTACTED" });
  });

  it("flags a look-alike name instead of creating it, and creates nothing", async () => {
    const acme = saved(await createCompany(A, { name: "Acme Corp" }));
    const result = await createCompany(A, { name: "ACME, Inc." });
    expect(result).toEqual({
      status: "possible-duplicates",
      matches: [{ id: acme, name: "Acme Corp", website: null, archived: false, matchedOn: ["name"] }],
      total: 1,
    });
    expect(await countIn(A)).toBe(1);
  });

  it("flags the same website under a different name, case-insensitively", async () => {
    saved(await createCompany(A, { name: "Amazon", website: "amazon.com" }));
    const result = await createCompany(A, { name: "AWS", website: "HTTPS://WWW.AMAZON.COM/aws" });
    expect(result).toMatchObject({ status: "possible-duplicates", matches: [{ name: "Amazon", matchedOn: ["website"] }] });
  });

  it("'Separate entries' creates it and remembers the pair, so it never flags again", async () => {
    const amazon = saved(await createCompany(A, { name: "amazon" }));
    const second = saved(await createCompany(A, { name: "Amazon" }, [amazon]));
    const decision = await withTenant(A, (tx) => tx.companyPairDecision.findFirst());
    expect(decision).toMatchObject({ decidedById: "ownerA" });
    expect([decision?.companyAId, decision?.companyBId].sort()).toEqual([amazon, second].sort());
    expect(await listPossibleDuplicatePairs(A)).toEqual([]);
    // Renaming either one of them doesn't re-ask about this pair, whichever side of it it's on.
    expect(await updateCompany(A, second, edit({ name: "Amazon" }, { name: "Amazon, Inc." }))).toEqual({ ok: true, data: { status: "saved", companyId: second } });
    expect(await updateCompany(A, amazon, edit({ name: "amazon" }, { name: "AMAZON" }))).toEqual({ ok: true, data: { status: "saved", companyId: amazon } });
  });

  it("still flags matches the person didn't acknowledge, and ignores ids that aren't matches", async () => {
    const one = saved(await createCompany(A, { name: "Acme" }));
    saved(await createCompany(A, { name: "Acme Corp" }, [one]));
    const unrelated = saved(await createCompany(A, { name: "Globex" }));
    const result = await createCompany(A, { name: "Acme LLC" }, [one, unrelated]);
    expect(result).toMatchObject({ status: "possible-duplicates", matches: [{ name: "Acme Corp" }] });
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count())).toBe(1);
  });

  it("archived look-alikes are flagged too, marked archived, so their history isn't orphaned", async () => {
    const old = saved(await createCompany(A, { name: "Initech" }));
    await archiveCompany(A, old);
    expect(await createCompany(A, { name: "Initech, Inc." })).toEqual({
      status: "possible-duplicates",
      matches: [{ id: old, name: "Initech", website: null, archived: true, matchedOn: ["name"] }],
      total: 1,
    });
    // "Separate entries" still works against an archived match.
    expect((await createCompany(A, { name: "Initech, Inc." }, [old])).status).toBe("saved");
  });

  it("another workspace's companies never flag (or leak) into yours", async () => {
    saved(await createCompany(B, { name: "Acme", website: "acme.com" }));
    expect((await createCompany(A, { name: "Acme", website: "acme.com" })).status).toBe("saved");
  });

  it("editing a company into a look-alike flags it; acknowledging saves it", async () => {
    const acme = saved(await createCompany(A, { name: "Acme" }));
    const other = saved(await createCompany(A, { name: "Globex" }));
    const flagged = await updateCompany(A, other, edit({ name: "Globex" }, { name: "acme corporation" }));
    expect(flagged).toMatchObject({ ok: true, data: { status: "possible-duplicates", matches: [{ id: acme }] } });
    expect((await companyRow(other))?.name).toBe("Globex");
    expect(await updateCompany(A, other, edit({ name: "Globex" }, { name: "acme corporation" }), [acme])).toMatchObject({ ok: true, data: { status: "saved" } });
    expect((await companyRow(other))?.nameKey).toBe("acme");
  });

  it("a company never flags itself when edited", async () => {
    const acme = saved(await createCompany(A, { name: "Acme", website: "acme.com" }));
    expect(await updateCompany(A, acme, edit({ name: "Acme", website: "acme.com" }, { name: "Acme Corp", website: "www.acme.com" }))).toMatchObject({ data: { status: "saved" } });
  });

  it("updating another workspace's company is refused and changes nothing", async () => {
    const theirs = saved(await createCompany(B, { name: "Hooli" }));
    expect(await updateCompany(A, theirs, edit({ name: "Hooli" }, { name: "Hacked" }))).toEqual({ ok: false, error: "Company not found." });
    expect(await withTenant(B, (tx) => tx.company.findUnique({ where: { id: theirs }, select: { name: true } }))).toEqual({ name: "Hooli" });
  });
});

describe("safe concurrent edits (field by field)", () => {
  const loaded: CompanyFields = { name: "Acme", industry: "Tech", website: "acme.com", notes: "met at fair" };
  const create = async () => saved(await createCompany(A, loaded));

  it("two people editing different fields both win; nothing is overwritten", async () => {
    const id = await create();
    expect(await updateCompany(A, id, edit(loaded, { website: "acme-corp.com" }))).toMatchObject({ data: { status: "saved" } });
    expect(await updateCompany(OFFICER_A, id, edit(loaded, { notes: "met at fair; follow up in Nov" }))).toMatchObject({ data: { status: "saved" } });
    expect(await companyRow(id)).toMatchObject({ website: "acme-corp.com", notes: "met at fair; follow up in Nov", domainKey: "acme-corp.com" });
  });

  it("the same field edited by two people: the second sees a conflict with the other value, and nothing changes", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { website: "acme-corp.com" }));
    const second = await updateCompany(OFFICER_A, id, edit(loaded, { website: "acme.org" }));
    expect(second).toEqual({
      ok: true,
      data: { status: "conflict", conflicts: [{ field: "website", theirs: "acme-corp.com", yours: "acme.org" }] },
    });
    expect((await companyRow(id))?.website).toBe("acme-corp.com");
  });

  it("resubmitting after seeing the conflict (with the new value as the starting point) saves", async () => {
    const id = await create();
    await updateCompany(A, id, edit(loaded, { website: "acme-corp.com" }));
    const reloaded = { ...loaded, website: "acme-corp.com" };
    expect(await updateCompany(OFFICER_A, id, edit(reloaded, { website: "acme.org" }))).toMatchObject({ data: { status: "saved" } });
    expect((await companyRow(id))?.website).toBe("acme.org");
  });

  it("a stage move by someone else never blocks a details edit", async () => {
    const id = await create();
    await changeStage(OFFICER_A, id, "CONTACTED");
    expect(await updateCompany(A, id, edit(loaded, { industry: "Fintech" }))).toMatchObject({ data: { status: "saved" } });
  });

  it("clearing a field (to empty) is a change like any other", async () => {
    const id = await create();
    expect(await updateCompany(A, id, edit(loaded, { website: null }))).toMatchObject({ data: { status: "saved" } });
    expect(await companyRow(id)).toMatchObject({ website: null, domainKey: null });
  });

  it("saving with no changes writes nothing", async () => {
    const id = await create();
    const before = (await companyRow(id))?.updatedAt;
    expect(await updateCompany(A, id, edit(loaded, {}))).toMatchObject({ data: { status: "saved" } });
    expect((await companyRow(id))?.updatedAt).toEqual(before);
  });

  it("two simultaneous edits of the same field: exactly one wins, the other gets a conflict (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      await resetAndSeed();
      const id = await create();
      const results = await Promise.all([
        updateCompany(A, id, edit(loaded, { notes: "from owner" })),
        updateCompany(OFFICER_A, id, edit(loaded, { notes: "from officer" })),
      ]);
      const statuses = results.map((r) => (r.ok ? r.data.status : "error")).sort();
      expect(statuses).toEqual(["conflict", "saved"]);
    }
  });
});

describe("the 'Possible duplicates' list and resolving pairs", () => {
  // Pairs that slipped in without a check (as an import or two simultaneous creates would).
  async function plantPair(a: string, b: string, website?: string) {
    await withTenant(A, (tx) =>
      tx.company.createMany({
        data: [
          { id: a, workspaceId: "a", name: a, nameKey: "same", domainKey: website ?? null },
          { id: b, workspaceId: "a", name: b, nameKey: "same", domainKey: website ?? null },
        ],
      }),
    );
  }

  it("lists existing look-alike pairs, with every reason they match", async () => {
    await plantPair("c1", "c2", "same.com");
    expect(await listPossibleDuplicatePairs(A)).toEqual([
      {
        a: { id: "c1", name: "c1", website: null, archived: false, matchedOn: ["name", "website"] },
        b: { id: "c2", name: "c2", website: null, archived: false, matchedOn: ["name", "website"] },
        matchedOn: ["name", "website"],
      },
    ]);
  });

  it("lists each pair once, smaller id first, whatever order the companies were created in", async () => {
    await plantPair("z9", "a1", "same.com");
    const pairs = await listPossibleDuplicatePairs(A);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id]).toEqual(["a1", "z9"]);
  });

  it("caps the list so a workspace full of identical names can't produce a huge one", async () => {
    await plantPair("c1", "c2");
    await plantPair("c3", "c4");
    expect(await listPossibleDuplicatePairs(A, 2)).toHaveLength(2);
    expect(await listPossibleDuplicatePairs(A)).toHaveLength(6);
  });

  it("editing a company with nothing to compare against just saves", async () => {
    const only = saved(await createCompany(A, { name: "Solo" }));
    expect(await updateCompany(A, only, edit({ name: "Solo" }, { name: "Solo Labs" }))).toMatchObject({ ok: true, data: { status: "saved" } });
  });

  it("refuses editing a company that doesn't exist", async () => {
    expect(await updateCompany(A, "nope", edit({ name: "Ghost" }, { name: "Ghosted" }))).toEqual({ ok: false, error: "Company not found." });
  });

  it("'Separate' removes the pair from the list for good (any member can do it)", async () => {
    await plantPair("c1", "c2");
    expect(await markSeparate(OFFICER_A, "c2", "c1")).toEqual({ ok: true, data: undefined });
    expect(await markSeparate(OFFICER_A, "c1", "c2")).toEqual({ ok: true, data: undefined });
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count())).toBe(1);
    expect(await listPossibleDuplicatePairs(A)).toEqual([]);
  });

  it("'Duplicate: remove one' archives the chosen one and keeps it in the database", async () => {
    await plantPair("c1", "c2");
    expect(await resolveAsDuplicate(OFFICER_A, "c1", "c2")).toEqual({ ok: true, data: undefined });
    expect((await companyRow("c2"))?.archivedAt).toBeInstanceOf(Date);
    expect((await companyRow("c1"))?.archivedAt).toBeNull();
    expect(await listPossibleDuplicatePairs(A)).toEqual([]);
    // Recoverable: unarchiving brings the pair back for review.
    await unarchiveCompany(A, "c2");
    expect(await listPossibleDuplicatePairs(A)).toHaveLength(1);
  });

  it("refuses resolving a company against itself or across workspaces", async () => {
    await plantPair("c1", "c2");
    const theirs = saved(await createCompany(B, { name: "Hooli" }));
    expect(await resolveAsDuplicate(A, "c1", "c1")).toMatchObject({ ok: false });
    expect(await markSeparate(A, "c1", "c1")).toEqual({ ok: false, error: "Pick two different companies." });
    expect(await resolveAsDuplicate(A, "c1", theirs)).toEqual({ ok: false, error: "Company not found." });
    expect(await markSeparate(A, "c1", theirs)).toEqual({ ok: false, error: "Company not found." });
    expect(await withTenant(B, (tx) => tx.company.findUnique({ where: { id: theirs }, select: { archivedAt: true } }))).toEqual({ archivedAt: null });
  });

  it("another workspace can't see your pairs or decisions", async () => {
    await plantPair("c1", "c2");
    await markSeparate(A, "c1", "c2");
    expect(await listPossibleDuplicatePairs(B)).toEqual([]);
    expect(await withTenant(B, (tx) => tx.companyPairDecision.count())).toBe(0);
  });
});

describe("archiving", () => {
  it("archive hides a company but keeps it; unarchive brings it back", async () => {
    const id = saved(await createCompany(A, { name: "Umbrella" }));
    expect(await archiveCompany(A, id)).toEqual({ ok: true, data: undefined });
    expect(await archiveCompany(A, id)).toMatchObject({ ok: false });
    expect(await withTenant(A, (tx) => tx.company.count({ where: { archivedAt: null } }))).toBe(0);
    expect(await countIn(A)).toBe(1);
    expect(await unarchiveCompany(A, id)).toEqual({ ok: true, data: undefined });
    expect((await companyRow(id))?.archivedAt).toBeNull();
  });

  it("can't archive another workspace's company", async () => {
    const theirs = saved(await createCompany(B, { name: "Hooli" }));
    expect(await archiveCompany(A, theirs)).toEqual({ ok: false, error: "Company not found." });
  });
});

describe("contacts", () => {
  it("adds, edits and removes a contact", async () => {
    const company = saved(await createCompany(A, { name: "Acme" }));
    const added = await addContact(A, company, { name: "Sam Lee", email: "sam@acme.com", title: "Recruiter" });
    if (!added.ok) throw new Error(added.error);
    expect(await updateContact(A, added.data.contactId, { name: "Sam Lee", title: "University Relations" })).toEqual({ ok: true, data: undefined });
    expect(await withTenant(A, (tx) => tx.contact.findUnique({ where: { id: added.data.contactId }, select: { title: true, workspaceId: true } }))).toEqual({
      title: "University Relations",
      workspaceId: "a",
    });
    expect(await removeContact(A, added.data.contactId)).toEqual({ ok: true, data: undefined });
    expect(await withTenant(A, (tx) => tx.contact.count())).toBe(0);
  });

  it("can't add a contact to, or edit/remove contacts of, another workspace", async () => {
    const theirs = saved(await createCompany(B, { name: "Hooli" }));
    const theirContact = await addContact(B, theirs, { name: "Gavin" });
    if (!theirContact.ok) throw new Error(theirContact.error);
    expect(await addContact(A, theirs, { name: "Spy" })).toEqual({ ok: false, error: "Company not found." });
    expect(await updateContact(A, theirContact.data.contactId, { name: "Hacked" })).toMatchObject({ ok: false });
    expect(await removeContact(A, theirContact.data.contactId)).toMatchObject({ ok: false });
    expect(await withTenant(B, (tx) => tx.contact.count())).toBe(1);
  });
});

describe("changeStage (lib/claims.ts)", () => {
  const history = (tenant: Tenant) =>
    withTenant(tenant, (tx) => tx.stageChange.findMany({ orderBy: { changedAt: "asc" }, select: { fromStage: true, toStage: true, changedById: true } }));

  it("moves the stage and records who moved it, from what, to what", async () => {
    const id = saved(await createCompany(A, { name: "Acme" }));
    expect(await changeStage(OFFICER_A, id, "CONTACTED")).toEqual({ ok: true, data: { changed: true, fromStage: "NOT_CONTACTED", toStage: "CONTACTED" } });
    expect(await changeStage(A, id, "REPLIED")).toMatchObject({ ok: true, data: { fromStage: "CONTACTED" } });
    expect((await companyRow(id))?.stage).toBe("REPLIED");
    expect(await history(A)).toEqual([
      { fromStage: "NOT_CONTACTED", toStage: "CONTACTED", changedById: "officerA" },
      { fromStage: "CONTACTED", toStage: "REPLIED", changedById: "ownerA" },
    ]);
  });

  it("moving to the same stage does nothing and records nothing", async () => {
    const id = saved(await createCompany(A, { name: "Acme" }));
    expect(await changeStage(A, id, "NOT_CONTACTED")).toMatchObject({ ok: true, data: { changed: false } });
    expect(await history(A)).toEqual([]);
  });

  it.each(["COMMITTED", "DECLINED"] as const)("moving to %s clears the claim", async (stage) => {
    const id = saved(await createCompany(A, { name: "Acme" }));
    await withTenant(A, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimedById" = 'officerA', "claimExpiresAt" = now() + interval '7 days' WHERE id = ${id}`);
    await changeStage(A, id, stage);
    expect(await companyRow(id)).toMatchObject({ stage, claimedById: null, claimExpiresAt: null });
  });

  it("moving to an open stage keeps the claim", async () => {
    const id = saved(await createCompany(A, { name: "Acme" }));
    await withTenant(A, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimedById" = 'officerA', "claimExpiresAt" = now() + interval '7 days' WHERE id = ${id}`);
    await changeStage(A, id, "IN_CONVERSATION");
    expect((await companyRow(id))?.claimedById).toBe("officerA");
  });

  it("refuses archived companies and other workspaces' companies", async () => {
    const archived = saved(await createCompany(A, { name: "Old" }));
    await archiveCompany(A, archived);
    const theirs = saved(await createCompany(B, { name: "Hooli" }));
    expect(await changeStage(A, archived, "CONTACTED")).toEqual({ ok: false, error: "Company not found." });
    expect(await changeStage(A, theirs, "CONTACTED")).toEqual({ ok: false, error: "Company not found." });
    expect(await history(B)).toEqual([]);
  });

  it("two simultaneous moves keep the history consistent (10 rounds)", async () => {
    for (let round = 0; round < 10; round++) {
      await resetAndSeed();
      const id = saved(await createCompany(A, { name: "Acme" }));
      await Promise.all([changeStage(A, id, "CONTACTED"), changeStage(OFFICER_A, id, "REPLIED")]);
      const moves = await history(A);
      // Each move starts where the previous one ended, and the company ends at the last "to".
      expect(moves[0].fromStage).toBe("NOT_CONTACTED");
      for (let i = 1; i < moves.length; i++) expect(moves[i].fromStage).toBe(moves[i - 1].toStage);
      expect((await companyRow(id))?.stage).toBe(moves.at(-1)?.toStage);
    }
  });

  it("another workspace can't read your stage history", async () => {
    const id = saved(await createCompany(A, { name: "Acme" }));
    await changeStage(A, id, "CONTACTED");
    expect(await history(B)).toEqual([]);
  });
});

describe("look-alikes are capped, with a total (P2)", () => {
  // 25 companies on one shared website, plus one with the same name as the new one.
  const crowd = async () => {
    await withTenant(A, (tx) =>
      tx.company.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          id: `site-${String(i).padStart(2, "0")}`,
          workspaceId: "a",
          name: `Person ${i}`,
          website: `linkedin.com/in/p${i}`,
          nameKey: `person ${i}`,
          domainKey: "linkedin.com",
        })),
      }),
    );
    return saved(await createCompany(A, { name: "Recruiter Desk" }));
  };

  it("lists at most 20, same name first, and counts them all", async () => {
    const sameName = await crowd();
    const result = await createCompany(A, { name: "Recruiter Desk, Inc.", website: "https://linkedin.com/in/someone" });
    if (result.status !== "possible-duplicates") throw new Error("expected look-alikes");
    expect(result.matches).toHaveLength(MATCH_LIMIT);
    expect(result.total).toBe(26);
    expect(result.matches[0]).toMatchObject({ id: sameName, matchedOn: ["name"] });
    expect(result.matches.slice(1).every((m) => m.matchedOn.includes("website"))).toBe(true);
  });

  it("'Separate entries' for the 20 listed covers the rest too: saved, with a decision for every match", async () => {
    await crowd();
    const first = await createCompany(A, { name: "Recruiter Desk", website: "linkedin.com/in/someone" });
    if (first.status !== "possible-duplicates") throw new Error("expected look-alikes");
    const id = saved(await createCompany(A, { name: "Recruiter Desk", website: "linkedin.com/in/someone" }, first.matches.map((m) => m.id)));
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count({ where: { OR: [{ companyAId: id }, { companyBId: id }] } }))).toBe(26);
  });

  it("acknowledging only some of the listed ones still asks about the rest, counting what is left", async () => {
    await crowd();
    const first = await createCompany(A, { name: "Recruiter Desk", website: "linkedin.com/in/someone" });
    if (first.status !== "possible-duplicates") throw new Error("expected look-alikes");
    const again = await createCompany(A, { name: "Recruiter Desk", website: "linkedin.com/in/someone" }, first.matches.slice(0, 5).map((m) => m.id));
    expect(again).toMatchObject({ status: "possible-duplicates", total: 21 });
    expect(await withTenant(A, (tx) => tx.companyPairDecision.count())).toBe(0);
  });

  it("an edit leaves out pairs already marked separate before capping", async () => {
    await crowd();
    const mine = saved(await createCompany(A, { name: "Other Name" }));
    await markSeparate(A, mine, "site-00");
    const result = await updateCompany(A, mine, edit({ name: "Other Name" }, { website: "linkedin.com/in/x" }));
    expect(result).toMatchObject({ ok: true, data: { status: "possible-duplicates", total: 24 } });
    if (!result.ok || result.data.status !== "possible-duplicates") throw new Error("expected look-alikes");
    expect(result.data.matches.map((m) => m.id)).not.toContain("site-00");
  });
});

describe("company page data (P2)", () => {
  it("counts all outreach and stage moves while loading only the latest", async () => {
    const id = saved(await createCompany(A, { name: "Busy Co", industry: "Energy" }));
    await withTenant(A, async (tx) => {
      await tx.outreach.createMany({
        data: Array.from({ length: 7 }, (_, i) => ({ workspaceId: "a", companyId: id, senderId: "ownerA", sentAt: new Date(Date.UTC(2026, 0, i + 1)) })),
      });
      await tx.stageChange.createMany({
        data: Array.from({ length: 4 }, () => ({ workspaceId: "a", companyId: id, changedById: "ownerA", fromStage: "NOT_CONTACTED" as const, toStage: "CONTACTED" as const })),
      });
    });
    const detail = await getCompanyDetail(A, id, { outreach: 3, history: 2 });
    expect(detail).toMatchObject({ outreachTotal: 7, stageChangeTotal: 4 });
    expect(detail?.outreach).toHaveLength(3);
    expect(detail?.outreach[0].sentAt.toISOString()).toBe("2026-01-07T00:00:00.000Z");
    expect(detail?.stageChanges).toHaveLength(2);
    // Never more than 500, never fewer than 1.
    expect((await getCompanyDetail(A, id, { outreach: 10_000 }))?.outreach).toHaveLength(7);
    expect((await getCompanyDetail(A, id, { outreach: 0 }))?.outreach).toHaveLength(1);
  });

  it("loads the page in one go: industries, templates and active look-alikes", async () => {
    const id = saved(await createCompany(A, { name: "Acme", industry: "Energy" }));
    const twin = saved(await createCompany(A, { name: "Acme Inc" }, [id]));
    const page = await getCompanyPage(A, id);
    expect(page?.industries).toEqual(["Energy"]);
    expect(Array.isArray(page?.templates)).toBe(true);
    // Marked separate when it was added, so it is not offered as "same as".
    expect(page?.lookAlikes).toEqual([]);
    saved(await createCompany(A, { name: "ACME corp" }, [id, twin]));
    await archiveCompany(A, twin);
    expect((await getCompanyPage(A, id))?.lookAlikes).toEqual([]);
    const fourth = await withTenant(A, (tx) =>
      tx.company.create({ data: { workspaceId: "a", name: "Acme Co", nameKey: "acme" }, select: { id: true } }),
    );
    expect((await getCompanyPage(A, id))?.lookAlikes).toEqual([{ id: fourth.id, name: "Acme Co" }]);
    expect(await getCompanyPage(B, id)).toBeNull();
  });
});
