"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useId, useState, type FormEvent } from "react";
import { formatWhen } from "@/demo/dates";
import { demoRoutes } from "@/demo/routes";
import type { CompanyDetail } from "@/demo/selectors";
import { useCompany, useDemoActions } from "@/demo/store";
import { COMPANY_LIMITS, CONTACT_LIMITS, websiteHref } from "@/demo/validation";
import type { Contact } from "@/demo/types";
import { ChevronLeftIcon, ClaimIcon, DuplicateIcon, ExternalIcon, ReleaseIcon, StageGlyph } from "../icons";
import { Ribbon, Tick, TurnoverRule, YearMargin, boardYear } from "../marks";
import { NotFoundPage } from "../not-found-page";
import { useConfirm, useNotify } from "../providers";
import { DraftPanel } from "./draft-panel";
import { LogOutreachForm } from "./log-form";
import { isLongOverdue, OverdueMark } from "./overdue";
import { StageControl } from "./stage-control";
import { Empty, ErrorLine, useClaimAction } from "./shared";

// The company page, as a two-page spread. Left page: the name, the claim, the log outreach form, the
// stage and the contacts. Right page: the outreach log as dated ledger entries with the board-year
// margin, the stage history, the details and the archive. The draft letter sits below the spread.

function Block({ id, title, children, className = "" }: { id?: string; title: string; children: React.ReactNode; className?: string }) {
  const hid = useId();
  return (
    <section id={id} className={`lg-block ${className}`} aria-labelledby={hid}>
      <h2 id={hid} className="lg-bh">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ----- Claim -----

function ClaimBlock({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const claimAction = useClaimAction(ws);
  const [error, setError] = useState<string | null>(null);
  const { company, claim } = detail;
  const holder = claim.holderName ?? "Someone";

  let text: string;
  if (detail.closed) text = `This company is ${detail.stageLabel}, so it can't be claimed.`;
  else if (claim.state === "mine") text = `You hold this until ${formatWhen(claim.expiresAt as string)}.`;
  else if (claim.state === "theirs") text = `Held by ${holder} until ${formatWhen(claim.expiresAt as string)}.`;
  else if (claim.state === "expired") text = `${holder}'s claim expired ${formatWhen(claim.expiresAt as string)}.`;
  else text = "Not claimed.";

  const release = async (force: boolean) => {
    const ok = await confirm({
      message: force ? `Release ${holder}'s claim on ${company.name}?` : `Release your claim on ${company.name}?`,
      confirmLabel: force ? "Force release" : "Release",
    });
    if (!ok) return;
    const result = force ? actions.forceRelease(ws, company.id) : actions.releaseClaim(ws, company.id);
    if (!result.ok) setError(result.error);
    else {
      setError(null);
      notify(force ? `${holder}'s claim on ${company.name} was released.` : `You released ${company.name}.`);
    }
  };

  return (
    <Block title="Claim" className="lg-claimblock">
      {claim.state === "mine" && <Ribbon size="lg" drop={claimAction.dropping === company.id} className="lg-claimribbon" />}
      <p className={`lg-claimtext ${claim.state === "mine" ? "lg-claimtext-mine" : ""}`} aria-live="polite">
        {claim.state === "theirs" ? <span className="lg-badge lg-badge-theirs lg-badge-big">{text}</span> : text}
      </p>
      <div className="lg-actions mt-3">
        {detail.canClaim && (
          <button type="button" className={`lg-btn lg-btn-primary ${claimAction.shaking === company.id ? "lg-btn-shake" : ""}`} onClick={() => claimAction.claim(company.id, company.name)}>
            <ClaimIcon size={18} />
            Claim
          </button>
        )}
        {detail.canRelease && (
          <button type="button" className="lg-btn" onClick={() => release(false)}>
            <ReleaseIcon size={18} />
            Release
          </button>
        )}
        {detail.canForceRelease && (
          <button type="button" className="lg-btn" onClick={() => release(true)}>
            <ReleaseIcon size={18} />
            Force release
          </button>
        )}
      </div>
      {claim.state === "theirs" && !detail.canForceRelease && !detail.closed && (
        <p className="lg-hint mt-2">There is no outreach form while someone else holds this company. Ask them, or an owner.</p>
      )}
      <ErrorLine>{claimAction.errors[company.id] ?? error}</ErrorLine>
    </Block>
  );
}

// ----- Contacts -----

function ContactRow({ ws, contact, editable }: { ws: string; contact: Contact; editable: boolean }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const id = useId();
  const [name, setName] = useState(contact.name);
  const [title, setTitle] = useState(contact.title ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const result = actions.updateContact(ws, contact.id, { name, title, email });
    if (!result.ok) {
      setError(result.error);
      setSaved(false);
      return;
    }
    setError(null);
    setSaved(true);
    notify("Saved.");
  };
  const remove = async () => {
    const ok = await confirm({ message: `Remove ${contact.name}?`, confirmLabel: "Remove contact" });
    if (!ok) return;
    const result = actions.removeContact(ws, contact.id);
    if (!result.ok) setError(result.error);
    else notify(`${contact.name} removed.`);
  };

  return (
    <li className="lg-contact">
      <p>
        <strong>{contact.name}</strong>
        {contact.title ? `, ${contact.title}` : ""}
        {contact.email ? <span className="lg-muted"> ({contact.email})</span> : <span className="lg-muted"> (no email)</span>}
      </p>
      {editable && (
        <details className="lg-more">
          <summary>Edit or remove</summary>
          <form onSubmit={save} className="lg-contactform">
            <div>
              <label className="lg-label" htmlFor={`${id}-n`}>
                Contact name
              </label>
              <input id={`${id}-n`} className="lg-input" value={name} maxLength={CONTACT_LIMITS.name + 20} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="lg-label" htmlFor={`${id}-t`}>
                Contact title
              </label>
              <input id={`${id}-t`} className="lg-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="lg-label" htmlFor={`${id}-e`}>
                Contact email
              </label>
              <input id={`${id}-e`} className="lg-input" type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="lg-actions">
              <button type="submit" className="lg-btn lg-btn-sm">
                Save contact
              </button>
              <button type="button" className="lg-btn lg-btn-sm" onClick={remove}>
                Remove contact
              </button>
              {saved && !error && <span className="lg-ok">Saved.</span>}
            </div>
            <ErrorLine>{error}</ErrorLine>
          </form>
        </details>
      )}
    </li>
  );
}

function ContactsBlock({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const notify = useNotify();
  const id = useId();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const result = actions.addContact(ws, detail.company.id, { name, title, email });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName("");
    setTitle("");
    setEmail("");
    notify("Contact added.");
  };

  return (
    <Block title="Contacts">
      {detail.contacts.length === 0 ? <p className="lg-muted">No contacts yet.</p> : (
        <ul className="lg-contacts">
          {detail.contacts.map((c) => (
            <ContactRow key={c.id} ws={ws} contact={c} editable={!detail.archived} />
          ))}
        </ul>
      )}
      {!detail.archived && (
        <form onSubmit={add} className="lg-contactform lg-addcontact" aria-label="Add contact">
          <p className="lg-sc lg-muted">Add contact</p>
          <div className="lg-row3">
            <div>
              <label className="lg-label" htmlFor={`${id}-n`}>
                Name
              </label>
              <input id={`${id}-n`} className="lg-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Contact name" />
            </div>
            <div>
              <label className="lg-label" htmlFor={`${id}-t`}>
                Title
              </label>
              <input id={`${id}-t`} className="lg-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Contact title" />
            </div>
            <div>
              <label className="lg-label" htmlFor={`${id}-e`}>
                Email
              </label>
              <input id={`${id}-e`} className="lg-input" type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Contact email" />
            </div>
          </div>
          <div className="mt-3">
            <button type="submit" className="lg-btn lg-btn-sm">
              Add contact
            </button>
          </div>
          <ErrorLine>{error}</ErrorLine>
        </form>
      )}
    </Block>
  );
}

// ----- The log, as ledger entries -----

function OutreachBlock({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const notify = useNotify();
  const list = detail.outreach;
  return (
    <Block title="Outreach">
      {list.length === 0 ? (
        <Empty kind="outreach">
          <p className="lg-empty-title">No outreach logged yet.</p>
        </Empty>
      ) : (
        <ol className="lg-entries">
          {list.map((o, i) => {
            const year = boardYear(o.sentAt);
            const next = list[i + 1];
            const crosses = next && boardYear(next.sentAt).start !== year.start;
            return (
              <Fragment key={o.id}>
                <li className="lg-entry">
                  <YearMargin iso={o.sentAt} />
                  <div className="lg-entrybody">
                    <p className="lg-entryhead">
                      <time dateTime={o.sentAt}>{formatWhen(o.sentAt)}</time>
                    </p>
                    <p className="lg-entryby">
                      {o.senderName}, {o.channelLabel}
                      {o.fromAiDraft ? ", from an AI draft" : ""}
                      {o.templateName ? <span className="lg-badge lg-badge-stale ml-2">{o.templateName}</span> : null}
                    </p>
                    {o.note && <p className="lg-entrynote">{o.note}</p>}
                    <label className="lg-reply">
                      <input
                        type="checkbox"
                        className="lg-check"
                        checked={o.gotReply}
                        onChange={(e) => {
                          const result = actions.setOutreachReply(ws, o.id, e.target.checked);
                          if (!result.ok) notify(result.error, "error");
                        }}
                      />
                      <span>Got a reply</span>
                      {o.gotReply && <Tick size={16} />}
                    </label>
                  </div>
                </li>
                {crosses && (
                  <li aria-hidden="false">
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

function HistoryBlock({ detail }: { detail: CompanyDetail }) {
  const list = detail.stageChanges;
  return (
    <Block title="Stage history">
      {list.length === 0 ? (
        <p className="lg-muted">No stage moves yet.</p>
      ) : (
        <ol className="lg-entries lg-history">
          {list.map((s, i) => {
            const next = list[i + 1];
            const crosses = next && boardYear(next.changedAt).start !== boardYear(s.changedAt).start;
            return (
              <Fragment key={s.id}>
                <li className="lg-entry">
                  <YearMargin iso={s.changedAt} />
                  <p className="lg-entrybody">
                    {formatWhen(s.changedAt)}: {s.changedByName} moved it from {s.fromLabel} to {s.toLabel}
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

// ----- Details -----

type Fields = { name: string; industry: string; website: string; notes: string };

function DetailsBlock({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const notify = useNotify();
  const id = useId();
  const c = detail.company;
  const start: Fields = { name: c.name, industry: c.industry ?? "", website: c.website ?? "", notes: c.notes ?? "" };
  const [fields, setFields] = useState<Fields>(start);
  const [original, setOriginal] = useState<Fields>(start);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [matches, setMatches] = useState<{ id: string; name: string; website: string | null; archived: boolean; matchedOn: ("name" | "website")[] }[] | null>(null);
  const [conflicts, setConflicts] = useState<{ field: keyof Fields; theirs: string | null }[] | null>(null);

  const set = (field: keyof Fields) => (value: string) => {
    setFields((f) => ({ ...f, [field]: value }));
    setSaved(false);
  };

  const save = (separateFrom?: string[]) => {
    setError(null);
    setMatches(null);
    setConflicts(null);
    const result = actions.updateCompany(ws, c.id, { changes: fields, original }, separateFrom);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const data = result.data;
    if (data.status === "saved") {
      setOriginal(fields);
      setSaved(true);
      notify("Saved.");
    } else if (data.status === "possible-duplicates") {
      setMatches(data.matches);
    } else {
      setConflicts(data.conflicts.map((x) => ({ field: x.field, theirs: x.theirs })));
      // Their version becomes the baseline, so saving again replaces it with yours.
      setOriginal((o) => ({ ...o, ...Object.fromEntries(data.conflicts.map((x) => [x.field, x.theirs ?? ""])) }));
    }
  };

  const labels: Record<keyof Fields, string> = { name: "Name", industry: "Industry", website: "Website", notes: "Notes" };

  if (detail.archived) {
    return (
      <Block title="Details">
        <dl className="lg-readonly">
          <dt>Industry</dt>
          <dd>{c.industry ?? "None"}</dd>
          <dt>Website</dt>
          <dd>{c.website ?? "None"}</dd>
          <dt>Notes</dt>
          <dd>{c.notes ?? "None"}</dd>
        </dl>
      </Block>
    );
  }

  return (
    <Block title="Details">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="lg-detailsform"
      >
        <div>
          <label className="lg-label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} className="lg-input" value={fields.name} onChange={(e) => set("name")(e.target.value)} />
        </div>
        <div className="lg-row2">
          <div>
            <label className="lg-label" htmlFor={`${id}-industry`}>
              Industry
            </label>
            <input id={`${id}-industry`} className="lg-input" list={`${id}-industries`} value={fields.industry} onChange={(e) => set("industry")(e.target.value)} />
            <datalist id={`${id}-industries`}>
              {detail.industries.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="lg-label" htmlFor={`${id}-website`}>
              Website
            </label>
            <input id={`${id}-website`} className="lg-input" placeholder="acme.com" value={fields.website} onChange={(e) => set("website")(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="lg-label" htmlFor={`${id}-notes`}>
            Notes
          </label>
          <textarea id={`${id}-notes`} className="lg-textarea" rows={4} value={fields.notes} onChange={(e) => set("notes")(e.target.value)} />
          <p className="lg-hint">
            Name up to {COMPANY_LIMITS.name}, industry {COMPANY_LIMITS.industry}, website {COMPANY_LIMITS.website}, notes {COMPANY_LIMITS.notes} characters.
          </p>
        </div>
        <div className="lg-actions">
          <button type="submit" className="lg-btn lg-btn-primary">
            Save changes
          </button>
          {saved && !error && (
            <span className="lg-ok" role="status">
              <Tick key={String(saved)} size={18} />
              Saved.
            </span>
          )}
        </div>
        <ErrorLine>{error}</ErrorLine>

        {matches && (
          <div className="lg-warn-box" role="alert">
            <p className="font-semibold">This looks like a company already in the workspace:</p>
            <ul className="lg-matches">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link href={demoRoutes.company(ws, m.id)} className="lg-link font-semibold">
                    {m.name}
                  </Link>
                  <span className="lg-muted">
                    {m.website ? `, ${m.website}` : ""} ({m.matchedOn.length === 2 ? "same name and website" : m.matchedOn[0] === "website" ? "same website" : "same name"})
                  </span>
                  {m.archived && <span className="lg-badge lg-badge-stale ml-2">archived</span>}
                  {!m.archived && (
                    <button
                      type="button"
                      className="lg-btn lg-btn-sm mt-2"
                      onClick={() => {
                        const r = actions.archiveDuplicate(ws, c.id, m.id);
                        if (!r.ok) setError(r.error);
                        else {
                          notify(`${m.name} archived.`);
                          setMatches((cur) => (cur ?? []).map((x) => (x.id === m.id ? { ...x, archived: true } : x)));
                        }
                      }}
                    >
                      <DuplicateIcon size={16} />
                      Same company: archive this one
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="lg-btn mt-3" onClick={() => save(matches.map((m) => m.id))}>
              Separate entries: save anyway
            </button>
          </div>
        )}

        {conflicts && (
          <div className="lg-warn-box" role="alert">
            <p className="font-semibold">Someone else changed this company while you were editing. Nothing was saved.</p>
            <ul className="lg-matches">
              {conflicts.map((x) => (
                <li key={x.field}>
                  <span>
                    {labels[x.field]} is now &ldquo;{x.theirs ?? ""}&rdquo;. Your version is still in the box.
                  </span>{" "}
                  <button
                    type="button"
                    className="lg-btn lg-btn-sm"
                    onClick={() => {
                      set(x.field)(x.theirs ?? "");
                      setConflicts((cur) => (cur ?? []).filter((y) => y.field !== x.field));
                    }}
                  >
                    Use theirs
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2">Save again to replace theirs with yours.</p>
          </div>
        )}
      </form>
    </Block>
  );
}

// ----- Archive -----

function ArchiveBlock({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <Block title="Archive">
      <p className="lg-muted">Hides the company from the board and queue. Its history is kept and you can unarchive it.</p>
      <div className="mt-3">
        <button
          type="button"
          className="lg-btn"
          onClick={async () => {
            const ok = await confirm({ message: `Archive ${detail.company.name}?`, confirmLabel: "Archive company" });
            if (!ok) return;
            const result = actions.archiveCompany(ws, detail.company.id);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            notify(`${detail.company.name} archived.`);
            router.push(demoRoutes.queue(ws));
          }}
        >
          Archive company
        </button>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Block>
  );
}

// ----- The page -----

export function CompanyScreen({ ws, companyId }: { ws: string; companyId: string }) {
  const detail = useCompany(ws, companyId);
  const actions = useDemoActions();
  const notify = useNotify();
  if (!detail) return <NotFoundPage inline />;
  const c = detail.company;
  const href = websiteHref(c.website);
  const longOverdue = isLongOverdue(detail.followUpDays);

  return (
    <article className="lg-company">
      <header className="lg-cohead">
        <Link href={demoRoutes.queue(ws)} className="lg-back">
          <ChevronLeftIcon size={18} />
          Back
        </Link>
        <h1 className="lg-h1">{c.name}</h1>
        <p className="lg-coline">
          <span className="lg-stagechip lg-sc" data-stage={c.stage}>
            <StageGlyph stage={c.stage} size={15} />
            {detail.stageLabel}
          </span>
          {c.industry && <span>{c.industry}</span>}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
              {c.website}
              <ExternalIcon size={14} className="ml-1 inline-block align-[-2px]" />
            </a>
          )}
        </p>
        <p className="lg-coline">
          <span>{detail.lastContacted ? `Last contacted ${detail.lastContacted}` : "Never contacted"}</span>
          {detail.nextFollowUp && detail.followUpDays !== null && (
            <span className="lg-cofollow">
              <span>Follow up {detail.nextFollowUp}</span>
              <OverdueMark days={detail.followUpDays} dueOn={detail.nextFollowUp} size={15} />
              {longOverdue && <span className="lg-od-note lg-sc">Long overdue</span>}
            </span>
          )}
        </p>
      </header>

      {detail.archived && (
        <div className="lg-archivedbanner" role="status">
          <p>This company is archived. It is hidden from the board and queue, and its history is kept.</p>
          <button
            type="button"
            className="lg-btn"
            onClick={() => {
              const result = actions.unarchiveCompany(ws, c.id);
              if (!result.ok) notify(result.error, "error");
              else notify(`${c.name} is back on the board.`);
            }}
          >
            Unarchive
          </button>
        </div>
      )}

      <div className="lg-spread">
        <div className="lg-leaf-page lg-sheet lg-leaf-left">
          {!detail.archived && <ClaimBlock ws={ws} detail={detail} />}
          {detail.canLogOutreach && (
            <Block id="log-outreach" title="Log outreach" className="lg-logblock">
              <p className="lg-hint mb-3">After you reach out from your own inbox or in person. Saving renews your claim.</p>
              <LogOutreachForm ws={ws} companyId={c.id} />
            </Block>
          )}
          {!detail.archived && (
            <Block title="Stage">
              <StageControl key={c.stage} ws={ws} companyId={c.id} companyName={c.name} stage={c.stage} />
            </Block>
          )}
          <ContactsBlock ws={ws} detail={detail} />
        </div>
        <div className="lg-leaf-page lg-sheet lg-leaf-right">
          <OutreachBlock ws={ws} detail={detail} />
          <HistoryBlock detail={detail} />
          <DetailsBlock key={`${c.id}-${c.archivedAt ? "a" : "x"}`} ws={ws} detail={detail} />
          {!detail.archived && <ArchiveBlock ws={ws} detail={detail} />}
        </div>
      </div>

      {detail.canDraft && <DraftPanel ws={ws} detail={detail} />}
    </article>
  );
}
