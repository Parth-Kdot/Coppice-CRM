import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { BriefPanel } from "@/components/brief-panel";
import { ClaimPanel } from "@/components/claim-panel";
import { CompanyForm } from "@/components/company-form";
import { DraftPanel } from "@/components/draft-panel";
import { StageForm } from "@/components/stage-form";
import { ChevronLeftIcon, ExternalIcon, StageGlyph } from "@/components/ledger/icons";
import { ArchiveBlock, Block, ContactsBlock, FactsBlock, HistoryBlock, OutreachBlock, ReadonlyDetails } from "@/components/ledger/company-blocks";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { isLongOverdue, OverdueMark } from "@/components/ledger/overdue";
import { RouteMap } from "@/components/ledger/route-map";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { factNumbers } from "@/lib/claim-rules";
import { claimState, dbNow, dbToday } from "@/lib/claims";
import { getCompanyDetail, listIndustries } from "@/lib/companies";
import { daysBetween, day } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { recentDrafts } from "@/lib/drafts";
import { domainKey } from "@/lib/duplicates";
import { latestBrief } from "@/lib/research/brief";
import { listSources } from "@/lib/research/sources";
import { verifiedFacts } from "@/lib/facts";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
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
import "@/components/ledger/company.css";

// Drafting an email waits on the AI for up to 100 seconds. A research brief fetches pages (15 s)
// and then makes two AI calls of up to 100 seconds each, so the page allows 240 (Vercel's cap is 300).
export const maxDuration = 240;

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/companies/[companyId]">): Promise<Metadata> {
  const { workspaceId, companyId } = await params;
  const membership = await requireMembershipOr404(workspaceId);
  const [workspace, company] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
    withTenant(membership, (tx) => tx.company.findFirst({ where: { id: companyId, workspaceId }, select: { name: true } })),
  ]);
  return { title: company ? `${company.name}, ${workspace.name}` : workspace.name };
}

// The company page, as a two-page spread. Left page: the name, the route map, the stage, the contacts,
// the facts the AI may use and the stage history. Right page: the claim ticket, the fast log form and
// the outreach entries. Under it the draft letter runs the full width, then the details and the
// archive. An archived company keeps only what is safe to read: no claim, no drafts, no forms.
export default async function CompanyPage({ params }: PageProps<"/[workspaceId]/companies/[companyId]">) {
  const { workspaceId, companyId } = await params;
  const { userId, role } = await requireMembershipOr404(workspaceId);
  const tenant = { userId, workspaceId };
  // Not found and "in another workspace" look the same, so ids can't be probed. The time and date
  // come from the database, the same clock the claim SQL uses.
  const [company, industries, now, today, ai, facts, drafts] = await Promise.all([
    getCompanyDetail(tenant, companyId),
    listIndustries(tenant),
    dbNow(),
    dbToday(),
    aiUsage(tenant),
    verifiedFacts(tenant),
    recentDrafts(tenant, companyId),
  ]);
  if (!company) notFound();
  // The Research Agent is hidden entirely while AI is off (the server refuses too).
  const researchOn = !company.archivedAt && isConfigured() && ai.enabled;
  const [sources, brief] = researchOn ? await Promise.all([listSources(tenant), latestBrief(tenant, companyId)]) : [[], null];
  const companyDomain = domainKey(company.website);
  const claim = claimState(company, now, userId);
  // Drafting claims the company, so it's offered only when that could work.
  const canDraft = !TERMINAL_STAGES.includes(company.stage) && claim !== "theirs";
  const closed = TERMINAL_STAGES.includes(company.stage);

  const archived = company.archivedAt !== null;
  const href = websiteHref(company.website);
  const followDays = company.nextFollowUpAt ? daysBetween(company.nextFollowUpAt, now) : null;
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={company.id} />
    </>
  );

  return (
    <article className="lg-company">
      <Link href={`/${workspaceId}`} className="lg-back">
        <ChevronLeftIcon size={18} />
        Queue
      </Link>

      {archived && (
        <div className="lg-archivedbanner" role="status">
          <p>This company is archived. It is hidden from the board and queue, and its history is kept.</p>
          <ActionForm action={unarchiveCompany} submitLabel="Unarchive" successMessage={`${company.name} is back on the board.`}>
            {ids}
          </ActionForm>
        </div>
      )}

      <div className="lg-spread">
        <div className="lg-leaf-page lg-leaf-left">
          <header className="lg-cohead lg-o-title">
            <h1 className="lg-h1" tabIndex={-1}>
              {company.name}
            </h1>
            <p className="lg-coline">
              <span className="lg-stagechip" data-stage={company.stage}>
                <StageGlyph stage={company.stage} size={15} />
                {STAGE_LABELS[company.stage]}
              </span>
              {company.industry && <span>{company.industry}</span>}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
                  {company.website}
                  <ExternalIcon size={14} className="ml-1 inline-block align-[-2px]" />
                </a>
              )}
            </p>
            <p className="lg-coline">
              <span>{company.lastContactedAt ? `Last contacted ${day(company.lastContactedAt)}` : "Never contacted"}</span>
              {company.nextFollowUpAt && followDays !== null && !closed && (
                <span className="lg-cofollow">
                  <span>Follow up {day(company.nextFollowUpAt)}</span>
                  <OverdueMark days={followDays} dueOn={day(company.nextFollowUpAt)} size={15} />
                </span>
              )}
              {company.nextFollowUpAt && closed && <span>Follow up {day(company.nextFollowUpAt)}</span>}
            </p>
            {followDays !== null && !closed && isLongOverdue(followDays) && <p className="sr-only">Long overdue.</p>}
          </header>
          <div className="lg-o-route">
            <RouteMap stage={company.stage} stageChanges={company.stageChanges} hasOutreach={company.outreach.length > 0} />
          </div>
          {!archived && (
            <div className="lg-o-stage">
              <Block title="Stage">
                <StageForm workspaceId={workspaceId} companyId={company.id} companyName={company.name} stage={company.stage} action={moveStage} />
              </Block>
            </div>
          )}
          <div className="lg-o-contacts">
            <ContactsBlock ids={ids} contacts={company.contacts} archived={archived} actions={{ add: addContact, update: updateContact, remove: removeContact }} />
          </div>
          <div className="lg-o-facts">
            <FactsBlock workspaceId={workspaceId} facts={facts} />
          </div>
          <div className="lg-o-history">
            <HistoryBlock changes={company.stageChanges} />
          </div>
        </div>

        <div className="lg-leaf-page lg-leaf-right">
          {!archived && (
            <div className="lg-o-claim">
              <ClaimPanel
                workspaceId={workspaceId}
                companyId={company.id}
                companyName={company.name}
                stage={company.stage}
                role={role}
                state={claim}
                holderName={company.claimedBy?.name ?? null}
                expiresAt={company.claimExpiresAt}
                actions={{ claim: claimCompany, release: releaseClaim, forceRelease }}
              />
            </div>
          )}
          {!archived && !closed && claim === "mine" && (
            <div className="lg-o-log">
              {/* The queue's "Log outreach" links jump here. */}
              <Block id="log-outreach" title="Log outreach" note="After you reach out from your own inbox or in person. Saving renews your claim.">
                <LogOutreachForm workspaceId={workspaceId} companyId={company.id} action={logOutreach} today={today} />
              </Block>
            </div>
          )}
          <div className="lg-o-outreach">
            <OutreachBlock outreach={company.outreach} />
          </div>
        </div>

        {!archived && canDraft && (
          <div className="lg-leaf-wide lg-o-draft">
            {!isConfigured() ? (
              <DraftOff title="AI drafting isn't set up on this server yet.">
                <p className="lg-hint">The app has no AI key. Everything else here works without it.</p>
              </DraftOff>
            ) : !ai.enabled ? (
              <DraftOff title="AI drafting is off for this workspace.">
                <p className="lg-hint">
                  An owner can turn it on in{" "}
                  <Link href={`/${workspaceId}/settings`} className="lg-link">
                    Settings
                  </Link>
                  .
                </p>
              </DraftOff>
            ) : (
              <DraftPanel
                workspaceId={workspaceId}
                companyId={company.id}
                contacts={company.contacts}
                hasOutreach={company.outreach.length > 0}
                factCount={facts.length}
                usage={{ used: ai.used, limit: ai.limit }}
                initialDrafts={drafts}
                today={today}
                rules={{ factNumbers: factNumbers(facts), website: company.website }}
                actions={{ draft: draftEmail, check: checkDraft, logOutreach }}
              />
            )}
          </div>
        )}

        {researchOn && (
          <div className="lg-leaf-wide lg-o-brief">
            <BriefPanel
              workspaceId={workspaceId}
              companyId={company.id}
              sources={sources.map((source) => {
                // Pages on the company's own domain start ticked. This only picks among approved
                // pages; the website itself is never approved by being on the company.
                const host = new URL(source.url).hostname;
                const site = domainKey(host);
                const suggested = companyDomain !== null && site !== null && (site === companyDomain || site.endsWith(`.${companyDomain}`));
                return { id: source.id, label: source.label, host, suggested };
              })}
              isOwner={role === "owner"}
              usage={{ used: ai.used, limit: ai.limit }}
              initialBrief={brief}
              actions={{ request: requestBrief, accept: acceptBriefItem }}
            />
          </div>
        )}

        <div className="lg-leaf-back">
          <div className="lg-back-grid">
            <div className="lg-leaf-page">
              <div className="lg-o-details">
                {/* An archived company is out of play, so it's read-only until someone unarchives it. */}
                {archived ? (
                  <ReadonlyDetails industry={company.industry} website={company.website} notes={company.notes} />
                ) : (
                  <Block title="Details">
                    <CompanyForm
                      mode="edit"
                      workspaceId={workspaceId}
                      companyId={company.id}
                      industries={industries}
                      initial={{
                        name: company.name,
                        industry: company.industry ?? "",
                        website: company.website ?? "",
                        notes: company.notes ?? "",
                      }}
                      save={updateCompany}
                      unarchive={unarchiveCompany}
                      archiveAsDuplicate={archiveAsDuplicate}
                    />
                  </Block>
                )}
              </div>
            </div>
            <div className="lg-leaf-page">
              {!archived && (
                <div className="lg-o-archive">
                  <ArchiveBlock ids={ids} companyName={company.name} action={archiveCompany} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

// The draft area when the AI cannot be used: a clear sentence and what would change it.
function DraftOff({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id="draft-email" className="lg-draftpanel" aria-labelledby="draft-off-h">
      <h2 id="draft-off-h" className="lg-h2">
        Draft an email
      </h2>
      <div className="lg-draftoff">
        <p>{title}</p>
        {children}
      </div>
    </section>
  );
}
