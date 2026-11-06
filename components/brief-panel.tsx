"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState } from "react";
import "@/components/ledger/zod-jitless";
import { ActionForm } from "@/components/action-form";
import { QuillWait } from "@/components/draft-panel";
import { AiDraftIcon, ExternalIcon, WarningIcon } from "@/components/ledger/icons";
import { Tick } from "@/components/ledger/marks";
import { ErrorLine } from "@/components/ledger/shared";
import { when } from "@/lib/dates";
import type { BriefView } from "@/lib/research/brief";
import { DOOR_LABELS } from "@/lib/research/doors";
import { BRIEF_SOURCES_MAX, type ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";
import "@/components/ledger/research.css";

type Source = { id: string; label: string; host: string; suggested: boolean };

type Props = {
  workspaceId: string;
  companyId: string;
  // The workspace's approved sources; the ones on the company's own domain start ticked.
  sources: Source[];
  isOwner: boolean;
  usage: { used: number; limit: number };
  // The latest brief for this company, whoever asked for it.
  initialBrief: BriefView | null;
  actions: {
    request: (prev: ActionResult<BriefView> | null, form: FormData) => Promise<ActionResult<BriefView>>;
    accept: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  };
};

// A link's text: the page without its scheme, so the reader sees where it goes.
const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

// "Who to contact": asks for a research brief from approved pages and shows the latest one as a
// suggestion. Each item quotes the page it came from and links to it; nothing reaches the company
// until someone adds a specific item to its notes.
export function BriefPanel(props: Props) {
  const id = useId();
  const [state, requestAction, pending] = useActionState(props.actions.request, null);
  const fresh = state?.ok ? state.data : null;
  // The page reloads with the newest brief after a request or an "Add to notes"; a brief this
  // request just returned is shown until then.
  const brief = fresh && (!props.initialBrief || fresh.createdAt > props.initialBrief.createdAt) ? fresh : props.initialBrief;
  const [picked, setPicked] = useState(() => new Set(props.sources.filter((s) => s.suggested).map((s) => s.id).slice(0, BRIEF_SOURCES_MAX)));
  const limitLeft = props.usage.limit - props.usage.used;

  const toggle = (sourceId: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });

  return (
    <section id="research" className="lg-draftpanel lg-brief" aria-labelledby={`${id}-h`}>
      <div className="lg-draft-head">
        <h2 id={`${id}-h`} className="lg-h2">
          Who to contact
        </h2>
        <p className="lg-hint">
          A brief on the company&apos;s official doors, read only from pages an owner approved. Every line quotes its page. {props.usage.used} of{" "}
          {props.usage.limit} AI calls used in the last 30 days.
        </p>
      </div>

      {props.sources.length === 0 ? (
        <div className="lg-draftoff">
          <p>No approved pages yet.</p>
          <p className="lg-hint">
            {props.isOwner ? (
              <>
                Add a company&apos;s careers, university relations or giving pages in{" "}
                <Link href={`/${props.workspaceId}/settings#research-sources`} className="lg-link">
                  Settings
                </Link>
                .
              </>
            ) : (
              "An owner can add pages to read in Settings."
            )}
          </p>
        </div>
      ) : (
        <form
          // Sent by hand rather than through `action`, so React doesn't reset the form afterwards and
          // the ticked pages stay as the person left them.
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => requestAction(data));
          }}
          className="lg-briefform"
        >
          <input type="hidden" name="workspaceId" value={props.workspaceId} />
          <input type="hidden" name="companyId" value={props.companyId} />
          <fieldset className="lg-chipset">
            <legend className="lg-label">
              Pages to read ({picked.size} of up to {BRIEF_SOURCES_MAX})
            </legend>
            <div className="lg-chips">
              {props.sources.map((s) => (
                <label key={s.id} className="lg-chipx" title={s.host}>
                  <input
                    type="checkbox"
                    name="sourceId"
                    value={s.id}
                    checked={picked.has(s.id)}
                    disabled={!picked.has(s.id) && picked.size >= BRIEF_SOURCES_MAX}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="lg-draftgo">
            <button type="submit" disabled={pending || picked.size === 0 || limitLeft < 2} className="lg-btn lg-btn-primary">
              <AiDraftIcon size={18} />
              {pending ? "Reading... (up to a few minutes)" : "Research who to contact"}
            </button>
            <p className="lg-hint">
              Coppice fetches only the ticked pages, skips any whose robots.txt says no, and masks emails and phone numbers before
              Google&apos;s AI reads them. Two AI calls.
            </p>
          </div>
          {limitLeft < 2 && (
            <ErrorLine>
              A brief takes two AI calls and this workspace has {Math.max(0, limitLeft)} left for the last 30 days. An owner can raise the limit in{" "}
              <Link href={`/${props.workspaceId}/settings`} className="lg-link">
                Settings
              </Link>
              .
            </ErrorLine>
          )}
          {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
        </form>
      )}

      {pending && <QuillWait label="Reading the pages, then writing the brief. This takes up to a few minutes." />}

      {brief && <BriefCard brief={brief} {...props} />}
    </section>
  );
}

type CardProps = Props & { brief: BriefView };

// "Add to notes" for one item or inbox, or a mark once it is in the notes.
function AddToNotes({ itemId, accepted, brief, ...props }: CardProps & { itemId: string; accepted: boolean }) {
  if (accepted) {
    return (
      <p className="lg-brief-added">
        <Tick size={18} />
        In the notes
      </p>
    );
  }
  return (
    <ActionForm action={props.actions.accept} submitLabel="Add to notes" successMessage="Added to the notes." small>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input type="hidden" name="companyId" value={props.companyId} />
      <input type="hidden" name="briefId" value={brief.id} />
      <input type="hidden" name="itemId" value={itemId} />
    </ActionForm>
  );
}

function BriefCard(props: CardProps) {
  const { brief } = props;
  const flagged = brief.pages.filter((p) => p.injection.length > 0);

  return (
    <article className="lg-brief-card" aria-label="Research brief">
      <header className="lg-letter-head">
        <h3 className="lg-h3">Suggested doors</h3>
        <p className="lg-letter-no lg-tag">
          {when(brief.createdAt)}, asked by {brief.createdBy}
        </p>
      </header>
      <p className="lg-hint lg-brief-note">A suggestion, not a fact: open each page and check it. Adding an item writes one line to this company&apos;s notes.</p>

      {flagged.length > 0 && (
        <div className="lg-brief-warn" role="note">
          <WarningIcon size={18} />
          <div>
            <p>
              <strong>{flagged.length === 1 ? "One page" : `${flagged.length} pages`} tried to give the AI instructions.</strong> Items from it still
              had to quote the page, and links only ever go to pages that were fetched, but read them with care.
            </p>
            <ul>
              {flagged.map((p) => (
                <li key={p.position}>
                  {shortUrl(p.finalUrl ?? p.url)}: &ldquo;{p.injection[0]}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {brief.items.length === 0 ? (
        <p className="lg-brief-empty">
          {brief.status === "NO_PAGES"
            ? "None of the pages could be read, so the AI wasn't asked. See why below."
            : "Nothing on these pages checked out as a way in. Try other pages."}
        </p>
      ) : (
        <ol className="lg-brief-items">
          {brief.items.map((item) => (
            <BriefItemRow key={item.id} {...props} item={item} />
          ))}
        </ol>
      )}

      {brief.inboxes.length > 0 && <InboxList {...props} />}
      <PagesRead pages={brief.pages} />
    </article>
  );
}

function BriefItemRow({ item, ...props }: CardProps & { item: BriefView["items"][number] }) {
  return (
    <li className="lg-brief-item">
      <p className="lg-brief-door lg-tag">{DOOR_LABELS[item.door]}</p>
      <p className="lg-brief-title">
        <strong>{item.title}</strong>
      </p>
      <p>{item.detail}</p>
      {item.deadline && (
        <p className="lg-brief-deadline">
          <span className="lg-tag">Deadline</span> {item.deadline}
        </p>
      )}
      <blockquote className="lg-brief-quote">
        <p className="lg-quote">&ldquo;{item.quote}&rdquo;</p>
        <footer>
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
            {shortUrl(item.url)}
            <ExternalIcon size={14} className="ml-1 inline-block align-[-2px]" />
          </a>
        </footer>
      </blockquote>
      <AddToNotes {...props} itemId={item.id} accepted={item.accepted} />
    </li>
  );
}

function InboxList(props: CardProps) {
  return (
    <div className="lg-brief-inboxes">
      <p className="lg-tag">Team inboxes on these pages</p>
      <ul>
        {props.brief.inboxes.map((inbox) => (
          <li key={inbox.id}>
            <span>
              <strong className="lg-brief-email">{inbox.email}</strong>{" "}
              <span className="lg-hint">
                on{" "}
                <a href={inbox.url} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
                  {shortUrl(inbox.url)}
                </a>
              </span>
            </span>
            <AddToNotes {...props} itemId={inbox.id} accepted={inbox.accepted} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PagesRead({ pages }: { pages: BriefView["pages"] }) {
  const read = pages.filter((p) => !p.skipped);
  return (
    <details className="lg-more lg-brief-pages">
      <summary>
        Pages read: {read.length} of {pages.length}
      </summary>
      <ul>
        {pages.map((p) => (
          <li key={p.position}>
            {/* Only pages that were fetched are links. */}
            {p.finalUrl ? (
              <a href={p.finalUrl} target="_blank" rel="noopener noreferrer nofollow" className="lg-link">
                {shortUrl(p.finalUrl)}
              </a>
            ) : (
              <span className="lg-brief-email">{shortUrl(p.url)}</span>
            )}
            <span className={p.skipped ? "lg-late" : "lg-hint"}>
              {p.skipped ? `Skipped: ${p.skipped}` : p.fetchedAt ? `Read ${when(p.fetchedAt)}` : "Read"}
              {p.injection.length > 0 && ". Tried to give the AI instructions."}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
