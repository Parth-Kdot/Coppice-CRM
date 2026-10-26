"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { DraftCheck } from "@/lib/claim-check";
import { checkRules, type Finding, type RuleContext } from "@/lib/claim-rules";
import { composeLinks } from "@/lib/compose-links";
import { addDays } from "@/lib/dates";
import type { DraftView } from "@/lib/drafts";
import { DRAFT_NOTE_MAX, type ActionResult } from "@/lib/validation";

type Contact = { id: string; name: string; title: string | null; email: string | null };

type Props = {
  workspaceId: string;
  companyId: string;
  contacts: Contact[];
  // Follow-up is preselected once any outreach is logged.
  hasOutreach: boolean;
  factCount: number;
  // Your latest drafts for this company, so they survive a reload.
  initialDrafts: DraftView[];
  // Today in West Lafayette, from the database, for the follow-up date box.
  today: string;
  // What the Claim Checker's rules accept: numbers from verified facts and the company's website.
  rules: RuleContext;
  actions: {
    draft: (prev: ActionResult<DraftView[]> | null, form: FormData) => Promise<ActionResult<DraftView[]>>;
    check: (prev: ActionResult<DraftCheck> | null, form: FormData) => Promise<ActionResult<DraftCheck>>;
    logOutreach: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  };
};

// "Draft an email": asks the AI for two variants, then shows each one editable, with Copy and
// links that open it in Gmail, Outlook or the default mail app. Nothing is sent from here.
export function DraftPanel(props: Props) {
  const [state, draftAction, pending] = useActionState(props.actions.draft, null);
  const drafts = state?.ok ? state.data : props.initialDrafts;

  return (
    <div className="flex flex-col gap-4">
      <form action={draftAction} className="flex flex-col gap-2 rounded border p-3">
        <input type="hidden" name="workspaceId" value={props.workspaceId} />
        <input type="hidden" name="companyId" value={props.companyId} />
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Kind of email</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="kind" value="FIRST_TOUCH" defaultChecked={!props.hasOutreach} aria-label="First email" />
            First email
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="kind" value="FOLLOW_UP" defaultChecked={props.hasOutreach} aria-label="Follow-up" />
            Follow-up
          </label>
        </fieldset>
        <select name="contactId" defaultValue={props.contacts[0]?.id ?? ""} aria-label="Send to" className="rounded border px-2 py-1">
          <option value="">No contact yet (greets &quot;Hi there&quot;)</option>
          {props.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.title && `, ${c.title}`}
              {!c.email && " (no email)"}
            </option>
          ))}
        </select>
        <textarea
          name="note"
          rows={2}
          maxLength={DRAFT_NOTE_MAX}
          placeholder="Optional: what to emphasize. No names or emails; this goes to Google's AI."
          aria-label="Note for the AI"
          className="rounded border px-2 py-1"
        />
        <p className="text-sm text-zinc-500">
          Drafting claims this company for you. The AI only uses facts verified on the fact sheet
          {props.factCount === 0 ? ", and there are none yet, so drafts won't say anything specific about your org." : ` (${props.factCount}).`}
        </p>
        <button type="submit" disabled={pending} className="self-start rounded border px-3 py-1 disabled:opacity-50">
          {pending ? "Drafting... (up to a minute)" : "Draft two emails"}
        </button>
        {state && !state.ok && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
      </form>

      {drafts.map((draft, i) => (
        <DraftCard key={draft.id} draft={draft} label={`Draft ${i + 1}`} {...props} />
      ))}
    </div>
  );
}

function DraftCard({ draft, label, ...props }: Props & { draft: DraftView; label: string }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState("");
  const links = composeLinks({ to: draft.to, subject, body });

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied("");
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded border p-3">
      <h3 className="font-semibold">
        {label}: {draft.angle}
      </h3>
      <p className="text-sm text-zinc-500">To: {draft.to || "no email on file; add it in the mail app"}</p>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={`${label} subject`} className="rounded border px-2 py-1" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label={`${label} body`} className="rounded border px-2 py-1" />
      <p className="text-sm text-zinc-500">Read it through and fix anything before you send it.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => copy("subject", subject)} className="rounded border px-3 py-1">
          Copy subject
        </button>
        <button type="button" onClick={() => copy("body", body)} className="rounded border px-3 py-1">
          Copy body
        </button>
        <a href={links.outlook} target="_blank" rel="noopener noreferrer" className="rounded border px-3 py-1">
          Open in Outlook
        </a>
        <a href={links.gmail} target="_blank" rel="noopener noreferrer" className="rounded border px-3 py-1">
          Open in Gmail
        </a>
        <a href={links.mailto} className="rounded border px-3 py-1">
          Open in mail app
        </a>
        {copied && <span className="text-green-700">Copied the {copied}.</span>}
      </div>
      <ClaimCheck draftId={draft.id} subject={subject} body={body} initial={draft.check} {...props} />
      {!links.bodyIncluded && <p className="text-sm text-amber-700">This email is too long to fit in a link. Copy the body and paste it in.</p>}
      <details>
        <summary className="cursor-pointer text-sm">I sent it: log the outreach</summary>
        <div className="pt-2">
          <ActionForm action={props.actions.logOutreach} submitLabel="Log outreach" successMessage="Logged.">
            <input type="hidden" name="workspaceId" value={props.workspaceId} />
            <input type="hidden" name="companyId" value={props.companyId} />
            <input type="hidden" name="aiDraftId" value={draft.id} />
            <input type="hidden" name="channel" value="EMAIL" />
            <label className="flex items-center gap-2">
              <span className="text-sm">Follow up on</span>
              <input
                name="followUpOn"
                type="date"
                required
                min={props.today}
                max={addDays(props.today, 365)}
                defaultValue={addDays(props.today, 7)}
                className="rounded border px-2 py-1"
              />
            </label>
            <input name="note" defaultValue={`Sent: ${subject}`} aria-label="Note" className="w-full rounded border px-2 py-1" />
          </ActionForm>
        </div>
      </details>
    </section>
  );
}

const KIND_LABELS: Record<Finding["kind"], string> = {
  number: "Number",
  link: "Link",
  history: "History",
  unsupported: "Not in the facts",
};

// The Claim Checker's box under a draft. The rules rerun on every keystroke; the AI's findings
// count only while the text is exactly what the AI checked, and "Check again" asks it about the
// text as edited.
function ClaimCheck({ draftId, subject, body, initial, ...props }: Props & { draftId: string; subject: string; body: string; initial: DraftCheck | null }) {
  const [check, setCheck] = useState(initial);
  const [state, checkAction, checking] = useActionState(async (prev: ActionResult<DraftCheck> | null, form: FormData) => {
    const result = await props.actions.check(prev, form);
    if (result.ok) setCheck(result.data);
    return result;
  }, null);

  const fresh = check !== null && check.subject === subject && check.body === body;
  const findings = [...checkRules(`${subject}\n${body}`, props.rules), ...(fresh ? check.ai : [])];
  let summary = findings.length === 1 ? "1 thing to look at" : `${findings.length} things to look at`;
  if (findings.length === 0) summary = fresh && !check.error ? "nothing unsupported found" : "the rules found nothing";

  return (
    <div className="flex flex-col gap-1 rounded border p-2 text-sm" aria-live="polite">
      <p className="font-semibold">Claim check: {summary}</p>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {findings.map((f) => (
            <li key={`${f.kind}:${f.quote}`}>
              <span className="text-zinc-500">{KIND_LABELS[f.kind]}:</span> <mark>{f.quote}</mark> {f.reason}
            </li>
          ))}
        </ul>
      )}
      {fresh && check.error && <p className="text-amber-700">The AI check didn&apos;t run: {check.error}</p>}
      {!fresh && (
        <form action={checkAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="workspaceId" value={props.workspaceId} />
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="body" value={body} />
          <span className="text-zinc-500">{check ? "You've edited this since the AI checked it." : "The AI hasn't checked this yet."}</span>
          <button type="submit" disabled={checking} className="rounded border px-3 py-1 disabled:opacity-50">
            {checking ? "Checking..." : "Check again with AI"}
          </button>
        </form>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
