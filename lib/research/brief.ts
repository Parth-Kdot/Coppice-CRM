import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { BriefStatus } from "@/generated/prisma/enums";
import { AI_WINDOW_DAYS, aiGate, DAILY_BRIEFS_PER_PERSON, runAi } from "@/lib/ai/run";
import { promptSafe } from "@/lib/ai/text";
import { dbNow } from "@/lib/claims";
import { DAY_MS } from "@/lib/dates";
import { isStale, verifiedFacts } from "@/lib/facts";
import { isSerializationFailure, withTenant, type Tenant } from "@/lib/db";
import { domainKey } from "@/lib/duplicates";
import { notFound } from "@/lib/messages";
import { BLOCKED, BriefOut, Passages, READ_SYSTEM, WRITE_SYSTEM, writingPrompt } from "@/lib/research/brief-prompt";
import { checkItems, checkPassages, type BriefItem } from "@/lib/research/checks";
import { DOORS } from "@/lib/research/doors";
import { checkAsk, checkFlags, checkHook, checkTies, tierFacts, type TierFact } from "@/lib/research/section-checks";
import { FLAG_KINDS, type BriefAsk, type BriefFlag, type BriefHook, type BriefTie } from "@/lib/research/sections";
import { defaultDeps, fetchResearchPage, LIMITS, type FetchDeps, type Limits } from "@/lib/research/fetch";
import { htmlToText, tidy } from "@/lib/research/html";
import { injectionFlags, maskPage, pageHead, teamInboxes } from "@/lib/research/scan";
import { SKIP_MESSAGES, type SkipReason } from "@/lib/research/urls";
import type { ActionResult } from "@/lib/validation";

// Research briefs: a cited brief on which door to knock on at a company (campus recruiting,
// university relations, a giving or sponsorship portal and its deadline, an employee resource
// group, a local site), built only from pages an owner approved. In order:
// 1. The usual AI gate (switch, workspace limit, this person's daily limit, which counts every
//    brief asked for as well as every reading call), before anything else. Then the brief is
//    written as RUNNING, in a transaction that counts again, so requests sent in parallel can't
//    all pass the limit, and a person has one brief running at a time (reserveBrief).
// 2. The server fetches the chosen sources itself, in parallel, through the safe fetcher
//    (lib/research/fetch.ts): robots.txt honored, private networks refused, 15 s per page.
// 3. Code extracts each page's text, keeps the first 30,000 characters, masks emails and phone
//    numbers, flags text that tries to instruct an AI, and notes team inboxes (careers@ ...) at
//    the page's own site or the company's.
// 4. Reading call (RESEARCH_READ): the AI sees only the page text, wrapped and labelled as data,
//    plus the company's name and website. Never notes, contacts or outreach. It returns passages,
//    each quoted from a page; code keeps only quotes it finds on that page.
// 5. Writing call (RESEARCH_BRIEF): a separate call, no tools, sees only the checked passages and
//    turns them into brief items. Code keeps an item only if its quote is on the page it cites, its
//    numbers and deadline appear in that quote, it holds no contact details, and every site it
//    names, in any form, is a page that was fetched (lib/research/checks.ts). The only link shown
//    for an item is the page it cites.
// 6. The brief (now READY, NO_PAGES, or FAILED if an AI call failed) and each page's stored text
//    are saved. Only READY and NO_PAGES briefs are ever shown. Nothing touches the company until a
//    person adds a specific item to its notes (lib/research/accept.ts, through lib/companies.ts).
// Both AI calls run outside any database transaction, each within the deadline in lib/ai/client.ts,
// so with the fetches a brief stays well inside Vercel's 300 seconds.

// What CompanyBrief.brief holds: { items, ties, flags, hook, ask }. Briefs saved before the
// sections existed hold only items, so each section falls back to empty, and a section that no
// longer reads falls back too without costing the brief its doors.
const StoredBrief = z.object({
  items: z.array(
    z.object({ id: z.string(), door: z.enum(DOORS), title: z.string(), detail: z.string(), deadline: z.string().nullable(), page: z.number().int(), quote: z.string() }),
  ),
  ties: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string(), page: z.number().int(), quote: z.string() })).catch([]),
  flags: z.array(z.object({ id: z.string(), kind: z.enum(FLAG_KINDS), title: z.string(), page: z.number().int(), quote: z.string() })).catch([]),
  hook: z.object({ id: z.string(), line: z.string(), page: z.number().int(), quote: z.string() }).nullable().catch(null),
  ask: z
    .object({ id: z.string(), factId: z.string(), factText: z.string(), reason: z.string(), page: z.number().int(), quote: z.string() })
    .nullable()
    .catch(null),
});
export type StoredBrief = z.infer<typeof StoredBrief>;

// A stored brief read back, or null when even its doors no longer read. Other features that read
// accepted brief items (the Claim Checker) use this rather than parsing the Json themselves.
export function parseStoredBrief(json: unknown): StoredBrief | null {
  const parsed = StoredBrief.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ----- Reading the pages -----

type PageRecord = {
  position: number;
  url: string;
  finalUrl: string | null;
  fetchedAt: Date | null;
  skipReason: SkipReason | null;
  sha256: string | null;
  text: string | null;
  injection: string[];
  inboxes: string[];
};

// The team inboxes found on a page, written as "[team inbox]" in the text the AI reads, so a
// passage about one isn't mistaken for one about a person's address (which reads "[email]").
function markInboxes(head: string, inboxes: string[]): string {
  return inboxes.reduce((text, email) => text.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[team inbox]"), head);
}

async function readPage(position: number, url: string, approvedHosts: string[], companySite: string | null, fetchOptions: FetchOptions): Promise<PageRecord> {
  const skipped = (reason: SkipReason): PageRecord => ({ position, url, finalUrl: null, fetchedAt: null, skipReason: reason, sha256: null, text: null, injection: [], inboxes: [] });
  const page = await fetchResearchPage(url, { approvedHosts, ...fetchOptions });
  if (!page.ok) return skipped(page.reason);
  const head = pageHead(page.contentType === "text/plain" ? tidy(page.body) : htmlToText(page.body));
  const sites = [new URL(page.finalUrl).hostname, ...(companySite ? [companySite] : [])];
  const inboxes = teamInboxes(head, sites);
  // What the AI is shown is also what is stored, to check its quotes against.
  const text = maskPage(markInboxes(head, inboxes));
  if (!text.trim()) return skipped("empty");
  return {
    position,
    url,
    finalUrl: page.finalUrl,
    fetchedAt: new Date(),
    skipReason: null,
    sha256: createHash("sha256").update(text).digest("hex"),
    text,
    injection: injectionFlags(head),
    inboxes,
  };
}

// ----- Asking for a brief -----

type FetchOptions = { deps?: FetchDeps; limits?: Limits; robots?: Map<string, Promise<string | null | "unreachable">> };

// How long a brief can be running. Vercel stops a function after at most 300 seconds (the company
// page asks for 240), so a RUNNING row older than this was cut off and no longer holds anyone up.
export const BRIEF_RUNNING_MS = 300_000;
const RESERVE_ATTEMPTS = 5;

const DAILY_LIMIT_ERROR = `You've asked for ${DAILY_BRIEFS_PER_PERSON} research briefs in the last 24 hours. Try again tomorrow.`;
const RUNNING_ERROR = "Your last brief is still being prepared. Wait for it to finish, then ask again.";
const WORKSPACE_LIMIT_ERROR = "A brief takes two AI calls, and this workspace has fewer left for the last 30 days. An owner can raise the limit in Settings.";
const BUSY_ERROR = "Too many briefs were asked for at the same moment. Try again.";

// Takes this person's slot before anything is fetched: in one serializable transaction, count
// their briefs in the last 24 hours (every status, also ones that read no page or failed: each
// fetched other people's pages), refuse while one of theirs is still running, check the
// workspace has two AI calls left besides the ones briefs running now will make, and write the
// new brief as RUNNING. Parallel requests can't all pass the count: Postgres fails all but one of
// them, and those run again and see the new row.
async function reserveBrief(tenant: Tenant, companyId: string): Promise<ActionResult<string>> {
  const now = (await dbNow()).getTime();
  const since = new Date(now - DAY_MS);
  const runningSince = new Date(now - BRIEF_RUNNING_MS);
  const aiSince = new Date(now - AI_WINDOW_DAYS * DAY_MS);
  for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
    try {
      return await withTenant(
        tenant,
        async (tx): Promise<ActionResult<string>> => {
          const mine = { workspaceId: tenant.workspaceId, createdById: tenant.userId };
          if ((await tx.companyBrief.count({ where: { ...mine, createdAt: { gte: since } } })) >= DAILY_BRIEFS_PER_PERSON) {
            return { ok: false, error: DAILY_LIMIT_ERROR };
          }
          if ((await tx.companyBrief.count({ where: { ...mine, status: "RUNNING", createdAt: { gte: runningSince } } })) > 0) {
            return { ok: false, error: RUNNING_ERROR };
          }
          const { aiMonthlyLimit: aiLimit } = await tx.workspace.findUniqueOrThrow({ where: { id: tenant.workspaceId }, select: { aiMonthlyLimit: true } });
          const used = await tx.aiRun.count({ where: { workspaceId: tenant.workspaceId, createdAt: { gte: aiSince } } });
          const running = await tx.companyBrief.count({ where: { workspaceId: tenant.workspaceId, status: "RUNNING", createdAt: { gte: runningSince } } });
          if (aiLimit - used - 2 * running < 2) return { ok: false, error: WORKSPACE_LIMIT_ERROR };
          const brief = await tx.companyBrief.create({
            data: { workspaceId: tenant.workspaceId, companyId, createdById: tenant.userId, status: "RUNNING", brief: { items: [] } },
            select: { id: true },
          });
          return { ok: true, data: brief.id };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (e) {
      if (!isSerializationFailure(e)) throw e;
    }
  }
  return { ok: false, error: BUSY_ERROR };
}

export async function requestBrief(tenant: Tenant, companyId: string, sourceIds: string[], fetchOptions: FetchOptions = {}): Promise<ActionResult<BriefView>> {
  // Refused before any page is fetched: AI off, no key, workspace limit or this person's daily limit.
  const gate = await aiGate(tenant, "RESEARCH_READ");
  if (!gate.ok) return gate;

  const { company, sources } = await withTenant(tenant, async (tx) => ({
    company: await tx.company.findFirst({ where: { id: companyId, workspaceId: tenant.workspaceId }, select: { name: true, website: true, archivedAt: true } }),
    sources: await tx.researchSource.findMany({ where: { workspaceId: tenant.workspaceId, archivedAt: null }, select: { id: true, url: true } }),
  }));
  if (!company) return notFound("Company");
  if (company.archivedAt) return { ok: false, error: "This company is archived. Unarchive it first." };
  const chosen = sourceIds.map((id) => sources.find((s) => s.id === id));
  if (chosen.some((s) => !s)) return { ok: false, error: "That source isn't on the approved list any more. Reload the page." };
  // Redirects may stay on the host of any approved source; nothing else is ever fetched.
  const approvedHosts = sources.map((s) => new URL(s.url).hostname);

  // The workspace's limit is checked here, in the same transaction that writes the brief: two AI
  // calls must be left besides the ones briefs running now will make.
  const reserved = await reserveBrief(tenant, companyId);
  if (!reserved.ok) return reserved;
  const briefId = reserved.data;
  try {
    // The verified facts that name a tier or price, read outside any transaction, for the
    // suggested ask. Only their text reaches the writing call.
    const tiers = tierFacts(await verifiedFacts(tenant), await dbNow());
    const outcome = await buildBrief(tenant, company, chosen.map((s) => (s as { url: string }).url), approvedHosts, tiers, fetchOptions);
    await finishBrief(tenant, briefId, outcome);
    if (!outcome.ok) return { ok: false, error: outcome.error };
  } catch (e) {
    await finishBrief(tenant, briefId, { ok: false, error: "", records: [] });
    throw e;
  }
  const view = await loadBrief(tenant, { id: briefId, companyId });
  return view ? { ok: true, data: view } : notFound("Brief");
}

// What a brief found, as stored in CompanyBrief.brief.
type Sections = { items: BriefItem[]; ties: BriefTie[]; flags: BriefFlag[]; hook: BriefHook | null; ask: BriefAsk | null };
const NOTHING: Sections = { items: [], ties: [], flags: [], hook: null, ask: null };

// What a brief came to: its status and checked sections, or the AI's error; and the pages either way.
type Outcome =
  | { ok: true; status: "READY" | "NO_PAGES"; sections: Sections; records: PageRecord[]; model: string | null }
  | { ok: false; error: string; records: PageRecord[] };

async function buildBrief(
  tenant: Tenant,
  company: { name: string; website: string | null },
  urls: string[],
  approvedHosts: string[],
  tiers: TierFact[],
  fetchOptions: FetchOptions,
): Promise<Outcome> {
  const options = { deps: defaultDeps, limits: LIMITS, robots: new Map(), ...fetchOptions };
  const companySite = domainKey(company.website);
  const records = await Promise.all(urls.map((url, i) => readPage(i + 1, url, approvedHosts, companySite, options)));
  const read = records.filter((r) => r.text);
  if (read.length === 0) return { ok: true, status: "NO_PAGES", sections: NOTHING, records, model: null };

  const pages = new Map(read.map((r) => [r.position, r]));
  const document = read
    .map((r) => `<page number="${r.position}" url="${r.finalUrl}"${r.injection.length > 0 ? ' flagged="true"' : ""}>\n${r.text}\n</page>`)
    .join("\n");
  const reading = await runAi(tenant, {
    feature: "RESEARCH_READ",
    system: READ_SYSTEM,
    prompt: `<company>\nName: ${promptSafe(company.name)}\nWebsite: ${promptSafe(company.website ?? "unknown")}\n</company>\n\n${document}\n\nList the passages about the company's official channels.`,
    schema: Passages,
  }, { messages: { blocked: BLOCKED } });
  if (!reading.ok) return { ok: false, error: reading.error, records };
  const passages = checkPassages(reading.data.passages, pages, company.name);
  if (passages.length === 0) return { ok: true, status: "READY", sections: NOTHING, records, model: reading.model };

  const writing = await runAi(tenant, {
    feature: "RESEARCH_BRIEF",
    system: WRITE_SYSTEM,
    prompt: writingPrompt(company.name, passages, tiers),
    schema: BriefOut,
  }, { messages: { blocked: BLOCKED } });
  if (!writing.ok) return { ok: false, error: writing.error, records };
  const out = writing.data;
  const context = { passages, pages, company: company.name };
  const sections: Sections = {
    items: checkItems(out.items, passages, pages, company.name),
    ties: checkTies(out.ties, context),
    flags: checkFlags(out.flags, context),
    hook: checkHook(out.hook, context),
    ask: checkAsk(out.ask, tiers, context),
  };
  return { ok: true, status: "READY", sections, records, model: writing.model };
}

// Marks the RUNNING row READY, NO_PAGES or FAILED, with the pages it read.
async function finishBrief(tenant: Tenant, briefId: string, outcome: Outcome): Promise<void> {
  await withTenant(tenant, async (tx) => {
    await tx.companyBrief.update({
      where: { id: briefId, workspaceId: tenant.workspaceId },
      data: outcome.ok ? { status: outcome.status, brief: outcome.sections, model: outcome.model } : { status: "FAILED" },
    });
    await tx.companyBriefPage.createMany({ data: outcome.records.map((r) => ({ workspaceId: tenant.workspaceId, briefId, ...r })) });
  });
}

// ----- Showing a brief -----

type BriefPageView = {
  position: number;
  url: string;
  finalUrl: string | null;
  fetchedAt: Date | null;
  skipped: string | null;
  injection: string[];
};
export type BriefView = {
  id: string;
  status: BriefStatus;
  createdAt: Date;
  createdBy: string;
  items: (BriefItem & { url: string; accepted: boolean })[];
  inboxes: { id: string; email: string; url: string; accepted: boolean }[];
  ties: (BriefTie & { url: string; accepted: boolean })[];
  flags: (BriefFlag & { url: string; accepted: boolean })[];
  hook: (BriefHook & { url: string; accepted: boolean }) | null;
  // `changed`: the fact it names was edited, unverified or deleted since, so it can't be added.
  // `old`: the fact was last verified over a year ago (the fact sheet's Stale badge); it can still be added.
  ask: (BriefAsk & { url: string; accepted: boolean; changed: boolean; old: boolean }) | null;
  pages: BriefPageView[];
  // A newer brief that found nothing in any section (no page read, nothing that checked out, or
  // only a team inbox), shown as a short notice above this one, with its inboxes, instead of hiding it.
  newer?: { status: BriefStatus; createdAt: Date; createdBy: string; inboxes: { email: string; url: string }[] } | null;
};

const SHOWN: BriefStatus[] = ["READY", "NO_PAGES"];
const inboxId = (position: number, index: number) => `m${position}-${index + 1}`;

// How many recent briefs latestBrief looks through for one that found something.
const LATEST_LOOKBACK = 10;

export async function loadBrief(tenant: Tenant, where: { id?: string; companyId: string }): Promise<BriefView | null> {
  return withTenant(tenant, async (tx) => {
    const recent = await tx.companyBrief.findMany({
      // Only finished briefs: one still RUNNING or one that FAILED is never shown or accepted from.
      where: { ...where, workspaceId: tenant.workspaceId, status: { in: SHOWN } },
      select: { id: true, status: true, createdAt: true, brief: true, accepted: true, createdBy: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: where.id ? 1 : LATEST_LOOKBACK,
    });
    if (recent.length === 0) return null;
    // The latest brief that found something (storedHasFindings). A newer one that found nothing
    // (only a team inbox, or nothing) becomes a notice above it, with its inboxes, so one thin
    // request never hides a useful brief from everyone. With nothing found anywhere, the latest
    // brief that found an inbox, else the latest.
    let brief = recent[0];
    let newer: BriefView["newer"] = null;
    if (!where.id && !storedHasFindings(recent[0].brief)) {
      const earlier = recent.slice(1).find((b) => storedHasFindings(b.brief)) ?? (await firstWithInbox(tx, tenant, recent));
      if (earlier && earlier.id !== recent[0].id) {
        brief = earlier;
        const latestPages = await tx.companyBriefPage.findMany({
          where: { briefId: recent[0].id, workspaceId: tenant.workspaceId, inboxes: { isEmpty: false } },
          select: { finalUrl: true, inboxes: true },
          orderBy: { position: "asc" },
        });
        newer = {
          status: recent[0].status,
          createdAt: recent[0].createdAt,
          createdBy: recent[0].createdBy.name,
          inboxes: latestPages.flatMap((p) => (p.finalUrl ? p.inboxes.map((email) => ({ email, url: p.finalUrl as string })) : [])),
        };
      }
    }
    // Never the stored text: the page doesn't need it.
    const pages = await tx.companyBriefPage.findMany({
      where: { briefId: brief.id, workspaceId: tenant.workspaceId },
      select: { position: true, url: true, finalUrl: true, fetchedAt: true, skipReason: true, injection: true, inboxes: true },
      orderBy: { position: "asc" },
    });
    const byPosition = new Map(pages.map((p) => [p.position, p]));
    const stored = parseStoredBrief(brief.brief);
    // Each entry links to the fetched page it quotes; one whose page has no fetched address is dropped.
    const shown = <T extends { id: string; page: number }>(entry: T): (T & { url: string; accepted: boolean })[] => {
      const url = byPosition.get(entry.page)?.finalUrl;
      return url ? [{ ...entry, url, accepted: brief.accepted.includes(entry.id) }] : [];
    };
    const items = (stored?.items ?? []).flatMap(shown);
    const ties = (stored?.ties ?? []).flatMap(shown);
    const flags = (stored?.flags ?? []).flatMap(shown);
    const hook = stored?.hook ? (shown(stored.hook)[0] ?? null) : null;
    const askShown = stored?.ask ? (shown(stored.ask)[0] ?? null) : null;
    let ask: BriefView["ask"] = null;
    if (askShown) {
      // The fact the ask named, as it is now: edited, unverified or deleted means the ask changed.
      const fact = await tx.factSheetItem.findFirst({
        where: { id: askShown.factId, workspaceId: tenant.workspaceId },
        select: { text: true, verifiedAt: true, createdAt: true },
      });
      const now = await dbNow();
      ask = { ...askShown, changed: !fact || fact.verifiedAt === null || fact.text !== askShown.factText, old: fact !== null && isStale(fact, now) };
    }
    const inboxes = pages.flatMap((p) =>
      p.finalUrl ? p.inboxes.map((email, i) => ({ id: inboxId(p.position, i), email, url: p.finalUrl as string, accepted: brief.accepted.includes(inboxId(p.position, i)) })) : [],
    );
    return {
      id: brief.id,
      status: brief.status,
      createdAt: brief.createdAt,
      createdBy: brief.createdBy.name,
      items,
      inboxes,
      ties,
      flags,
      hook,
      ask,
      newer,
      pages: pages.map((p) => ({
        position: p.position,
        url: p.url,
        finalUrl: p.finalUrl,
        fetchedAt: p.fetchedAt,
        skipped: p.skipReason ? (SKIP_MESSAGES[p.skipReason as SkipReason] ?? "The page couldn't be read.") : null,
        injection: p.injection,
      })),
    };
  });
}

// Whether a stored brief found something: a door, a tie, a red flag, the hook or the ask (a team
// inbox alone doesn't count: see loadBrief). A stored ask counts whatever its state, because it
// still shows, with its "changed" line when its fact changed; checking that here would cost a
// query per brief while picking, so it isn't.
export function storedHasFindings(json: unknown): boolean {
  const stored = parseStoredBrief(json);
  return stored !== null && (stored.items.length > 0 || stored.ties.length > 0 || stored.flags.length > 0 || stored.hook !== null || stored.ask !== null);
}

// The first of these briefs that found a team inbox on a page it read, if any.
async function firstWithInbox<B extends { id: string }>(tx: Prisma.TransactionClient, tenant: Tenant, briefs: B[]): Promise<B | undefined> {
  const withInbox = await tx.companyBriefPage.findMany({
    where: { briefId: { in: briefs.map((b) => b.id) }, workspaceId: tenant.workspaceId, inboxes: { isEmpty: false } },
    select: { briefId: true },
  });
  const ids = new Set(withInbox.map((p) => p.briefId));
  return briefs.find((b) => ids.has(b.id));
}

// The latest brief for this company that found something, whoever asked for it (see loadBrief).
export function latestBrief(tenant: Tenant, companyId: string): Promise<BriefView | null> {
  return loadBrief(tenant, { companyId });
}
