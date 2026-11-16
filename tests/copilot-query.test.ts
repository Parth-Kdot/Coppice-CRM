import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dbNow } from "@/lib/claims";
import { createCompany } from "@/lib/companies";
import { addDays } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { filterChips, withoutChip } from "@/lib/copilot/chips";
import { DEFAULT_FILTER } from "@/lib/copilot/intent";
import { buildPlan, planItems } from "@/lib/copilot/plan";
import { COPILOT_ROWS, lookupCompany, runFilter, summaryLine } from "@/lib/copilot/query";
import { summarizeStats } from "@/lib/copilot/stats-summary";
import { scorecard, type OutreachRow } from "@/lib/stats-math";
import type { CopilotFilter } from "@/lib/validation";
import { NAMES, OFFICER, OTHER_ORG, OWNER, seedPipeline, type Pipeline } from "./helpers/copilot";
import { resetAndSeed } from "./helpers/seed";

// Filters run against seeded data, as the database sees it (see tests/helpers/copilot.ts for what
// each company is). Every list is read as officerA unless it says otherwise.
let p: Pipeline;
beforeEach(async () => {
  await resetAndSeed();
  p = await seedPipeline();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const run = async (filter: Partial<CopilotFilter>, who = OFFICER) => runFilter(who, { ...DEFAULT_FILTER, ...filter });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("the default filter", () => {
  it("lists every open company, never an archived or other workspace's, most overdue first", async () => {
    const result = await run({});
    // Open stages only (Hooli and Pied Piper are closed), dated companies by date, then the undated by name.
    expect(names(result.rows)).toEqual([NAMES.bramble, NAMES.globex, NAMES.aperture, NAMES.initech, NAMES.umbrella, "100% Pure", NAMES.acme]);
    expect(result.total).toBe(7);
    expect(names(result.rows)).not.toContain("Acme B");
    expect(names(result.rows)).not.toContain(NAMES.archived);
  });

  it("describes each row from the database: stage, due text, claim and page", async () => {
    const { rows } = await run({});
    const bramble = rows.find((r) => r.id === p.id.bramble)!;
    expect(bramble).toMatchObject({
      name: NAMES.bramble,
      industry: "Consulting",
      stage: "CONTACTED",
      stageLabel: "Contacted",
      dueLabel: "12 days overdue",
      overdue: true,
      href: `/a/companies/${p.id.bramble}`,
      claim: { state: "mine", holderName: "officerA" },
    });
    expect(bramble.claim.label).toMatch(/^Yours until [A-Z][a-z]{2} \d{1,2}$/);
    expect(rows.find((r) => r.id === p.id.globex)!.claim).toMatchObject({ state: "theirs", holderName: "ownerA" });
    expect(rows.find((r) => r.id === p.id.globex)!.claim.label).toMatch(/^ownerA until /);
    expect(rows.find((r) => r.id === p.id.initech)!.claim).toMatchObject({ state: "expired", label: "Free" });
    expect(rows.find((r) => r.id === p.id.acme)).toMatchObject({ dueLabel: "No follow-up date", overdue: false, nextFollowUpAt: null, claim: { state: "free", label: "Free" } });
    expect(rows.find((r) => r.id === p.id.aperture)).toMatchObject({ dueLabel: "Due today", overdue: true });
    expect(rows.find((r) => r.id === p.id.umbrella)!.dueLabel).toMatch(/^Due [A-Z][a-z]{2} \d{1,2}$/);
    expect(rows.every((r) => r.why === null)).toBe(true);
  });

  it("gives each row one next move from what is legal for this person right now", async () => {
    const asOfficer = (await run({})).rows;
    const move = (id: string) => asOfficer.find((r) => r.id === id)!.next;
    expect(move(p.id.bramble)).toMatchObject({ type: "LOG", label: "Log outreach", legal: true });
    expect(move(p.id.acme)).toMatchObject({ type: "CLAIM", label: "Claim", legal: true });
    // Initech's claim ended and was officerA's: logging renews it, so logging is the move.
    expect(move(p.id.initech)).toMatchObject({ type: "LOG", legal: true });
    expect(move(p.id.globex)).toMatchObject({ type: "CLAIM", legal: false, reason: expect.stringMatching(/^ownerA claimed this first\. They hold it until/) });
    // The same company for the owner: Globex is theirs to log, Bramblewick is officerA's to hold.
    const asOwner = (await run({}, OWNER)).rows;
    expect(asOwner.find((r) => r.id === p.id.globex)!.next).toMatchObject({ type: "LOG", legal: true });
    expect(asOwner.find((r) => r.id === p.id.bramble)!.next).toMatchObject({ type: "CLAIM", legal: false });
  });
});

describe("each filter field on its own", () => {
  it("stages: the ones named, closed stages included when named", async () => {
    expect(names((await run({ stages: ["CONTACTED"] })).rows)).toEqual([NAMES.bramble, NAMES.aperture, NAMES.initech]);
    expect(names((await run({ stages: ["COMMITTED", "DECLINED"] })).rows)).toEqual([NAMES.hooli, NAMES.piper].sort());
    expect(names((await run({ stages: ["REPLIED", "IN_CONVERSATION"] })).rows)).toEqual([NAMES.globex, NAMES.umbrella]);
  });

  it("stages: a stage with no companies is an empty list, and archived companies never show even when their stage is named", async () => {
    expect((await run({ stages: ["NOT_CONTACTED"], industry: "Consulting" })).total).toBe(0);
    // Archived Co is Contacted and archived: the Contacted list above never had it.
    expect(names((await run({ stages: ["CONTACTED"] })).rows)).not.toContain(NAMES.archived);
  });

  it("industry: matched without regard to case, exactly", async () => {
    expect(names((await run({ industry: "technology" })).rows)).toEqual([NAMES.globex, NAMES.initech, NAMES.acme]);
    expect(names((await run({ industry: "Health" })).rows)).toEqual([NAMES.aperture, NAMES.umbrella]);
    expect((await run({ industry: "Tech" })).total).toBe(0);
  });

  it("due overdue: the follow-up date has arrived (today counts, like the queue)", async () => {
    expect(names((await run({ due: "overdue" })).rows)).toEqual([NAMES.bramble, NAMES.globex, NAMES.aperture]);
  });

  it("due this week: the next 7 days, today not included", async () => {
    expect(names((await run({ due: "due_this_week" })).rows)).toEqual([NAMES.initech]);
    // A company due in exactly 7 days counts and one due in 8 does not.
    await withTenant(OWNER, async (tx) => {
      await tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = ((${addDays(p.today, 7)}::date)::timestamp AT TIME ZONE 'America/Indiana/Indianapolis') WHERE id = ${p.id.umbrella}`;
      await tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = ((${addDays(p.today, 8)}::date)::timestamp AT TIME ZONE 'America/Indiana/Indianapolis') WHERE id = ${p.id.acme}`;
    });
    expect(names((await run({ due: "due_this_week" })).rows)).toEqual([NAMES.initech, NAMES.umbrella]);
  });

  it("due no date: companies with no follow-up date", async () => {
    expect(names((await run({ due: "no_date" })).rows)).toEqual(["100% Pure", NAMES.acme]);
  });

  it("claim mine: held by this person with a live claim", async () => {
    expect(names((await run({ claim: "mine" })).rows)).toEqual([NAMES.bramble]);
    expect(names((await run({ claim: "mine" }, OWNER)).rows)).toEqual([NAMES.globex]);
  });

  it("claim free: nobody holds it right now, an ended claim included", async () => {
    expect(names((await run({ claim: "free" })).rows)).toEqual([NAMES.aperture, NAMES.initech, NAMES.umbrella, "100% Pure", NAMES.acme]);
  });

  it("claim held by others: someone else's live claim", async () => {
    expect(names((await run({ claim: "held_by_others" })).rows)).toEqual([NAMES.globex]);
    expect(names((await run({ claim: "held_by_others" }, OWNER)).rows)).toEqual([NAMES.bramble]);
  });

  it("never contacted: no last-contacted date and no outreach", async () => {
    expect(names((await run({ neverContacted: true })).rows)).toEqual([NAMES.globex, NAMES.initech, NAMES.umbrella, "100% Pure", NAMES.acme]);
    // An outreach entry alone (no last-contacted date) also counts as contacted.
    await withTenant(OWNER, (tx) => tx.outreach.create({ data: { workspaceId: "a", companyId: p.id.acme, senderId: "ownerA", channel: "OTHER" } }));
    expect(names((await run({ neverContacted: true })).rows)).not.toContain(NAMES.acme);
  });

  it("name or site: a substring of the name or the website, without regard to case", async () => {
    expect(names((await run({ nameOrSite: "ACME" })).rows)).toEqual([NAMES.umbrella, NAMES.acme]);
    expect(names((await run({ nameOrSite: "bramblewick" })).rows)).toEqual([NAMES.bramble]);
    expect(names((await run({ nameOrSite: "labs.example" })).rows)).toEqual([NAMES.umbrella]);
  });

  it("name or site: % and _ are the characters themselves, not wildcards", async () => {
    expect(names((await run({ nameOrSite: "100%" })).rows)).toEqual(["100% Pure"]);
    expect((await run({ nameOrSite: "%" })).total).toBe(1);
    expect((await run({ nameOrSite: "_" })).total).toBe(0);
    expect((await run({ nameOrSite: "A_me" })).total).toBe(0);
  });

  it("notes mention: company notes and outreach notes, in this workspace only", async () => {
    expect(names((await run({ notesMention: "sponsor deck" })).rows)).toEqual([NAMES.acme]);
    expect(names((await run({ notesMention: "ZEBRA" })).rows)).toEqual([NAMES.aperture]);
    expect(names((await run({ notesMention: "packet" })).rows)).toEqual([NAMES.bramble]);
    expect((await run({ notesMention: "nothing like this" })).total).toBe(0);
  });

  it("notes mention: leaves archived companies out, and reads only this workspace's outreach", async () => {
    await withTenant(OWNER, (tx) => tx.outreach.create({ data: { workspaceId: "a", companyId: p.id.archived, senderId: "ownerA", channel: "EMAIL", note: "zebra again" } }));
    expect(names((await run({ notesMention: "zebra" })).rows)).toEqual([NAMES.aperture]);
    // The other workspace sees only its own zebra.
    expect(names((await run({ notesMention: "zebra" }, OTHER_ORG)).rows)).toEqual(["Acme B"]);
  });
});

describe("sorting", () => {
  it("name: alphabetical", async () => {
    expect(names((await run({ sort: "name" })).rows)).toEqual(["100% Pure", NAMES.acme, NAMES.aperture, NAMES.bramble, NAMES.globex, NAMES.initech, NAMES.umbrella]);
  });

  it("recently contacted: the latest contact first, never-contacted last", async () => {
    await withTenant(OWNER, async (tx) => {
      await tx.$executeRaw`UPDATE "Company" SET "lastContactedAt" = now() - interval '1 day' WHERE id = ${p.id.initech}`;
      await tx.$executeRaw`UPDATE "Company" SET "lastContactedAt" = now() - interval '30 days' WHERE id = ${p.id.globex}`;
    });
    const rows = (await run({ sort: "recently_contacted" })).rows;
    expect(names(rows).slice(0, 4)).toEqual([NAMES.initech, NAMES.aperture, NAMES.bramble, NAMES.globex].sort((a, b) => 0 * a.length + 0 * b.length || 0).length ? [NAMES.initech, NAMES.aperture, NAMES.bramble, NAMES.globex] : []);
    expect(rows[rows.length - 1].lastContactedAt).toBeNull();
  });
});

describe("combined filters", () => {
  it("all of them must hold", async () => {
    expect(names((await run({ industry: "Technology", due: "overdue" })).rows)).toEqual([NAMES.globex]);
    expect(names((await run({ industry: "Technology", claim: "free", neverContacted: true })).rows)).toEqual([NAMES.initech, NAMES.acme]);
    expect(names((await run({ stages: ["CONTACTED", "REPLIED"], claim: "held_by_others", due: "overdue" })).rows)).toEqual([NAMES.globex]);
    expect((await run({ industry: "Health", claim: "mine" })).total).toBe(0);
  });
});

describe("bounds and counts", () => {
  it("shows at most 25 rows and counts the rest, counting only when the page came back full", async () => {
    for (let i = 0; i < 30; i++) await createCompany(OWNER, { name: `Filler ${String(i).padStart(2, "0")}` });
    const full = await run({ sort: "name" });
    expect(full.rows).toHaveLength(COPILOT_ROWS);
    expect(full.total).toBe(37);
    expect(full.summary).toContain("37 companies match.");
    expect(full.summary).toContain("Showing the first 25.");
    const small = await run({ stages: ["COMMITTED"] });
    expect(small.rows).toHaveLength(1);
    expect(small.total).toBe(1);
  });

  it("is exact at the page boundary", async () => {
    const before = (await run({})).total;
    for (let i = 0; i < COPILOT_ROWS - before; i++) await createCompany(OWNER, { name: `Pad ${i}` });
    const exact = await run({ sort: "name" });
    expect(exact.rows).toHaveLength(COPILOT_ROWS);
    expect(exact.total).toBe(COPILOT_ROWS);
    expect(exact.summary).not.toContain("Showing");
  });

  it("every row in a list is in the asking person's workspace", async () => {
    const mine = (await run({})).rows.map((r) => r.id);
    expect(mine).not.toContain(p.id.theirs);
    expect((await run({}, OTHER_ORG)).rows.map((r) => r.id)).toEqual([p.id.theirs]);
  });
});

describe("the summary line", () => {
  it("counts the matches and names the most overdue", async () => {
    const result = await run({ due: "overdue" });
    expect(result.summary).toBe("3 companies match. Most overdue: Bramblewick Consulting, 12 days.");
  });

  it("is singular for one, says none for none, and names no most-overdue when nothing is overdue", async () => {
    expect((await run({ stages: ["COMMITTED"] })).summary).toBe("1 company matches.");
    expect((await run({ industry: "Consulting", claim: "free" })).summary).toBe("No companies match.");
    expect((await run({ stages: ["IN_CONVERSATION"] })).summary).toBe("1 company matches.");
  });

  it("says 1 day, not 1 days", async () => {
    await withTenant(OWNER, (tx) =>
      tx.$executeRaw`UPDATE "Company" SET "nextFollowUpAt" = ((${addDays(p.today, -1)}::date)::timestamp AT TIME ZONE 'America/Indiana/Indianapolis') WHERE id = ${p.id.bramble}`,
    );
    expect((await run({ stages: ["CONTACTED"], sort: "most_overdue" })).summary).toBe("3 companies match. Most overdue: Bramblewick Consulting, 1 day.");
  });

  it("only names the most overdue when sorted that way, and not when the first row is due today", async () => {
    const rows = (await run({ due: "overdue" })).rows;
    const now = await dbNow();
    expect(summaryLine(3, rows, { ...DEFAULT_FILTER, sort: "name" }, now)).toBe("3 companies match.");
    expect(summaryLine(1, rows.filter((r) => r.dueLabel === "Due today"), DEFAULT_FILTER, now)).toBe("1 company matches.");
  });
});

describe("finding a company by name", () => {
  it("one match is that company, wherever the text sits in the name, whatever its case", async () => {
    expect(await lookupCompany(OFFICER, "bramblewick")).toEqual({ kind: "one", id: p.id.bramble });
    expect(await lookupCompany(OFFICER, "PIED")).toEqual({ kind: "one", id: p.id.piper });
  });

  it("several matches are several, but an exact name wins over longer ones that contain it", async () => {
    await createCompany(OWNER, { name: "Globex Labs" });
    await createCompany(OWNER, { name: "Initech Europe" });
    expect(await lookupCompany(OFFICER, "Globex")).toEqual({ kind: "one", id: p.id.globex });
    expect(await lookupCompany(OFFICER, "initech")).toEqual({ kind: "one", id: p.id.initech });
    expect(await lookupCompany(OFFICER, "labs")).toMatchObject({ kind: "one" });
    await createCompany(OWNER, { name: "Another Labs" });
    expect(await lookupCompany(OFFICER, "labs")).toEqual({ kind: "many" });
  });

  it("none for a name that matches nothing, an archived company, or a company in another workspace", async () => {
    expect(await lookupCompany(OFFICER, "nobody at all")).toEqual({ kind: "none" });
    expect(await lookupCompany(OFFICER, "Archived Co")).toEqual({ kind: "none" });
    expect(await lookupCompany(OFFICER, "Acme B")).toEqual({ kind: "none" });
    expect(await lookupCompany(OTHER_ORG, "Acme B")).toEqual({ kind: "one", id: p.id.theirs });
  });

  it("treats % as a character, so '%' alone doesn't match everything", async () => {
    expect(await lookupCompany(OFFICER, "%")).toMatchObject({ kind: "one", id: p.id.pure });
    expect(await lookupCompany(OFFICER, "_")).toEqual({ kind: "none" });
  });
});

describe("filter chips", () => {
  it("shows every field that is set, and always the stages and the sort", () => {
    expect(filterChips(DEFAULT_FILTER)).toEqual([
      { key: "stages", label: "Open stages", removable: false },
      { key: "sort", label: "Sorted by most overdue", removable: false },
    ]);
    expect(
      filterChips({ stages: ["CONTACTED", "IN_CONVERSATION"], industry: "Technology", due: "overdue", claim: "mine", neverContacted: true, nameOrSite: "acme", notesMention: "zebra", sort: "name" }).map((c) => c.label),
    ).toEqual([
      "Stage: Contacted, In conversation",
      "Overdue",
      "Held by me",
      "Industry: Technology",
      "Never contacted",
      'Name or website has "acme"',
      'Notes mention "zebra"',
      "Sorted by name",
    ]);
  });

  it("takes a chip off by putting its field back at the default, one field only", () => {
    const filter: CopilotFilter = { ...DEFAULT_FILTER, due: "overdue", claim: "mine", industry: "Technology", stages: ["CONTACTED"] };
    expect(withoutChip(filter, "claim")).toEqual({ ...filter, claim: "any" });
    expect(withoutChip(filter, "industry")).toEqual({ ...filter, industry: null });
    expect(withoutChip(filter, "stages")).toEqual({ ...filter, stages: [] });
    expect(filterChips(filter).find((c) => c.key === "claim")).toMatchObject({ removable: true });
  });
});

describe("Plan my 30 minutes", () => {
  it("is minutes divided by five companies, from 1 to 10", () => {
    expect([5, 10, 25, 30, 47, 60, 120].map(planItems)).toEqual([1, 2, 5, 6, 9, 10, 10]);
  });

  it("puts overdue companies you hold first, then free overdue ones, then fresh leads", async () => {
    const plan = await buildPlan(OFFICER, 30);
    expect(plan.rows.map((r) => [r.name, r.why])).toEqual([
      [NAMES.bramble, "Yours and overdue"],
      [NAMES.aperture, "Free and overdue"],
      // Fresh leads: never contacted, no date, not held by someone else, newest first.
      ["100% Pure", "Never contacted"],
      [NAMES.acme, "Never contacted"],
    ]);
    expect(plan.summary).toBe("A plan for 30 minutes: 4 companies, about 5 minutes each.");
  });

  it("leaves out companies someone else holds, closed and archived ones, and other workspaces' companies", async () => {
    const ids = (await buildPlan(OFFICER, 120)).rows.map((r) => r.id);
    for (const key of ["globex", "hooli", "piper", "archived", "theirs", "umbrella", "initech"]) expect(ids).not.toContain(p.id[key]);
  });

  it("is bounded by the minutes asked", async () => {
    const plan = await buildPlan(OFFICER, 10);
    expect(plan.rows.map((r) => r.name)).toEqual([NAMES.bramble, NAMES.aperture]);
    expect(plan.items).toBe(2);
    expect((await buildPlan(OFFICER, 5)).rows.map((r) => r.name)).toEqual([NAMES.bramble]);
  });

  it("takes at most ten companies, however many minutes", async () => {
    for (let i = 0; i < 14; i++) await createCompany(OWNER, { name: `Lead ${String(i).padStart(2, "0")}` });
    const plan = await buildPlan(OFFICER, 120);
    expect(plan.rows).toHaveLength(10);
    expect(plan.rows.slice(0, 2).map((r) => r.name)).toEqual([NAMES.bramble, NAMES.aperture]);
  });

  it("gives each company its next move, as legal for this person", async () => {
    const plan = await buildPlan(OFFICER, 30);
    expect(plan.rows.map((r) => r.next?.type)).toEqual(["LOG", "CLAIM", "CLAIM", "CLAIM"]);
    expect(plan.rows.every((r) => r.next?.legal)).toBe(true);
  });

  it("is different for the owner: Globex is theirs", async () => {
    const plan = await buildPlan(OWNER, 30);
    expect(plan.rows[0]).toMatchObject({ name: NAMES.globex, why: "Yours and overdue" });
    expect(plan.rows.map((r) => r.name)).not.toContain(NAMES.bramble);
  });

  it("says so when nothing is due and there are no fresh leads", async () => {
    await withTenant(OWNER, (tx) => tx.company.updateMany({ where: { workspaceId: "a" }, data: { archivedAt: new Date() } }));
    expect(await buildPlan(OFFICER, 30)).toMatchObject({ rows: [], summary: "Nothing is due and there are no fresh leads right now." });
  });

  it("mentions how many are due in all when the plan can't hold them", async () => {
    const plan = await buildPlan(OFFICER, 10);
    expect(plan.summary).toBe("A plan for 10 minutes: 2 companies, about 5 minutes each.");
    for (let i = 0; i < 4; i++) {
      const made = await createCompany(OWNER, { name: `Due ${i}` });
      if (made.status === "saved") {
        await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET stage = 'CONTACTED'::"Stage", "nextFollowUpAt" = now() - interval '2 days' WHERE id = ${made.companyId}`);
      }
    }
    expect((await buildPlan(OFFICER, 10)).summary).toBe("A plan for 10 minutes: 2 companies, about 5 minutes each. 6 are due in all.");
  });
});

describe("the stats summary", () => {
  const NOW = new Date("2026-11-13T12:00:00Z");
  const sends = (templateId: string, n: number, replies: number, prefix: string): OutreachRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      companyId: `${prefix}c${i}`,
      templateId,
      channel: "EMAIL" as const,
      sentAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000),
      gotReply: i < replies,
      aiDrafted: false,
      industry: null,
    }));

  it("names the best and the worst template when the ranges don't overlap, and gives the counts", () => {
    const card = scorecard(
      {
        now: NOW,
        rows: [...sends("t1", 40, 30, "a"), ...sends("t2", 40, 2, "b"), ...sends("t3", 40, 12, "c")],
        templates: [
          { id: "t1", name: "Warm intro", archived: false },
          { id: "t2", name: "Cold pitch", archived: false },
          { id: "t3", name: "Follow-up", archived: false },
        ],
        repliedCompanyIds: [],
      },
      "none",
    );
    const summary = summarizeStats(card, "a");
    expect(summary.lines[0]).toBe("Best template: Warm intro, 75% replied (40 counted sends).");
    expect(summary.lines[1]).toBe("Weakest template: Cold pitch, 5% replied (40 counted sends).");
    expect(summary.lines[2]).toBe("120 emails and messages logged, 3 of 3 templates used, 44 counted replies.");
    expect(summary.href).toBe("/a/stats");
  });

  it("names nobody when too few sends are counted", () => {
    const card = scorecard({ now: NOW, rows: sends("t1", 5, 2, "a"), templates: [{ id: "t1", name: "Warm intro", archived: false }], repliedCompanyIds: [] }, "none");
    expect(summarizeStats(card, "a").lines).toEqual([
      "Too few sends yet to name a best or worst: a template needs 20 counted sends.",
      "5 emails and messages logged, 1 of 1 template used, 2 counted replies.",
    ]);
  });

  it("says so when nothing was logged, and notes replied companies with no reply marked", () => {
    const empty = summarizeStats(scorecard({ now: NOW, rows: [], templates: [], repliedCompanyIds: ["x", "y"] }, "none"), "a");
    expect(empty.lines).toEqual([
      "Too few sends yet to name a best or worst: a template needs 20 counted sends.",
      "No outreach has been logged yet.",
      "2 replied companies have no reply marked.",
    ]);
  });

  it("is read from the workspace by the existing stats code", async () => {
    const { statsSummary } = await import("@/lib/copilot/stats-summary");
    const summary = await statsSummary(OFFICER);
    // Globex, Umbrella and Hooli are in reply stages and no outreach of theirs is marked as the reply.
    expect(summary.lines).toContain("3 replied companies have no reply marked.");
    expect(summary.href).toBe("/a/stats");
  });
});
