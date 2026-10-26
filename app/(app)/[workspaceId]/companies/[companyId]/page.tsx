import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ClaimPanel } from "@/components/claim-panel";
import { CompanyForm } from "@/components/company-form";
import { DraftPanel } from "@/components/draft-panel";
import { StageForm } from "@/components/stage-form";
import { isConfigured } from "@/lib/ai/client";
import { aiUsage } from "@/lib/ai/run";
import { requireMembershipOr404 } from "@/lib/authz";
import { CHANNEL_LABELS } from "@/lib/channels";
import { factNumbers } from "@/lib/claim-rules";
import { claimState, dbNow, dbToday } from "@/lib/claims";
import { getCompanyDetail, listIndustries } from "@/lib/companies";
import { day, when } from "@/lib/dates";
import { recentDrafts } from "@/lib/drafts";
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

// Drafting an email waits on the AI for up to 100 seconds.
export const maxDuration = 120;

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
  const claim = claimState(company, now, userId);
  // Drafting claims the company, so it's offered only when that could work.
  const canDraft = !TERMINAL_STAGES.includes(company.stage) && claim !== "theirs";

  const archived = company.archivedAt !== null;
  const href = websiteHref(company.website);
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={company.id} />
    </>
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <p className="text-sm text-zinc-500">
            {STAGE_LABELS[company.stage]}
            {company.industry && ` · ${company.industry}`}
            {href && (
              <>
                {" · "}
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  {company.website}
                </a>
              </>
            )}
          </p>
          <p className="text-sm text-zinc-500">
            {company.lastContactedAt ? `Last contacted ${day(company.lastContactedAt)}` : "Never contacted"}
            {company.nextFollowUpAt && ` · Follow up ${day(company.nextFollowUpAt)}`}
          </p>
        </div>
        <Link href={`/${workspaceId}`} className="rounded border px-3 py-1">
          Back
        </Link>
      </header>

      {archived ? (
        <section className="flex flex-col gap-3 rounded border p-4">
          <p>This company is archived. It is hidden from the board and queue, and its history is kept.</p>
          <ActionForm action={unarchiveCompany} submitLabel="Unarchive">
            {ids}
          </ActionForm>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Claim</h2>
            <ClaimPanel
              workspaceId={workspaceId}
              companyId={company.id}
              companyName={company.name}
              stage={company.stage}
              role={role}
              state={claim}
              holderName={company.claimedBy?.name ?? null}
              expiresAt={company.claimExpiresAt}
              today={today}
              actions={{ claim: claimCompany, release: releaseClaim, forceRelease, logOutreach }}
            />
          </section>
          {canDraft && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Draft an email</h2>
              {isConfigured() && ai.enabled ? (
                <DraftPanel
                  workspaceId={workspaceId}
                  companyId={company.id}
                  contacts={company.contacts}
                  hasOutreach={company.outreach.length > 0}
                  factCount={facts.length}
                  initialDrafts={drafts}
                  today={today}
                  rules={{ factNumbers: factNumbers(facts), website: company.website }}
                  actions={{ draft: draftEmail, check: checkDraft, logOutreach }}
                />
              ) : (
                <p className="text-sm text-zinc-500">AI drafting is off for this workspace. An owner can turn it on in Settings.</p>
              )}
            </section>
          )}
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Stage</h2>
            <StageForm workspaceId={workspaceId} companyId={company.id} stage={company.stage} action={moveStage} />
          </section>
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        {/* An archived company is out of play, so it's read-only until someone unarchives it. */}
        {archived ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-zinc-500">Industry</dt>
            <dd>{company.industry ?? "None"}</dd>
            <dt className="text-zinc-500">Website</dt>
            <dd>{company.website ?? "None"}</dd>
            <dt className="text-zinc-500">Notes</dt>
            <dd className="whitespace-pre-wrap">{company.notes ?? "None"}</dd>
          </dl>
        ) : (
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
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Contacts</h2>
        {company.contacts.length === 0 && <p className="text-sm text-zinc-500">No contacts yet.</p>}
        <ul className="flex flex-col gap-3">
          {company.contacts.map((contact) => (
            <li key={contact.id} className="flex flex-col gap-2">
              <span>
                {contact.name}
                {contact.title && `, ${contact.title}`}
                {contact.email && ` (${contact.email})`}
              </span>
              {!archived && (
                <details>
                  <summary className="cursor-pointer text-sm text-zinc-600">Edit or remove</summary>
                  <div className="flex flex-col gap-2 pt-2">
                    <ActionForm action={updateContact} submitLabel="Save contact">
                      {ids}
                      <input type="hidden" name="contactId" value={contact.id} />
                      <ContactInputs name={contact.name} email={contact.email} title={contact.title} />
                    </ActionForm>
                    <ActionForm action={removeContact} submitLabel="Remove contact" confirmMessage={`Remove ${contact.name}?`}>
                      {ids}
                      <input type="hidden" name="contactId" value={contact.id} />
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
        {!archived && (
          <ActionForm action={addContact} submitLabel="Add contact">
            {ids}
            <ContactInputs />
          </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Outreach</h2>
        {company.outreach.length === 0 ? (
          <p className="text-sm text-zinc-500">No outreach logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {company.outreach.map((entry) => (
              <li key={entry.id} className="flex flex-col">
                <span>
                  {when(entry.sentAt)}: {entry.sender.name}, {CHANNEL_LABELS[entry.channel]}
                  {entry.aiDraftId && ", from an AI draft"}
                </span>
                {entry.note && <span className="whitespace-pre-wrap text-zinc-600">{entry.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Stage history</h2>
        {company.stageChanges.length === 0 ? (
          <p className="text-sm text-zinc-500">No stage moves yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {company.stageChanges.map((change) => (
              <li key={change.id}>
                {when(change.changedAt)}: {change.changedBy.name} moved it from {STAGE_LABELS[change.fromStage]} to{" "}
                {STAGE_LABELS[change.toStage]}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!archived && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Archive</h2>
          <p className="text-sm text-zinc-500">Hides the company from the board and queue. Its history is kept and you can unarchive it.</p>
          <ActionForm action={archiveCompany} submitLabel="Archive company" confirmMessage={`Archive ${company.name}?`}>
            {ids}
          </ActionForm>
        </section>
      )}
    </main>
  );
}

function ContactInputs({ name, email, title }: { name?: string; email?: string | null; title?: string | null }) {
  return (
    <>
      <input name="name" required maxLength={120} defaultValue={name} placeholder="Name" aria-label="Contact name" className="rounded border px-2 py-1" />
      <input name="title" maxLength={120} defaultValue={title ?? ""} placeholder="Title" aria-label="Contact title" className="rounded border px-2 py-1" />
      <input
        name="email"
        type="email"
        maxLength={254}
        defaultValue={email ?? ""}
        placeholder="Email"
        aria-label="Contact email"
        className="rounded border px-2 py-1"
      />
    </>
  );
}
