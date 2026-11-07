import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ActionForm } from "@/components/action-form";
import { BriefPanel } from "@/components/brief-panel";
import { ClaimPanel } from "@/components/claim-panel";
import { CompanyForm } from "@/components/company-form";
import { DraftPanel } from "@/components/draft-panel";
import { MoveToButton, StageMover } from "@/components/stage-form";
import { ArchivedContacts, Block, CompanyHeader, ContactsBlock, HistoryBlock, LogHashFocus, OutreachBlock } from "@/components/ledger/company-blocks";
import { LazyDisclosure } from "@/components/ledger/disclosure";
import { ChevronLeftIcon } from "@/components/ledger/icons";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { isLongOverdue, OverdueMark } from "@/components/ledger/overdue";
import { RouteMap } from "@/components/ledger/route-map";
import { BackToList } from "@/components/ledger/shell";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage, DAILY_DRAFTS_PER_PERSON, draftsToday } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { factNumbers } from "@/lib/claim-rules";
import { claimView, dbNow, dbToday } from "@/lib/claims";
import { DETAIL_TAKE, getCompanyPage } from "@/lib/companies";
import { daysBetween, day } from "@/lib/dates";
import { recentDrafts } from "@/lib/drafts";
import { domainKey } from "@/lib/duplicates";
import { latestBrief } from "@/lib/research/brief";
import { listSources } from "@/lib/research/sources";
import { verifiedFacts } from "@/lib/facts";
import { REPLY_STAGES, TERMINAL_STAGES, STAGE_LABELS } from "@/lib/stages";
import { websiteHref } from "@/lib/validation";
import {
  addContact,
  archiveAsDuplicate,
  archiveCompany,
  claimCompany,
  forceRelease,
  logOutreach,
  moveStage,
  releaseClaim,
  removeContact,
  unarchiveCompany,
  updateCompany,
  updateContact,
} from "../actions";
import { checkDraft, draftEmail } from "../draft-actions";
import { acceptBriefItem, requestBrief } from "../research-actions";
import { pageTitle } from "../../page-title";
import "@/components/ledger/company.css";

// Drafting an email waits on the AI for up to 100 seconds. A research brief fetches pages (15 s)
// and then makes two AI calls of up to 100 seconds each, so the page allows 240 (Vercel's cap is 300).
export const maxDuration = 240;

// The company and what its page needs, read once per request: generateMetadata and the page share
// it (React cache), and it is one transaction (lib/companies.ts getCompanyPage). Not found and "in
// another workspace" look the same, so ids can't be probed. `older` loads up to 500 entries instead
// of the latest 100 outreach and 50 stage moves.
const loadPage = cache(async (workspaceId: string, companyId: string, olderOutreach: boolean, olderHistory: boolean) => {
  const { userId } = await requireMembershipOr404(workspaceId);
  return getCompanyPage({ userId, workspaceId }, companyId, {
    outreach: olderOutreach ? DETAIL_TAKE.max : DETAIL_TAKE.outreach,
    history: olderHistory ? DETAIL_TAKE.max : DETAIL_TAKE.history,
  });
});

const flags = async (searchParams: Promise<Record<string, string | string[] | undefined>>) => {
  const sp = await searchParams;
  return { olderOutreach: sp.outreach === "all", olderHistory: sp.history === "all" };
};

export async function generateMetadata({ params, searchParams }: PageProps<"/[workspaceId]/companies/[companyId]">): Promise<Metadata> {
  const { workspaceId, companyId } = await params;
  const { olderOutreach, olderHistory } = await flags(searchParams);
  const data = await loadPage(workspaceId, companyId, olderOutreach, olderHistory);
  return pageTitle(workspaceId, data ? data.company.name : "Company not found");
}

// "example.com" for a link to https://www.example.com/a/very/long/path, so a long address never
// widens the page. The full address is in the link's title and accessible name.
function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// The company page answers one question: what do I do next with this company? In reading order
// (which is also the keyboard order): the header (name, ⋯, one line of facts, the notes), the route
// map with "Move to", the claim ticket, the log card, the AI tools, the outreach, the contacts and the
// history. On a wide screen the first and the last two sit on the left page and the claim, log, AI
// tools and outreach on the right (company.css grid areas). Officers never see a control the server
// would refuse: on someone else's claim the stage is read-only and there is no archive or AI. An
// archived company is one read-only column with Unarchive as its only button.
export default async function CompanyPage({ params, searchParams }: PageProps<"/[workspaceId]/companies/[companyId]">) {
  const { workspaceId, companyId } = await params;
  const { userId, role } = await requireMembershipOr404(workspaceId);
  const tenant = { userId, workspaceId };
  const { olderOutreach, olderHistory } = await flags(searchParams);
  const data = await loadPage(workspaceId, companyId, olderOutreach, olderHistory);
  if (!data) notFound();
  const { company, industries, templates, lookAlikes } = data;
  // The time and date come from the database, the same clock the claim SQL uses (one read per request).
  const now = await dbNow();
  const today = await dbToday();
  const thisYear = Number(today.slice(0, 4));

  const isOwner = role === "owner";
  const archived = company.archivedAt !== null;
  const closed = TERMINAL_STAGES.includes(company.stage);
  const claim = claimView(company, now, userId);
  // Someone else's live claim, seen by an officer: the server refuses moves, logs and archive.
  const heldByOther = claim === "theirs" && !isOwner;
  const canControl = !archived && !heldByOther;
  const canLog = !archived && !closed && (claim === "mine" || claim === "expired-mine");
  // The AI tools: never on an archived or closed company, nor for an officer on someone else's claim.
  // Drafting claims the company, so it's offered only when that could work.
  const showAi = !archived && !closed && !heldByOther;
  const canDraft = showAi && claim !== "theirs";
  const configured = isConfigured();
  // Read one after another, and only when the AI tools will show.
  const ai = showAi && configured ? await aiUsage(tenant) : null;
  const researchOn = showAi && configured && ai !== null && ai.enabled;
  const facts = canDraft && ai?.enabled ? await verifiedFacts(tenant) : [];
  const drafts = canDraft && ai?.enabled ? await recentDrafts(tenant, companyId) : [];
  const draftedToday = canDraft && ai?.enabled ? await draftsToday(tenant) : 0;
  const sources = researchOn ? await listSources(tenant) : [];
  const brief = researchOn ? await latestBrief(tenant, companyId) : null;
  const companyDomain = domainKey(company.website);

  const href = websiteHref(company.website);
  const followDays = company.nextFollowUpAt ? daysBetween(company.nextFollowUpAt, now) : null;
  const outcome = closed ? company.stageChanges.find((s) => s.toStage === company.stage) : undefined;
  const meta = archived ? null : closed ? (
    <span>
      {STAGE_LABELS[company.stage]}
      {outcome ? ` ${day(outcome.changedAt)}` : ""}
    </span>
  ) : company.nextFollowUpAt && followDays !== null ? (
    <span className="lg-cofollow">
      <span>Follow up {day(company.nextFollowUpAt)}</span>
      <OverdueMark days={followDays} dueOn={day(company.nextFollowUpAt)} size={15} />
      {isLongOverdue(followDays) && <span className="sr-only">Long overdue.</span>}
    </span>
  ) : null;

  const query = (o: boolean, h: boolean) => {
    const parts = [o ? "outreach=all" : "", h ? "history=all" : ""].filter(Boolean);
    return parts.length > 0 ? `?${parts.join("&")}` : "?";
  };
  const olderOutreachHref = query(true, olderHistory);
  const olderHistoryHref = query(olderOutreach, true);

  const editForm = !archived ? (
    <CompanyForm
      // Adding a brief item to the notes changes them on the server; a new key reloads the form so
      // it shows (and later saves against) the new notes.
      key={`details-${brief?.id ?? ""}-${[...(brief?.items ?? []), ...(brief?.inboxes ?? [])].filter((i) => i.accepted).length}`}
      mode="edit"
      workspaceId={workspaceId}
      companyId={company.id}
      industries={industries}
      initial={{ name: company.name, industry: company.industry ?? "", website: company.website ?? "", notes: company.notes ?? "" }}
      save={updateCompany}
      unarchive={unarchiveCompany}
      archiveAsDuplicate={archiveAsDuplicate}
    />
  ) : null;

  const header = (
    <CompanyHeader
      name={company.name}
      industry={company.industry}
      website={company.website}
      href={href}
      host={href ? hostOf(href) : null}
      meta={meta}
      notes={company.notes}
      editForm={editForm}
      menu={
        archived
          ? null
          : {
              workspaceId,
              companyId: company.id,
              canEdit: true,
              canControl,
              stageItem: closed ? "reopen" : claim === "theirs" ? "move" : null,
              archive: archiveCompany,
              archiveAsDuplicate,
              lookAlikes,
            }
      }
    />
  );

  const aiTools = showAi && (canDraft || researchOn) && (
    <LazyDisclosure summary="AI tools" className="lg-block lg-aitools" data-tour="ai-tools">
      {canDraft &&
        (!configured ? (
          <p id="draft-email" className="lg-hint">
            AI drafting isn&apos;t set up on this server. Everything else here works without it.
          </p>
        ) : !ai?.enabled ? (
          <p id="draft-email" className="lg-hint">
            AI drafting is off for this workspace.{" "}
            {isOwner ? (
              <>
                Turn it on in{" "}
                <Link href={`/${workspaceId}/settings`} className="lg-link">
                  Settings
                </Link>
                .
              </>
            ) : (
              "An owner can turn it on in Settings."
            )}
          </p>
        ) : (
          <DraftPanel
            workspaceId={workspaceId}
            companyId={company.id}
            contacts={company.contacts}
            hasOutreach={company.outreachTotal > 0}
            factCount={facts.length}
            usage={{ used: ai.used, limit: ai.limit }}
            daily={{ used: draftedToday, limit: DAILY_DRAFTS_PER_PERSON }}
            initialDrafts={drafts}
            today={today}
            rules={{ factNumbers: factNumbers(facts), website: company.website }}
            templates={templates}
            actions={{ draft: draftEmail, check: checkDraft, logOutreach }}
          />
        ))}
      {researchOn && ai && (
        <div data-tour="research-brief">
          <BriefPanel
            workspaceId={workspaceId}
            companyId={company.id}
            sources={sources.map((source) => {
              // Pages on the company's own domain start ticked. This only picks among approved
              // pages; the website itself is never approved by being on the company.
              const host = new URL(source.url).hostname;
              const site = domainKey(host);
              const suggested = companyDomain !== null && site !== null && (site === companyDomain || site.endsWith(`.${companyDomain}`));
              return { id: source.id, label: source.label, host, url: source.url, suggested };
            })}
            isOwner={isOwner}
            usage={{ used: ai.used, limit: ai.limit }}
            initialBrief={brief}
            actions={{ request: requestBrief, accept: acceptBriefItem }}
          />
        </div>
      )}
    </LazyDisclosure>
  );

  const history = (
    <HistoryBlock
      changes={company.stageChanges}
      total={company.stageChangeTotal}
      thisYear={thisYear}
      olderHref={olderHistoryHref}
      defaultOpen={olderHistory}
      outreach={archived ? { list: company.outreach, total: company.outreachTotal, olderHref: olderOutreachHref, older: olderOutreach } : undefined}
    />
  );

  const body = (
    <article className="lg-company" data-layout={archived ? "single" : "spread"}>
      <BackToList workspaceId={workspaceId} className="lg-back" icon={<ChevronLeftIcon size={18} />} />

      {archived && (
        <div id="archived-banner" className="lg-archivedbanner" role="status" tabIndex={-1}>
          <p>Archived. Hidden from the board and queue.</p>
          <ActionForm
            action={unarchiveCompany}
            submitLabel="Unarchive"
            primary
            small
            successMessage={`${company.name} is back on the board.`}
            focusAfter=".lg-company h1"
            className="lg-strip-form"
          >
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="companyId" value={company.id} />
            {/* Stay on this page (no redirect to itself), so the form can hand focus to the heading. */}
            <input type="hidden" name="stay" value="board" />
          </ActionForm>
        </div>
      )}

      {/* Keyed by archived: archiving slides this sheet away, and the archived page is a new one. */}
      <div className="lg-cogrid" key={archived ? "archived" : "live"}>
        <div className="lg-co-head">{header}</div>
        <div className="lg-co-route">
          <RouteMap stage={company.stage} stageChanges={company.stageChanges} hasOutreach={company.outreachTotal > 0} />
          {canControl && !closed && claim !== "theirs" && <MoveToButton />}
        </div>
        {!archived && (
          <div className="lg-co-side">
            <ClaimPanel
              workspaceId={workspaceId}
              companyId={company.id}
              companyName={company.name}
              stage={company.stage}
              role={role}
              state={claim}
              holderName={company.claimedBy?.name ?? null}
              expiresAt={company.claimExpiresAt}
              claimedVia={company.claimedVia}
              actions={{ claim: claimCompany, release: releaseClaim, forceRelease }}
            />
            {canLog && (
              // The queue's "Log outreach" links jump here (and LogHashFocus readies the form).
              <Block id="log-outreach" title="Log outreach" data-tour="log-outreach" className="lg-logcard">
                <LogOutreachForm workspaceId={workspaceId} companyId={company.id} action={logOutreach} today={today} templates={templates} settleInto="#outreach .lg-entries" />
                <LogHashFocus />
              </Block>
            )}
            {aiTools}
            <OutreachBlock
              workspaceId={workspaceId}
              companyId={company.id}
              companyName={company.name}
              outreach={company.outreach}
              total={company.outreachTotal}
              thisYear={thisYear}
              olderHref={olderOutreachHref}
              older={olderOutreach}
              canMarkReply={canControl && REPLY_STAGES.includes(company.stage)}
            />
          </div>
        )}
        {archived && <div className="lg-co-history">{history}</div>}
        <div className="lg-co-contacts">
          {archived ? (
            <ArchivedContacts contacts={company.contacts} />
          ) : (
            <ContactsBlock
              workspaceId={workspaceId}
              companyId={company.id}
              contacts={company.contacts}
              readOnly={false}
              actions={{ add: addContact, update: updateContact, remove: removeContact }}
            />
          )}
        </div>
        {!archived && <div className="lg-co-history">{history}</div>}
      </div>
    </article>
  );

  if (archived) return body;
  return (
    <StageMover workspaceId={workspaceId} companyId={company.id} companyName={company.name} stage={company.stage} action={moveStage}>
      {body}
    </StageMover>
  );
}
