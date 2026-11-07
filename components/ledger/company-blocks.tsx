"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { EditDetailsContext } from "@/components/company-form";
import type { Channel, Stage, Via } from "@/generated/prisma/enums";
import { CHANNEL_LABELS } from "@/lib/channels";
import type { LookAlike, ReplyChoice } from "@/lib/companies";
import { STAGE_LABELS } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import { Disclosure, LazyDisclosure, useLazyDisclosure } from "./disclosure";
import { boardYear } from "./board-year";
import { focusSoon } from "./focus";
import { CopyLinkIcon, ExternalIcon } from "./icons";
import { TurnoverRule } from "./marks";
import { completeStamp, removeAway, restore } from "./motion-kit";
import { OverflowMenu, type OverflowItem } from "./overflow-menu";
import { useNotify } from "./providers";
import { ReplyPrompt } from "./reply-prompt";
import { Empty } from "./shared";
import { MoreLink, ShowMore } from "./show-more";
import { useStageMove } from "../stage-form";
import "./company.css";
import "./templates.css";

// The blocks of the company page, in reading order: the header (name, one line of facts, the notes
// and the ⋯ menu), the outreach log, the contacts and the history. Lists show the useful few and
// put the rest one click away (ShowMore); rare actions sit in a ⋯ menu (OverflowMenu). The forms
// inside run the real server actions.

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

const TIME_ZONE = "America/Indiana/Indianapolis";

// "Nov 21", with the year when it isn't this year ("Nov 21, 2025"), and the time when two entries
// of the same list share a day.
function dateLabel(date: Date, thisYear: number, withTime: boolean): string {
  const year = Number(date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, year: "numeric" }));
  const text = date.toLocaleDateString("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric", ...(year !== thisYear ? { year: "numeric" } : {}) });
  return withTime ? `${text}, ${date.toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" })}` : text;
}
const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
function sharedDays(dates: Date[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const d of dates) {
    const k = dayKey(d);
    if (seen.has(k)) shared.add(k);
    seen.add(k);
  }
  return shared;
}

export function Block({
  id,
  title,
  count,
  children,
  className = "",
  "data-tour": dataTour,
}: {
  id?: string;
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
  "data-tour"?: string;
}) {
  const hid = useId();
  return (
    <section id={id} className={`lg-block ${className}`} aria-labelledby={hid} data-tour={dataTour}>
      <h2 id={hid} className="lg-bh" tabIndex={-1}>
        {title}
        {count !== undefined && count > 0 && <span className="lg-bh-count">{count.toLocaleString("en-US")}</span>}
      </h2>
      {children}
    </section>
  );
}

// Text clamped to a few lines (CSS line-clamp), with "Show more" only when it is actually cut off.
export function Clamp({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, text]);
  return (
    <div className={`lg-clampbox ${className}`}>
      <p ref={ref} className="lg-clamp lg-wrap-any" data-open={open || undefined}>
        {text}
      </p>
      {(cut || open) && (
        <button type="button" className="lg-linkbtn lg-clamp-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// ----- The claim ticket's buttons -----

// Runs `run` on the element `find` returns once the server's fresh render has drawn it: looks again
// on each frame for about a second, then gives up quietly. For a finish moment that plays on what
// the action brought (the new ticket, the new outreach entry), never on a page load.
export function whenDrawn<T extends Element>(find: () => T | null | undefined, run: (el: T) => void): void {
  if (typeof window === "undefined") return;
  let frames = 0;
  const look = () => {
    const el = find();
    if (el && el.isConnected) return run(el);
    if (++frames < 60) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

const TICKET = '[data-tour="company-claim"]';

// Claim it / Claim again. On success the new ticket is stamped (a press, a moss ring) and the gilt
// ribbon settles onto its stub; the log card appears under it and its checked channel chip takes
// focus. A refusal (someone was quicker) is a toast naming the winner, the page re-renders with them
// on the ticket, and focus moves to the ticket, never to <body>.
export function ClaimButton({ action, workspaceId, companyId, companyName, label }: { action: Action; workspaceId: string; companyId: string; companyName: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const notify = useNotify();
  const router = useRouter();
  return (
    <button
      type="button"
      className="lg-btn lg-btn-sm lg-btn-primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const form = new FormData();
          form.set("workspaceId", workspaceId);
          form.set("companyId", companyId);
          const result = await action(null, form);
          if (result.ok) {
            notify(`Claimed ${companyName}.`);
            whenDrawn(
              () => document.querySelector<HTMLElement>(`${TICKET}[data-kind="mine"]`),
              (ticket) => void completeStamp(ticket, { mark: ticket.querySelector(".lg-ticket-ribbon") }),
            );
            startTransition(() => focusSoon('#log-outreach input[name="channel"]:checked'));
          } else {
            notify(result.error, "error");
            router.refresh();
            startTransition(() => focusSoon(TICKET));
          }
        })
      }
    >
      {pending ? "Working..." : label}
    </button>
  );
}

// Release (your own claim) and Force release (an owner, on someone else's). Once confirmed, the
// ticket's body tears off along the perforation and slides away while the server releases it; the
// stub stays for the moment it takes the fresh, free ticket to arrive. A refusal puts the body back.
// Focus goes to the new ticket's Claim button.
export function TicketRelease({
  action,
  workspaceId,
  companyId,
  submitLabel,
  ariaLabel,
  confirmMessage,
  successMessage,
}: {
  action: Action;
  workspaceId: string;
  companyId: string;
  submitLabel: string;
  ariaLabel?: string;
  confirmMessage: string;
  successMessage: string;
}) {
  const tear = useCallback<Action>(
    async (prev, form) => {
      const ticket = document.querySelector<HTMLElement>(TICKET);
      const body = ticket?.querySelector<HTMLElement>(".lg-ticket-body");
      const leaving = removeAway(body, { direction: "right", distance: 28, collapse: false, focus: ticket });
      try {
        const result = await action(prev, form);
        if (!result.ok) restore(body);
        else await leaving;
        return result;
      } catch (error) {
        restore(body);
        throw error;
      }
    },
    [action],
  );
  return (
    <ActionForm
      action={tear}
      submitLabel={submitLabel}
      small
      submitAriaLabel={ariaLabel}
      confirmMessage={confirmMessage}
      successMessage={successMessage}
      focusAfter={`${TICKET} button`}
      className="lg-ticket-form"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
    </ActionForm>
  );
}

// ----- The header -----


type HeaderMenu = {
  workspaceId: string;
  companyId: string;
  // Edit details: everywhere but an archived company.
  canEdit: boolean;
  // Archive and the stage moves in the menu: whoever the server lets do them.
  canControl: boolean;
  // "Move to…" in the menu (an owner on someone else's claim), "Reopen…" (a closed company).
  stageItem: "move" | "reopen" | null;
  archive?: Action;
  archiveAsDuplicate?: Action;
  lookAlikes: LookAlike[];
};

export function CompanyHeader({
  name,
  industry,
  website,
  href,
  host,
  meta,
  notes,
  menu,
  editForm,
}: {
  name: string;
  industry: string | null;
  website: string | null;
  href: string | null;
  host: string | null;
  // The follow-up or outcome line, drawn on the server.
  meta: ReactNode;
  notes: string | null;
  menu: HeaderMenu | null;
  editForm: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const stage = useStageMove();
  // Archive, once confirmed: the company's sheet slides away while the server archives it, and the
  // archived page takes its place. A refusal brings the sheet back.
  const archiveAction = menu?.archive;
  const archive = useCallback<Action>(
    async (prev, form) => {
      if (!archiveAction) return { ok: false, error: "Archive is not available here." };
      const sheet = document.querySelector<HTMLElement>(".lg-company .lg-cogrid");
      const leaving = removeAway(sheet, { direction: "left", distance: 24, collapse: false, focus: document.querySelector<HTMLElement>(".lg-company .lg-back") });
      try {
        const result = await archiveAction(prev, form);
        if (!result.ok) restore(sheet);
        else await leaving;
        return result;
      } catch (error) {
        restore(sheet);
        throw error;
      }
    },
    [archiveAction],
  );
  const fields: Record<string, string> = menu ? { workspaceId: menu.workspaceId, companyId: menu.companyId } : {};
  const items: OverflowItem[] = [];
  if (menu?.canEdit) {
    items.push({
      key: "edit",
      label: "Edit details",
      hint: "Name, industry, website, notes",
      onSelect: () => {
        setEditing(true);
        focusSoon('.lg-coedit input[name="name"]');
      },
    });
  }
  if (menu?.canControl && menu.stageItem && stage) {
    items.push({
      key: "stage",
      label: menu.stageItem === "reopen" ? "Reopen…" : "Move to…",
      hint: menu.stageItem === "reopen" ? "Move it back to an earlier stage" : undefined,
      onSelect: () => {
        const button = document.querySelector<HTMLElement>('[data-tour="company-more"]');
        if (button) stage.open(button);
      },
    });
  }
  if (menu?.canControl && menu.archiveAsDuplicate) {
    for (const other of menu.lookAlikes) {
      items.push({
        key: `dup-${other.id}`,
        label: `Same as ${other.name}: archive this one`,
        danger: true,
        action: menu.archiveAsDuplicate,
        fields: { ...fields, keepId: other.id },
        confirmMessage: `Archive ${name} as a duplicate of ${other.name}? ${other.name} opens next. Its history is kept.`,
      });
    }
  }
  if (menu?.canControl && archive) {
    items.push({
      key: "archive",
      label: "Archive",
      hint: "Hide it from the board and queue",
      danger: true,
      action: archive,
      fields,
      confirmMessage: `Archive ${name}? It leaves the board and queue. Its history is kept and you can unarchive it.`,
      successMessage: `${name} archived.`,
      focusAfter: "#archived-banner",
    });
  }

  // Edit details opens CompanyForm in place under the header; the form closes it after a save or on Cancel.
  const ctx = useMemo(
    () => ({
      close: (saved: boolean) => {
        setEditing(false);
        focusSoon(saved ? ".lg-company h1" : '[data-tour="company-more"]');
      },
    }),
    [],
  );

  return (
    <header className="lg-cohead">
      <div className="lg-cotitle">
        <h1 className="lg-h1 lg-coname" tabIndex={-1} title={name}>
          {name}
        </h1>
        {items.length > 0 && <OverflowMenu label={`More actions for ${name}`} items={items} data-tour="company-more" />}
      </div>
      {(industry || website || meta) && (
        <p className="lg-coline">
          {industry && (
            <span className="lg-trunc" title={industry}>
              {industry}
            </span>
          )}
          {website &&
            (href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="lg-link lg-cosite" title={website} aria-label={`${website} (opens in a new tab)`}>
                <span className="lg-trunc">{host ?? website}</span>
                <ExternalIcon size={14} className="lg-cosite-icon" />
              </a>
            ) : (
              <span className="lg-trunc" title={website}>
                {website}
              </span>
            ))}
          {meta}
        </p>
      )}
      {notes && !editing && <Clamp text={notes} className="lg-conotes" />}
      {editing && (
        <div className="lg-coedit">
          <EditDetailsContext value={ctx}>{editForm}</EditDetailsContext>
        </div>
      )}
    </header>
  );
}

// ----- Contacts -----

type ContactData = { id: string; name: string; title: string | null; email: string | null };

function ContactInputs({ name, email, title }: { name?: string; email?: string | null; title?: string | null }) {
  return (
    <div className="lg-row3">
      <label className="lg-label">
        Name
        <input name="name" required maxLength={120} defaultValue={name} className="lg-input mt-1" />
      </label>
      <label className="lg-label">
        Title
        <input name="title" maxLength={120} defaultValue={title ?? ""} className="lg-input mt-1" />
      </label>
      <label className="lg-label">
        Email
        <input name="email" type="email" maxLength={254} defaultValue={email ?? ""} className="lg-input mt-1" />
      </label>
    </div>
  );
}

type ContactActions = { add: Action; update: Action; remove: Action };

function ContactRow({ contact, ids, actions, readOnly }: { contact: ContactData; ids: { workspaceId: string; companyId: string }; actions: ContactActions; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const notify = useNotify();
  const rowId = `contact-${contact.id}`;
  const copy = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      notify(`Copied ${email}.`);
    } catch {
      notify("Could not copy. Select the address and copy it yourself.", "error");
    }
  };
  return (
    <li id={rowId} className="lg-contact">
      <div className="lg-contact-line">
        <p className="lg-contact-who">
          <strong className="lg-trunc" title={contact.name}>
            {contact.name}
          </strong>
          {contact.title && (
            <span className="lg-trunc lg-muted" title={contact.title}>
              {contact.title}
            </span>
          )}
        </p>
        {contact.email ? (
          <span className="lg-contact-mail">
            <a href={`mailto:${contact.email}`} className="lg-link lg-trunc" title={contact.email}>
              {contact.email}
            </a>
            <button type="button" className="lg-copybtn" aria-label={`Copy ${contact.name}'s email`} title="Copy email" onClick={() => copy(contact.email as string)}>
              <CopyLinkIcon size={16} />
            </button>
          </span>
        ) : (
          <span className="lg-muted lg-contact-mail">No email</span>
        )}
        {!readOnly && (
          <OverflowMenu
            label={`More actions for ${contact.name}`}
            items={[
              {
                key: "edit",
                label: "Edit",
                onSelect: () => {
                  setEditing(true);
                  focusSoon(`#${rowId} .lg-contactedit input[name="name"]`);
                },
              },
              {
                key: "remove",
                label: "Remove",
                danger: true,
                action: actions.remove,
                fields: { ...ids, contactId: contact.id },
                confirmMessage: `Remove ${contact.name}? Their name and email are deleted.`,
                successMessage: `${contact.name} removed.`,
                focusAfter: "#contacts-h",
              },
            ]}
          />
        )}
      </div>
      {editing && (
        <div className="lg-contactedit">
          <ActionForm
            action={actions.update}
            submitLabel="Save contact"
            successMessage="Saved."
            onSuccess={() => setEditing(false)}
            focusAfter={`#${rowId} .lg-omenu-btn`}
            className="lg-contactform"
          >
            <input type="hidden" name="workspaceId" value={ids.workspaceId} />
            <input type="hidden" name="companyId" value={ids.companyId} />
            <input type="hidden" name="contactId" value={contact.id} />
            <ContactInputs name={contact.name} email={contact.email} title={contact.title} />
          </ActionForm>
          <button
            type="button"
            className="lg-btn lg-btn-sm lg-contactcancel"
            onClick={() => {
              setEditing(false);
              focusSoon(`#${rowId} .lg-omenu-btn`);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function AddContactForm({ ids, add }: { ids: { workspaceId: string; companyId: string }; add: Action }) {
  const lazy = useLazyDisclosure();
  return (
    <ActionForm action={add} submitLabel="Add contact" successMessage="Contact added." onSuccess={() => lazy?.close()} className="lg-contactform">
      <input type="hidden" name="workspaceId" value={ids.workspaceId} />
      <input type="hidden" name="companyId" value={ids.companyId} />
      <ContactInputs />
    </ActionForm>
  );
}

export function ContactsBlock({
  workspaceId,
  companyId,
  contacts,
  readOnly,
  actions,
}: {
  workspaceId: string;
  companyId: string;
  contacts: ContactData[];
  readOnly: boolean;
  actions: ContactActions;
}) {
  const ids = { workspaceId, companyId };
  const list =
    contacts.length === 0 ? (
      <p className="lg-muted">No contacts yet.</p>
    ) : (
      <ShowMore initial={3} label="contacts" as="ul" listClassName="lg-contacts">
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c} ids={ids} actions={actions} readOnly={readOnly} />
        ))}
      </ShowMore>
    );
  return (
    <section className="lg-block" aria-labelledby="contacts-h">
      <h2 id="contacts-h" className="lg-bh" tabIndex={-1}>
        Contacts
        {contacts.length > 0 && <span className="lg-bh-count">{contacts.length.toLocaleString("en-US")}</span>}
      </h2>
      {list}
      {!readOnly && (
        <LazyDisclosure summary="Add contact" variant="inline" className="lg-addcontact" data-tour="add-contact">
          <AddContactForm ids={ids} add={actions.add} />
        </LazyDisclosure>
      )}
    </section>
  );
}

// ----- The outreach log -----

// via: ASSISTANT when the person's AI assistant logged it through the MCP server.
export type OutreachData = {
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

// Where one board's entries end and an older board's begin: the double rule, drawn at the top of
// the first older entry (newest first, so the board above it has ended).
function turnoverBefore(at: Date, newer: Date | undefined): ReactNode {
  if (!newer || boardYear(newer).start === boardYear(at).start) return null;
  return <TurnoverRule endsYear={boardYear(at).long} />;
}

// One ledger line: the date in the margin, then who, how and the note.
function OutreachEntry({ o, label, turnover }: { o: OutreachData; label: string; turnover: ReactNode }) {
  const by = [o.sender.name, CHANNEL_LABELS[o.channel], o.aiDraftId ? "from an AI draft" : null, o.template ? `template: ${o.template.name}` : null].filter(Boolean).join(" · ");
  return (
    <li className="lg-entry" data-entry-id={o.id}>
      {turnover}
      <div className="lg-entryline">
        <time className="lg-entrydate" dateTime={o.sentAt.toISOString()}>
          {label}
        </time>
        <div className="lg-entrybody">
          <p className="lg-entryby lg-wrap-any">
            {o.gotReply && <span className="lg-badge lg-replied">Got the reply</span>}
            {by}
            {o.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
          </p>
          {o.note && <Clamp text={o.note} className="lg-entrynote" />}
        </div>
      </div>
    </li>
  );
}

const toChoice = (o: OutreachData): ReplyChoice => ({
  id: o.id,
  sentAt: o.sentAt,
  channel: o.channel,
  senderName: o.sender.name,
  templateName: o.template?.name ?? null,
  aiDrafted: o.aiDraftId !== null,
  note: o.note,
  gotReply: o.gotReply,
});

// One "Mark which one got the reply" link for a company in a reply stage, opening the same question
// a stage move asks (ReplyPrompt), over the latest ten entries.
function MarkReply({ workspaceId, companyId, companyName, outreach }: { workspaceId: string; companyId: string; companyName: string; outreach: OutreachData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="lg-markreply">
        <button type="button" className="lg-linkbtn" onClick={() => setOpen(true)}>
          Mark which one got the reply
        </button>
      </p>
      {open && (
        <ReplyPrompt
          workspaceId={workspaceId}
          companyId={companyId}
          companyName={companyName}
          choices={outreach.slice(0, 10).map(toChoice)}
          onDone={() => {
            setOpen(false);
            // The link goes once an entry is marked, so the block's heading takes focus.
            focusSoon("#outreach-h");
          }}
        />
      )}
    </>
  );
}

// `older`: the page was asked for older entries (?outreach=all). The "Show more" link then stays in
// place as "Showing all 200.", so the focus it had lands there instead of on <body>.
export function OutreachList({ outreach, total, thisYear, olderHref, older = false }: { outreach: OutreachData[]; total: number; thisYear: number; olderHref: string; older?: boolean }) {
  const shared = sharedDays(outreach.map((o) => o.sentAt));
  return (
    <>
      <ShowMore initial={5} label="outreach entries" as="ol" listClassName="lg-entries">
        {outreach.map((o, i) => (
          <OutreachEntry key={o.id} o={o} label={dateLabel(o.sentAt, thisYear, shared.has(dayKey(o.sentAt)))} turnover={turnoverBefore(o.sentAt, outreach[i - 1]?.sentAt)} />
        ))}
      </ShowMore>
      {(total > outreach.length || older) && (
        <>
          {total > outreach.length && (
            <p className="lg-hint lg-older">
              Showing the latest {outreach.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}.
            </p>
          )}
          <MoreLink href={olderHref} shown={outreach.length} total={total} step={400} cap={500} />
        </>
      )}
    </>
  );
}

export function OutreachBlock({
  workspaceId,
  companyId,
  companyName,
  outreach,
  total,
  thisYear,
  olderHref,
  older,
  canMarkReply,
}: {
  workspaceId: string;
  companyId: string;
  companyName: string;
  outreach: OutreachData[];
  total: number;
  thisYear: number;
  olderHref: string;
  older: boolean;
  canMarkReply: boolean;
}) {
  return (
    <section className="lg-block" id="outreach" aria-labelledby="outreach-h">
      <h2 id="outreach-h" className="lg-bh" tabIndex={-1}>
        Outreach
        {total > 0 && <span className="lg-bh-count">{total.toLocaleString("en-US")}</span>}
      </h2>
      {outreach.length === 0 ? (
        <Empty kind="outreach">
          <p className="lg-empty-title">No outreach logged yet.</p>
        </Empty>
      ) : (
        <>
          {canMarkReply && !outreach.some((o) => o.gotReply) && <MarkReply workspaceId={workspaceId} companyId={companyId} companyName={companyName} outreach={outreach} />}
          <OutreachList outreach={outreach} total={total} thisYear={thisYear} olderHref={olderHref} older={older} />
        </>
      )}
    </section>
  );
}

// ----- History -----

type ChangeData = { id: string; fromStage: Stage; toStage: Stage; changedAt: Date; via?: Via; changedBy: { name: string } };

function StageMoves({ changes, total, thisYear, olderHref, older }: { changes: ChangeData[]; total: number; thisYear: number; olderHref: string; older: boolean }) {
  const shared = sharedDays(changes.map((c) => c.changedAt));
  if (changes.length === 0) return <p className="lg-muted">No stage moves yet.</p>;
  return (
    <>
      <ShowMore initial={10} label="stage moves" as="ol" listClassName="lg-entries lg-history">
        {changes.map((s, i) => (
          <li key={s.id} className="lg-entry">
            {turnoverBefore(s.changedAt, changes[i - 1]?.changedAt)}
            <div className="lg-entryline">
              <time className="lg-entrydate" dateTime={s.changedAt.toISOString()}>
                {dateLabel(s.changedAt, thisYear, shared.has(dayKey(s.changedAt)))}
              </time>
              <p className="lg-entrybody">
                {s.changedBy.name} moved it from {STAGE_LABELS[s.fromStage]} to {STAGE_LABELS[s.toStage]}
                {s.via === "ASSISTANT" && <span className="lg-via">via assistant</span>}
              </p>
            </div>
          </li>
        ))}
      </ShowMore>
      {(total > changes.length || older) && (
        <>
          {total > changes.length && (
            <p className="lg-hint lg-older">
              Showing the latest {changes.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")}.
            </p>
          )}
          <MoreLink href={olderHref} shown={changes.length} total={total} step={450} cap={500} />
        </>
      )}
    </>
  );
}

// "History", collapsed at the bottom with its count: the stage moves, and for an archived company
// the outreach log too (`outreach`), since nothing else on its page is in play.
export function HistoryBlock({
  changes,
  total,
  thisYear,
  olderHref,
  outreach,
  defaultOpen = false,
}: {
  changes: ChangeData[];
  total: number;
  thisYear: number;
  olderHref: string;
  outreach?: { list: OutreachData[]; total: number; olderHref: string; older: boolean };
  defaultOpen?: boolean;
}) {
  const count = total + (outreach?.total ?? 0);
  return (
    <Disclosure summary="History" count={count} id="history" defaultOpen={defaultOpen} className="lg-codisc">
      {outreach && (
        <>
          <h3 className="lg-h3 lg-subhead">Outreach</h3>
          {outreach.list.length === 0 ? (
            <p className="lg-muted">No outreach logged.</p>
          ) : (
            <OutreachList outreach={outreach.list} total={outreach.total} thisYear={thisYear} olderHref={outreach.olderHref} older={outreach.older} />
          )}
          <h3 className="lg-h3 lg-subhead">Stage moves</h3>
        </>
      )}
      <StageMoves changes={changes} total={total} thisYear={thisYear} olderHref={olderHref} older={defaultOpen} />
    </Disclosure>
  );
}

// Contacts of an archived company: read-only, collapsed with the count.
export function ArchivedContacts({ contacts }: { contacts: ContactData[] }) {
  return (
    <Disclosure summary="Contacts" count={contacts.length} className="lg-codisc">
      {contacts.length === 0 ? (
        <p className="lg-muted">No contacts.</p>
      ) : (
        <ShowMore initial={3} label="contacts" as="ul" listClassName="lg-contacts">
          {contacts.map((c) => (
            <li key={c.id} className="lg-contact">
              <div className="lg-contact-line">
                <p className="lg-contact-who">
                  <strong className="lg-trunc" title={c.name}>
                    {c.name}
                  </strong>
                  {c.title && (
                    <span className="lg-trunc lg-muted" title={c.title}>
                      {c.title}
                    </span>
                  )}
                </p>
                <span className="lg-trunc lg-muted lg-contact-mail" title={c.email ?? undefined}>
                  {c.email ?? "No email"}
                </span>
              </div>
            </li>
          ))}
        </ShowMore>
      )}
    </Disclosure>
  );
}

// Opened from the queue's "Log outreach" (…#log-outreach): the form is ready to type into. The
// block's scroll-margin keeps its heading clear of the phone's sticky bar (company.css).
export function LogHashFocus() {
  useEffect(() => {
    const go = () => {
      if (window.location.hash === "#log-outreach") focusSoon('#log-outreach input[name="channel"]:checked');
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
