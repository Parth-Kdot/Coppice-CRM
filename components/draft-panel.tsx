"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState, type ReactNode } from "react";
import "@/components/ledger/zod-jitless";
import { AiDraftIcon, CheckIcon, CopyLinkIcon, ExternalIcon, WarningIcon } from "@/components/ledger/icons";
import { ChipGroup, type ChipOption } from "@/components/ledger/chips";
import { LogOutreachForm } from "@/components/ledger/log-form";
import { Tick } from "@/components/ledger/marks";
import { ErrorLine } from "@/components/ledger/shared";
import type { DraftKind } from "@/generated/prisma/enums";
import type { DraftCheck } from "@/lib/claim-check";
import { checkRules, type Finding, type FindingKind, type RuleContext } from "@/lib/claim-rules";
import { composeLinks } from "@/lib/compose-links";
import type { DraftView } from "@/lib/drafts";
import type { TemplateOption } from "@/lib/templates";
import { DRAFT_NOTE_MAX, type ActionResult } from "@/lib/validation";
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

const KIND_LABELS: Record<FindingKind, string> = {
  number: "Number",
  link: "Link",
  history: "History",
  unsupported: "Not in the facts",
};

// While a draft is on its way a quill writes a wavy rule across the area: the one loop in the app,
// and only while waiting.
export function QuillWait({ label }: { label: string }) {
  return (
    <div className="lg-quill-wait" role="status">
      <svg viewBox="0 0 240 28" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
        <path pathLength={1} d="M2 15 C14 3 26 3 38 15 S62 27 74 15 S98 3 110 15 S134 27 146 15 S170 3 182 15 S206 27 218 15 S232 6 238 12" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

// The text with each flagged quote underlined, so the officer sees what to check in context.
function Flagged({ text, quotes }: { text: string; quotes: string[] }) {
  const spans: { start: number; end: number }[] = [];
  for (const q of quotes) {
    if (!q) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(q, from);
      if (at < 0) break;
      spans.push({ start: at, end: at + q.length });
      from = at + q.length;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((s, i) => {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(
      <mark key={i} className="lg-flag">
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="lg-findings">
      {findings.map((f) => (
        <li key={`${f.kind}:${f.quote}`}>
          <span className="lg-fkind">{KIND_LABELS[f.kind]}</span>
          <span>
            <mark className="lg-flag">{f.quote}</mark>
            <span className="lg-fwhy">{f.reason}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// "Draft an email": asks the AI for two drafts, then shows each one editable, with Copy and links
// that open it in Gmail, Outlook or the default mail app. Nothing is sent from here.
export function DraftPanel(props: Props) {
  const id = useId();
  const [state, draftAction, pending] = useActionState(props.actions.draft, null);
  const drafts = state?.ok ? state.data : props.initialDrafts;
  const [kind, setKind] = useState<DraftKind>(props.hasOutreach ? "FOLLOW_UP" : "FIRST_TOUCH");
  const limitReached = props.usage.used >= props.usage.limit;

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
          Two drafts built only from verified facts. Nothing is sent from here: each one opens in your own mail. {props.usage.used} of {props.usage.limit} AI calls used in the last 30 days. Drafting uses two AI calls: one to write both drafts, one to check them.
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
              <select id={`${id}-tpl`} name="templateId" defaultValue="" className="lg-select">
                <option value="">No template, just the facts</option>
                {props.templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    Template: {t.name}
                  </option>
                ))}
              </select>
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
          <button type="submit" disabled={pending || limitReached} className="lg-btn lg-btn-primary">
            <AiDraftIcon size={18} />
            {pending ? "Drafting... (up to a minute)" : "Draft two emails"}
          </button>
          <p className="lg-hint">
            Drafting claims this company for you. The AI only uses facts verified on the{" "}
            <Link href={`/${props.workspaceId}/facts`} className="lg-link">
              fact sheet
            </Link>{" "}
            ({props.factCount})
            {props.factCount === 0 ? ", and there are none yet, so drafts won't say anything specific about your org." : "."}
          </p>
        </div>
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
        {state && !state.ok && (
          <div className="lg-draftlimit">
            <ErrorLine>{state.error}</ErrorLine>
          </div>
        )}
      </form>

      {pending && <QuillWait label="Writing two drafts. This takes up to a minute." />}

      {drafts.length > 0 && (
        <div className="lg-letters">
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

// The Claim Checker's box under a draft. The rules rerun on every keystroke; the AI's findings
// count only while the text is exactly what the AI checked, and "Check again" asks it about the
// text as edited. Rule findings and AI findings sit in their own parts, so it is always clear which
// is which.
function ClaimCheck({ draftId, subject, body, initial, n, ...props }: Props & { draftId: string; subject: string; body: string; initial: DraftCheck | null; n: number }) {
  const [check, setCheck] = useState(initial);
  const [state, checkAction, checking] = useActionState(async (prev: ActionResult<DraftCheck> | null, form: FormData) => {
    const result = await props.actions.check(prev, form);
    if (result.ok) setCheck(result.data);
    return result;
  }, null);

  const fresh = check !== null && check.subject === subject && check.body === body;
  const ruleFindings = useMemo(() => checkRules(`${subject}\n${body}`, props.rules), [subject, body, props.rules]);
  const aiFindings = fresh && check ? check.ai : [];
  const all = [...ruleFindings, ...aiFindings];
  const aiRan = fresh && check !== null && !check.error;
  const needsCheck = !fresh || (check !== null && check.error !== null);

  let summary: string;
  if (all.length > 0) summary = all.length === 1 ? "1 thing to look at" : `${all.length} things to look at`;
  else summary = aiRan ? "nothing unsupported found" : "the rules found nothing";
  const tone = all.length > 0 ? "flag" : aiRan ? "clean" : "idle";

  let status: string;
  if (checking) status = "The AI is reading this draft against your verified facts.";
  else if (!check) status = "The AI hasn't checked this yet.";
  else if (!fresh) status = "You've edited this since the AI checked it. Its earlier findings are hidden.";
  else if (check.error) status = `The AI check didn't run: ${check.error}`;
  else status = "The AI checked this exact text.";

  const button = check ? "Check again with AI" : "Check with AI";

  return (
    <div className="lg-claimcheck" aria-live="polite">
      <p className="lg-cc-head" data-tone={tone}>
        {tone === "clean" ? (
          <Tick size={18} />
        ) : tone === "flag" ? (
          <WarningIcon size={18} />
        ) : (
          <svg width={18} height={18} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
            <circle cx="9" cy="9" r="5.5" />
          </svg>
        )}
        <span className="lg-cc-title">Claim check</span>
        <span className="lg-cc-sum">{summary}</span>
      </p>

      <div className="lg-cc-part">
        <p className="lg-cc-label">
          <strong>Rules</strong>
          <span className="lg-hint">Run as you type</span>
        </p>
        {ruleFindings.length > 0 ? <FindingList findings={ruleFindings} /> : <p className="lg-hint">No unverified number, link or past-relationship claim found.</p>}
      </div>

      <div className="lg-cc-part">
        <p className="lg-cc-label">
          <strong>AI check</strong>
          <span className="lg-hint">Reads against the fact sheet</span>
        </p>
        {aiFindings.length > 0 && <FindingList findings={aiFindings} />}
        {aiRan && aiFindings.length === 0 && <p className="lg-hint">The AI found no statement the facts don&apos;t support.</p>}
        <p className="lg-hint mt-1">{status}</p>
        <p className="lg-hint">Checking uses one AI call.</p>
        {checking && <QuillWait label="Checking..." />}
        {needsCheck && (
          <form action={checkAction} className="lg-cc-actions">
            <input type="hidden" name="workspaceId" value={props.workspaceId} />
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="body" value={body} />
            <button type="submit" disabled={checking} className="lg-btn lg-btn-sm" aria-label={`${button}, draft ${n}`}>
              <AiDraftIcon size={16} />
              {checking ? "Checking..." : button}
            </button>
          </form>
        )}
        {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
      </div>

      {all.length > 0 && (
        <div className="lg-preview" role="group" aria-label={`Draft ${n} with flagged lines underlined`}>
          <p className="lg-hint">Read-through, flagged lines underlined</p>
          <p className="lg-preview-text">
            <Flagged text={`${subject}\n\n${body}`} quotes={all.map((f) => f.quote)} />
          </p>
        </div>
      )}
    </div>
  );
}
