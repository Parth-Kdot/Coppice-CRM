import Link from "next/link";
import { Fragment, useId, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import type { Channel, Stage, Via } from "@/generated/prisma/enums";
import { CHANNEL_LABELS } from "@/lib/channels";
import { when } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import { Empty } from "./shared";
import { TurnoverRule, YearMargin } from "./marks";
import { boardYear } from "./board-year";
import "./company.css";
import "./templates.css";

// The server-rendered blocks of the company page: contacts, the facts the AI may use, the outreach
// log, the stage history, the read-only details of an archived company, and the archive box. Each
// is drawn from data the page already loaded; the forms inside run the real server actions.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

export function Block({ id, title, note, children, className = "" }: { id?: string; title: string; note?: string; children: ReactNode; className?: string }) {
  const hid = useId();
  return (
    <section id={id} className={`lg-block ${className}`} aria-labelledby={hid}>
      <h2 id={hid} className="lg-bh">
        {title}
      </h2>
      {note && <p className="lg-hint lg-bh-note">{note}</p>}
      {children}
    </section>
  );
}

// ----- Contacts -----

type ContactData = { id: string; name: string; title: string | null; email: string | null };

function ContactInputs({ name, email, title }: { name?: string; email?: string | null; title?: string | null }) {
  return (
    <div className="lg-row3">
      <div>
        <label className="lg-label">
          Name
          <input name="name" required maxLength={120} defaultValue={name} aria-label="Contact name" className="lg-input mt-1" />
        </label>
      </div>
      <div>
        <label className="lg-label">
          Title
          <input name="title" maxLength={120} defaultValue={title ?? ""} aria-label="Contact title" className="lg-input mt-1" />
        </label>
      </div>
      <div>
        <label className="lg-label">
          Email
          <input name="email" type="email" maxLength={254} defaultValue={email ?? ""} aria-label="Contact email" className="lg-input mt-1" />
        </label>
      </div>
    </div>
  );
}

export function ContactsBlock({
  ids,
  contacts,
  archived,
  actions,
}: {
  ids: ReactNode;
  contacts: ContactData[];
  archived: boolean;
  actions: { add: Action; update: Action; remove: Action };
}) {
  return (
    <Block title="Contacts">
      {contacts.length === 0 ? (
        <p className="lg-muted">No contacts yet.</p>
      ) : (
        <ul className="lg-contacts">
          {contacts.map((contact) => (
            <li key={contact.id} className="lg-contact">
              <p>
                <strong>{contact.name}</strong>
                {contact.title ? `, ${contact.title}` : ""}
                {contact.email ? <span className="lg-muted"> ({contact.email})</span> : <span className="lg-muted"> (no email)</span>}
              </p>
              {!archived && (
                <details className="lg-more">
                  <summary>Edit or remove</summary>
                  <div className="lg-contactform">
                    <ActionForm action={actions.update} submitLabel="Save contact" successMessage="Saved." className="lg-contactform">
                      {ids}
                      <input type="hidden" name="contactId" value={contact.id} />
                      <ContactInputs name={contact.name} email={contact.email} title={contact.title} />
                    </ActionForm>
                    <ActionForm action={actions.remove} submitLabel="Remove contact" confirmMessage={`Remove ${contact.name}?`} successMessage={`${contact.name} removed.`}>
                      {ids}
                      <input type="hidden" name="contactId" value={contact.id} />
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {!archived && (
        <div className="lg-addcontact">
          <p>Add contact</p>
          <ActionForm action={actions.add} submitLabel="Add contact" successMessage="Contact added." className="lg-contactform">
            {ids}
            <ContactInputs />
          </ActionForm>
        </div>
      )}
    </Block>
  );
}

// ----- Relevant facts -----

// The verified facts the drafter draws on, so the officer sees what the club can truthfully say.
export function FactsBlock({ workspaceId, facts }: { workspaceId: string; facts: { id: string; text: string }[] }) {
  const shown = facts.slice(0, 3);
  return (
    <Block title="Facts the AI may use">
      {shown.length === 0 ? (
        <p className="lg-muted">No verified facts yet. An owner verifies them on the fact sheet.</p>
      ) : (
        <ul className="lg-factlist">
          {shown.map((f) => (
            <li key={f.id}>
              <p className="lg-quote">&ldquo;{f.text}&rdquo;</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3">
        <Link href={`/${workspaceId}/facts`} className="lg-link">
          {facts.length > shown.length ? `See all ${facts.length} on the fact sheet` : "Open the fact sheet"}
        </Link>
      </p>
    </Block>
  );
}

// ----- The log, as ledger entries -----

// via: ASSISTANT when the person's AI assistant logged it through the MCP server.
type OutreachData = {
  id: string;
  channel: Channel;
  note: string | null;
  sentAt: Date;
  aiDraftId: string | null;
  gotReply: boolean;
  via?: Via;
  sender: { name: string };
  template: { name: string } | null;
};

// markReply is passed only while the company is in a reply stage: each entry not yet marked then
// offers "This got the reply", for a reply the stage-move question skipped.
export function OutreachBlock({ outreach, markReply, ids }: { outreach: OutreachData[]; markReply?: Action; ids?: ReactNode }) {
  return (
    <Block title="Outreach">
      {outreach.length === 0 ? (
        <Empty kind="outreach">
          <p className="lg-empty-title">No outreach logged yet.</p>
        </Empty>
      ) : (
        <ol className="lg-entries">
          {outreach.map((o, i) => {
            const next = outreach[i + 1];
            const crosses = next && boardYear(next.sentAt).start !== boardYear(o.sentAt).start;
            return (
              <Fragment key={o.id}>
                <li className="lg-entry">
                  <YearMargin iso={o.sentAt} />
                  <div className="lg-entrybody">
                    <p className="lg-entryhead">
                      <time dateTime={o.sentAt.toISOString()}>{when(o.sentAt)}</time>
                    </p>
                    <p className="lg-entryby">
                      {o.sender.name}, {CHANNEL_LABELS[o.channel]}
                      {o.aiDraftId ? ", from an AI draft" : ""}
                      {o.template ? `, template: ${o.template.name}` : ""}
                      {o.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
                    </p>
                    {o.note && <p className="lg-entrynote">{o.note}</p>}
                    {o.gotReply && (
                      <p className="lg-entryreply">
                        <span className="lg-badge lg-replied">Got the reply</span>
                      </p>
                    )}
                    {markReply && !o.gotReply && (
                      <ActionForm action={markReply} submitLabel="This got the reply" successMessage="Marked as the reply." small className="lg-entryreply">
                        {ids}
                        <input type="hidden" name="outreachId" value={o.id} />
                      </ActionForm>
                    )}
                  </div>
                </li>
                {crosses && (
                  <li>
                    <TurnoverRule endsYear={boardYear(next.sentAt).long} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      )}
    </Block>
  );
}

type ChangeData = { id: string; fromStage: Stage; toStage: Stage; changedAt: Date; via?: Via; changedBy: { name: string } };

export function HistoryBlock({ changes }: { changes: ChangeData[] }) {
  return (
    <Block title="Stage history">
      {changes.length === 0 ? (
        <p className="lg-muted">No stage moves yet.</p>
      ) : (
        <ol className="lg-entries lg-history">
          {changes.map((s, i) => {
            const next = changes[i + 1];
            const crosses = next && boardYear(next.changedAt).start !== boardYear(s.changedAt).start;
            return (
              <Fragment key={s.id}>
                <li className="lg-entry">
                  <YearMargin iso={s.changedAt} />
                  <p className="lg-entrybody">
                    {when(s.changedAt)}: {s.changedBy.name} moved it from {STAGE_LABELS[s.fromStage]} to {STAGE_LABELS[s.toStage]}
                    {s.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
                  </p>
                </li>
                {crosses && (
                  <li>
                    <TurnoverRule endsYear={boardYear(next.changedAt).long} />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      )}
    </Block>
  );
}

// ----- Details (read only, for an archived company) -----

export function ReadonlyDetails({ industry, website, notes }: { industry: string | null; website: string | null; notes: string | null }) {
  return (
    <Block title="Details">
      <dl className="lg-readonly">
        <dt>Industry</dt>
        <dd>{industry ?? "None"}</dd>
        <dt>Website</dt>
        <dd>{website ?? "None"}</dd>
        <dt>Notes</dt>
        <dd>{notes ?? "None"}</dd>
      </dl>
    </Block>
  );
}

// ----- Archive -----

export function ArchiveBlock({ ids, companyName, action }: { ids: ReactNode; companyName: string; action: Action }) {
  return (
    <Block title="Archive" note="Hides the company from the board and queue. Its history is kept and you can unarchive it.">
      <ActionForm action={action} submitLabel="Archive company" confirmMessage={`Archive ${companyName}?`} successMessage={`${companyName} archived.`}>
        {ids}
      </ActionForm>
    </Block>
  );
}
