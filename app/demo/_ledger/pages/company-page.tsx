"use client";
import "@/components/ledger/zod-jitless";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useMemo } from "react";
import { ActionForm } from "@/components/ledger/action-form";
import { ClaimPanel } from "@/components/ledger/claim-panel";
import { CompanyForm } from "@/components/ledger/company-form";
import { DraftPanel } from "@/components/ledger/draft-panel";
import { StageForm } from "@/components/ledger/stage-form";
import { ChevronLeftIcon, ExternalIcon, StageGlyph } from "@/components/ledger/icons";
import { ArchiveBlock, Block, ContactsBlock, FactsBlock, HistoryBlock, OutreachBlock, ReadonlyDetails } from "@/components/ledger/company-blocks";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { isLongOverdue, OverdueMark } from "@/components/ledger/overdue";
import { RouteMap } from "@/components/ledger/route-map";
import { day } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import { websiteHref } from "@/lib/validation";
import { useCompany, useDemoState, useWorkspace, useIsMember } from "@/demo/store";
import { selectVerifiedFacts, type OutreachView, type StageChangeView } from "@/demo/selectors";
import type { Draft } from "@/demo/types";
import { useFormActions } from "../form-actions";

// The company page, as a two-page spread: the real page's markup, with its data from the store.
export function CompanyPage({ ws, companyId }: { ws: string; companyId: string }) {
  const detail = useCompany(ws, companyId);
  const state = useDemoState();
  const workspace = useWorkspace(ws);
  const isMember = useIsMember(ws);
  const a = useFormActions();
  const facts = useMemo(() => selectVerifiedFacts(state, ws), [state, ws]);
  if (!detail || !workspace || !isMember) notFound();

  const { company, claim, closed, archived, contacts } = detail;
  const href = websiteHref(company.website);
  const followDays = detail.followUpDays;
  const stage = company.stage;
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={ws} />
      <input type="hidden" name="companyId" value={company.id} />
    </>
  );

  const outreach = detail.outreach.map((o: OutreachView) => ({
    id: o.id,
    channel: o.channel,
    note: o.note,
    sentAt: new Date(o.sentAt),
    aiDraftId: o.aiDraftId,
    sender: { name: o.senderName },
  }));
  const changes = detail.stageChanges.map((s: StageChangeView) => ({
    id: s.id,
    fromStage: s.fromStage,
    toStage: s.toStage,
    changedAt: new Date(s.changedAt),
    changedBy: { name: s.changedByName },
  }));
  const drafts = detail.drafts.map((d: Draft) => ({
    id: d.id,
    kind: d.kind,
    angle: d.angle,
    subject: d.subject,
    body: d.body,
    to: d.to,
    createdAt: new Date(d.createdAt),
    check: d.check,
  }));
  const usage = { used: workspace.aiCallsUsed, limit: workspace.aiMonthlyLimit };

  const draftOff = (title: string, body: React.ReactNode) => (
    <section id="draft-email" className="lg-draftpanel" aria-labelledby="draft-off-h">
      <h2 id="draft-off-h" className="lg-h2">
        Draft an email
      </h2>
      <div className="lg-draftoff">
        <p>{title}</p>
        {body}
      </div>
    </section>
  );

  return (
    <article className="lg-company">
      <Link href={`/demo/w/${ws}`} className="lg-back">
        <ChevronLeftIcon size={18} />
        Queue
      </Link>

      {archived && (
        <div className="lg-archivedbanner" role="status">
          <p>This company is archived. It is hidden from the board and queue, and its history is kept.</p>
          <ActionForm action={a.unarchiveCompany} submitLabel="Unarchive" successMessage={`${company.name} is back on the board.`}>
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
              <span className="lg-stagechip" data-stage={stage}>
                <StageGlyph stage={stage} size={15} />
                {STAGE_LABELS[stage]}
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
              <span>{company.lastContactedAt ? `Last contacted ${day(new Date(company.lastContactedAt))}` : "Never contacted"}</span>
              {company.nextFollowUpAt && followDays !== null && !closed && (
                <span className="lg-cofollow">
                  <span>Follow up {day(new Date(company.nextFollowUpAt))}</span>
                  <OverdueMark days={followDays} dueOn={day(new Date(company.nextFollowUpAt))} size={15} />
                </span>
              )}
              {company.nextFollowUpAt && closed && <span>Follow up {day(new Date(company.nextFollowUpAt))}</span>}
            </p>
            {followDays !== null && !closed && isLongOverdue(followDays) && <p className="sr-only">Long overdue.</p>}
          </header>
          <div className="lg-o-route">
            <RouteMap stage={stage} stageChanges={changes} hasOutreach={outreach.length > 0} />
          </div>
          {!archived && (
            <div className="lg-o-stage">
              <Block title="Stage">
                <StageForm workspaceId={ws} companyId={company.id} companyName={company.name} stage={stage} action={a.moveStage} />
              </Block>
            </div>
          )}
          <div className="lg-o-contacts">
            <ContactsBlock ids={ids} contacts={contacts} archived={archived} actions={{ add: a.addContact, update: a.updateContact, remove: a.removeContact }} />
          </div>
          <div className="lg-o-facts">
            <FactsBlock workspaceId={ws} facts={facts} />
          </div>
          <div className="lg-o-history">
            <HistoryBlock changes={changes} />
          </div>
        </div>

        <div className="lg-leaf-page lg-leaf-right">
          {!archived && (
            <div className="lg-o-claim">
              <ClaimPanel
                workspaceId={ws}
                companyId={company.id}
                companyName={company.name}
                stage={stage}
                role={detail.role ?? "member"}
                state={claim.state}
                holderName={claim.holderName}
                expiresAt={claim.expiresAt ? new Date(claim.expiresAt) : null}
                actions={{ claim: a.claimCompany, release: a.releaseClaim, forceRelease: a.forceRelease }}
              />
            </div>
          )}
          {!archived && !closed && claim.state === "mine" && (
            <div className="lg-o-log">
              <Block id="log-outreach" title="Log outreach" note="After you reach out from your own inbox or in person. Saving renews your claim.">
                <LogOutreachForm workspaceId={ws} companyId={company.id} action={a.logOutreach} today={detail.today} />
              </Block>
            </div>
          )}
          <div className="lg-o-outreach">
            <OutreachBlock outreach={outreach} />
          </div>
        </div>

        {!archived && detail.canDraft && (
          <div className="lg-leaf-wide lg-o-draft">
            {!detail.ai.serverConfigured ? (
              draftOff("AI drafting isn't set up on this server yet.", <p className="lg-hint">The app has no AI key. Everything else here works without it.</p>)
            ) : !detail.ai.workspaceEnabled ? (
              draftOff(
                "AI drafting is off for this workspace.",
                <p className="lg-hint">
                  An owner can turn it on in{" "}
                  <Link href={`/demo/w/${ws}/settings`} className="lg-link">
                    Settings
                  </Link>
                  .
                </p>,
              )
            ) : (
              <DraftPanel
                key={company.id}
                workspaceId={ws}
                companyId={company.id}
                contacts={detail.draftContacts}
                hasOutreach={outreach.length > 0}
                factCount={facts.length}
                usage={usage}
                initialDrafts={drafts}
                today={detail.today}
                rules={detail.ruleContext}
                actions={{ draft: a.draftEmail as never, check: a.checkDraft as never, logOutreach: a.logOutreach }}
              />
            )}
          </div>
        )}

        <div className="lg-leaf-back">
          <div className="lg-back-grid">
            <div className="lg-leaf-page">
              <div className="lg-o-details">
                {archived ? (
                  <ReadonlyDetails industry={company.industry} website={company.website} notes={company.notes} />
                ) : (
                  <Block title="Details">
                    <CompanyForm
                      mode="edit"
                      workspaceId={ws}
                      companyId={company.id}
                      industries={detail.industries}
                      initial={{ name: company.name, industry: company.industry ?? "", website: company.website ?? "", notes: company.notes ?? "" }}
                      save={a.updateCompany}
                      unarchive={a.unarchiveCompany}
                      archiveAsDuplicate={a.archiveAsDuplicate}
                    />
                  </Block>
                )}
              </div>
            </div>
            <div className="lg-leaf-page">
              {!archived && (
                <div className="lg-o-archive">
                  <ArchiveBlock ids={ids} companyName={company.name} action={a.archiveCompany} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
