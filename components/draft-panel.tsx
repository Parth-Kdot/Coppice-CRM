"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { AiDraftIcon, CheckIcon, CopyLinkIcon, ExternalIcon } from "@/components/ledger/icons";
import { ChipGroup, type ChipOption } from "@/components/ledger/chips";
import { ClaimCheck } from "@/components/ledger/draft-check";
import { ExperimentLine } from "@/components/ledger/lab/experiment-line";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { focusSoon } from "@/components/ledger/focus";
import { QuillWait } from "@/components/ledger/marks";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import type { DraftKind } from "@/generated/prisma/enums";
import type { DraftCheck } from "@/lib/claim-check";
import type { RuleContext } from "@/lib/claim-rules";
import { composeLinks } from "@/lib/compose-links";
import type { DraftView } from "@/lib/drafts";
import type { TemplateOption } from "@/lib/templates";
import { DRAFT_NOTE_MAX } from "@/lib/limits";
import type { ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";

type Contact = { id: string; name: string; title: string | null; email: string | null };

type Props = {
  workspaceId: string;
  companyId: string;
  contacts: Contact[];
  // Follow-up is preselected once any outreach is logged.
  hasOutreach: boolean;
  factCount: number;
  // The workspace's AI calls in the last 30 days and its limit, from aiUsage().
  usage: { used: number; limit: number };
  // Your drafts in the last 24 hours and the daily limit (lib/ai/run.ts draftsToday).
  daily: { used: number; limit: number };
  // Your latest drafts for this company, so they survive a reload.
  initialDrafts: DraftView[];
  // Today in West Lafayette, from the database, for the follow-up date box.
  today: string;
  // What the Claim Checker's rules accept: numbers from verified facts and the company's website.
  rules: RuleContext;
  // Templates a draft can be based on (not archived). Their text goes to the AI, masked like a note.
  templates?: TemplateOption[];
  actions: {
    draft: (prev: ActionResult<DraftView[]> | null, form: FormData) => Promise<ActionResult<DraftView[]>>;
    check: (prev: ActionResult<DraftCheck> | null, form: FormData) => Promise<ActionResult<DraftCheck>>;
    logOutreach: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  };
};

// "Draft an email": asks the AI for two drafts, then shows each one editable, with Copy and links
// that open it in Gmail, Outlook or the default mail app. Nothing is sent from here.
export function DraftPanel(props: Props) {
  const id = useId();
  const notify = useNotify();
  // The last Draft click that failed, with the note typed for it. If that click lost the claim to
  // someone else, the page refresh that follows removes this panel, and with it the message and
  // the note; so on the way out they are written as a margin note instead, and focus goes to the
  // page's heading rather than falling to the page itself.
  // Only right after the click (the refresh comes within seconds), not when leaving the page later.
  const lastFailure = useRef<{ error: string; note: string; at: number } | null>(null);
  const [state, draftAction, pending] = useActionState(async (prev: ActionResult<DraftView[]> | null, form: FormData) => {
    const result = await props.actions.draft(prev, form);
    lastFailure.current = result.ok ? null : { error: result.error, note: String(form.get("note") ?? "").trim(), at: Date.now() };
    return result;
  }, null);
  useEffect(
    () => () => {
      const failed = lastFailure.current;
      if (!failed || Date.now() - failed.at > 15_000) return;
      notify(failed.note ? `${failed.error} Your note was: "${failed.note}"` : failed.error, "error");
      focusSoon("h1");
    },
    [notify],
  );
  // The Draft button is disabled while drafting, so the browser drops focus to the page. When the
  // answer comes back, focus goes to the first draft, or back to the button after a failure.
  const letters = useRef<HTMLDivElement>(null);
  const draftButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!state || document.activeElement !== document.body) return;
    focusSoon(state.ok ? () => letters.current?.querySelector<HTMLElement>("h3") ?? null : draftButton.current);
  }, [state]);
  const drafts = state?.ok ? state.data : props.initialDrafts;
  const [kind, setKind] = useState<DraftKind>(props.hasOutreach ? "FOLLOW_UP" : "FIRST_TOUCH");
  // The template picked in "Base it on" (nothing at first), so the running experiment's "Use it" can pick one.
  const [baseOn, setBaseOn] = useState("");
  const limitReached = props.usage.used >= props.usage.limit;
  // The server refuses the 41st draft of the day too; this says so before the click.
  const dailyReached = props.daily.used >= props.daily.limit;

  const kindOptions: ChipOption<DraftKind>[] = [
    { value: "FIRST_TOUCH", label: "First email" },
    { value: "FOLLOW_UP", label: "Follow-up" },
  ];

  return (
    <section id="draft-email" className="lg-draftpanel" aria-labelledby={`${id}-h`}>
      <div className="lg-draft-head">
        <h2 id={`${id}-h`} className="lg-h2">
          Draft an email
        </h2>
        <p className="lg-hint">
          Two drafts built only from verified facts, opened in your own mail. Uses 2 of your workspace&apos;s AI calls ({props.usage.used} of{" "}
          {props.usage.limit} used this month).
        </p>
      </div>

      <form action={draftAction} className="lg-draftform">
        <input type="hidden" name="workspaceId" value={props.workspaceId} />
        <input type="hidden" name="companyId" value={props.companyId} />
        <div className="lg-draftside">
          <ChipGroup legend="Kind of email" name="kind" value={kind} options={kindOptions} onChange={setKind} />
          <div>
            <label className="lg-label" htmlFor={`${id}-to`}>
              Send to
            </label>
            <select id={`${id}-to`} name="contactId" defaultValue={props.contacts[0]?.id ?? ""} className="lg-select">
              <option value="">No contact yet (greets &quot;Hi there&quot;)</option>
              {props.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.title && `, ${c.title}`}
                  {!c.email && " (no email)"}
                </option>
              ))}
            </select>
          </div>
          {(props.templates?.length ?? 0) > 0 && (
            <div>
              <label className="lg-label" htmlFor={`${id}-tpl`}>
                Base it on
              </label>
              <select id={`${id}-tpl`} name="templateId" value={baseOn} onChange={(e) => setBaseOn(e.target.value)} className="lg-select">
                <option value="">No template, just the facts</option>
                {props.templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    Template: {t.name}
                  </option>
                ))}
              </select>
              <ExperimentLine templates={props.templates ?? []} selectedId={baseOn} onUse={setBaseOn} />
            </div>
          )}
        </div>
        <div className="lg-draftnote">
          <label className="lg-label" htmlFor={`${id}-note`}>
            Note for the AI
          </label>
          <textarea
            id={`${id}-note`}
            name="note"
            className="lg-textarea"
            rows={3}
            maxLength={DRAFT_NOTE_MAX}
            placeholder="Optional: what to emphasize. No names or emails; this goes to Google's AI."
          />
        </div>
        <div className="lg-draftgo">
          <button ref={draftButton} type="submit" disabled={pending || limitReached || dailyReached} className="lg-btn lg-btn-primary">
            <AiDraftIcon size={18} />
            {pending ? "Drafting... (usually under a minute)" : "Draft two emails"}
          </button>
          <p className="lg-hint lg-draft-daily">
            Your drafts today: {props.daily.used} of {props.daily.limit}
          </p>
          <p className="lg-hint">
            Drafting claims this company for you. The AI only uses facts verified on the{" "}
            <Link href={`/${props.workspaceId}/facts`} className="lg-link">
              fact sheet
            </Link>{" "}
            ({props.factCount})
            {props.factCount === 0 ? ", and there are none yet, so drafts won't say anything specific about your org." : "."}
          </p>
        </div>
        {dailyReached && !limitReached && (
          <div className="lg-draftlimit">
            <ErrorLine>You&apos;ve made {props.daily.limit} drafts in the last 24 hours. Try again tomorrow.</ErrorLine>
          </div>
        )}
        {limitReached && (
          <div className="lg-draftlimit">
            <ErrorLine>
              This workspace has used its {props.usage.limit} AI calls for the last 30 days. An owner can raise the limit in{" "}
              <Link href={`/${props.workspaceId}/settings`} className="lg-link">
                Settings
              </Link>
              .
            </ErrorLine>
          </div>
        )}
        {/* A refusal for the limit a line above already states isn't said twice. */}
        {state && !state.ok && !(limitReached && /AI calls for the last/.test(state.error)) && !(dailyReached && /drafts in the last 24 hours/.test(state.error)) && (
          <div className="lg-draftlimit">
            <ErrorLine>{state.error}</ErrorLine>
          </div>
        )}
      </form>

      {pending && <QuillWait label="Writing two drafts. This usually takes under a minute." />}

      {drafts.length > 0 && (
        <div className="lg-letters" ref={letters}>
          {drafts.map((draft, i) => (
            <DraftCard key={draft.id} draft={draft} index={i} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

type CardProps = Props & { draft: DraftView; index: number };

function DraftCard({ draft, index, ...props }: CardProps) {
  const id = useId();
  const n = index + 1;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState("");
  const [sentOpen, setSentOpen] = useState(false);
  const links = composeLinks({ to: draft.to, subject, body });

  const copy = async (what: "subject" | "body", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied the ${what}.`);
    } catch {
      setCopied(`Could not copy. Select the ${what} and copy it yourself.`);
    }
  };

  return (
    <article className="lg-letter" aria-labelledby={`${id}-title`}>
      <header className="lg-letter-head">
        <h3 id={`${id}-title`} className="lg-h3">
          {draft.angle}
        </h3>
        <p className="lg-letter-no lg-tag">Draft {n}</p>
      </header>
      <p className="lg-hint lg-letter-to">{draft.to ? `To: ${draft.to}` : "To: no email on file; add it in the mail app"}</p>

      <div>
        <label className="lg-label" htmlFor={`${id}-subject`}>
          Draft {n} subject
        </label>
        <input id={`${id}-subject`} className="lg-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="mt-3">
        <label className="lg-label" htmlFor={`${id}-body`}>
          Draft {n} body
        </label>
        <textarea id={`${id}-body`} className="lg-textarea lg-letter-bodybox" rows={13} value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="lg-hint mt-1">Read it through and fix anything before you send it.</p>
      </div>

      <div className="lg-letter-send">
        <div className="lg-send-row">
          <span className="lg-send-label">Open in</span>
          <a className="lg-btn lg-btn-sm" href={links.gmail} target="_blank" rel="noopener noreferrer">
            Gmail
            <ExternalIcon size={14} />
          </a>
          <a className="lg-btn lg-btn-sm" href={links.outlook} target="_blank" rel="noopener noreferrer">
            Outlook
            <ExternalIcon size={14} />
          </a>
          <a className="lg-btn lg-btn-sm" href={links.mailto}>
            Mail app
          </a>
        </div>
        <div className="lg-send-row">
          <span className="lg-send-label">Copy</span>
          <button type="button" className="lg-btn lg-btn-sm" onClick={() => copy("subject", subject)}>
            <CopyLinkIcon size={16} />
            Subject
          </button>
          <button type="button" className="lg-btn lg-btn-sm" onClick={() => copy("body", body)}>
            <CopyLinkIcon size={16} />
            Body
          </button>
        </div>
        <p className="lg-hint lg-send-status" role="status">
          {copied}
          {!links.bodyIncluded && " This email is too long to fit in a link. Copy the body and paste it in."}
        </p>
      </div>

      <ClaimCheck draftId={draft.id} subject={subject} body={body} initial={draft.check} n={n} {...props} />

      <details className="lg-sent" onToggle={(e) => setSentOpen(e.currentTarget.open)}>
        <summary>
          <CheckIcon size={16} />I sent it
        </summary>
        <div className="lg-sentlog">
          <p className="lg-hint mb-3">Logs the email on this company, renews your claim and sets when it comes back to the queue.</p>
          {sentOpen && (
            <LogOutreachForm
              workspaceId={props.workspaceId}
              companyId={props.companyId}
              action={props.actions.logOutreach}
              today={props.today}
              aiDraftId={draft.id}
              initialNote={`Sent: ${subject}`}
              compact
              label={`Log outreach for draft ${n}`}
            />
          )}
        </div>
      </details>
    </article>
  );
}
