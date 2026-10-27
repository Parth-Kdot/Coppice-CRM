"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { demoRoutes } from "@/demo/routes";
import { checkRules, composeLinks } from "@/demo/rules";
import type { CompanyDetail } from "@/demo/selectors";
import { useDemoActions, useDemoState } from "@/demo/store";
import { DRAFT_KIND_LABELS, FINDING_LABELS, type Draft, type DraftKind, type Finding } from "@/demo/types";
import { DRAFT_NOTE_MAX, NOTE_MAX } from "@/demo/validation";
import { AiDraftIcon, CopyLinkIcon, ExternalIcon, WarningIcon } from "../icons";
import { Tick } from "../marks";
import { useNotify } from "../providers";
import { ErrorLine } from "./shared";

// The draft letter: two AI drafts built only from verified facts, each with a Claim Checker that
// underlines what no verified fact supports. The app never sends email: the letter opens in the
// officer's own mail. While a draft is on its way a quill writes a wavy rule across the area, the
// one loop allowed in the app, and only while waiting.

function QuillWait({ label }: { label: string }) {
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

function DraftCard({ ws, detail, draft, index }: { ws: string; detail: CompanyDetail; draft: Draft; index: number }) {
  const actions = useDemoActions();
  const state = useDemoState();
  const notify = useNotify();
  const id = useId();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [followUpOn, setFollowUpOn] = useState(detail.defaultFollowUpOn);
  const [logNote, setLogNote] = useState(`Sent: ${draft.subject}`);
  const [logError, setLogError] = useState<string | null>(null);
  const [logged, setLogged] = useState(0);

  const live = state.drafts.find((d) => d.id === draft.id) ?? draft;
  const check = live.check;
  const fresh = check !== null && check.subject === subject && check.body === body;
  const ruleFindings = useMemo(() => checkRules(`${subject}\n${body}`, detail.ruleContext), [subject, body, detail.ruleContext]);
  const findings: Finding[] = [...ruleFindings, ...(fresh && check ? check.ai : [])];
  const quotes = findings.map((f) => f.quote);
  const links = useMemo(() => composeLinks({ to: draft.to, subject, body }), [draft.to, subject, body]);

  let headline: string;
  if (findings.length > 0) headline = `Claim check: ${findings.length} thing${findings.length === 1 ? "" : "s"} to look at`;
  else if (fresh && check && !check.error) headline = "Claim check: nothing unsupported found";
  else headline = "Claim check: the rules found nothing";

  let status: string | null = null;
  if (check?.error) status = `The AI check didn't run: ${check.error}`;
  else if (!check) status = "The AI hasn't checked this yet.";
  else if (!fresh) status = "You've edited this since the AI checked it.";

  const copy = async (what: "subject" | "body") => {
    try {
      await navigator.clipboard.writeText(what === "subject" ? subject : body);
      setCopied(`Copied the ${what}.`);
    } catch {
      setCopied(`Could not copy. Select the ${what} and copy it yourself.`);
    }
  };

  const recheck = async () => {
    setChecking(true);
    setCheckError(null);
    const result = await actions.checkDraft(ws, draft.id, { subject, body });
    setChecking(false);
    if (!result.ok) setCheckError(result.error);
  };

  const logIt = (e: FormEvent) => {
    e.preventDefault();
    const result = actions.logOutreach(ws, detail.company.id, { channel: "EMAIL", note: logNote, followUpOn, aiDraftId: draft.id });
    if (!result.ok) {
      setLogError(result.error);
      return;
    }
    setLogError(null);
    setLogged((n) => n + 1);
    notify("Logged.");
  };

  return (
    <article className="lg-letter lg-slip" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="lg-h3">
        Draft {index + 1}: {draft.angle}
      </h3>
      <p className="lg-hint mt-1">{draft.to ? `To: ${draft.to}` : "To: no email on file; add it in the mail app"}</p>

      <div className="mt-3">
        <label className="lg-label" htmlFor={`${id}-subject`}>
          Draft {index + 1} subject
        </label>
        <input id={`${id}-subject`} className="lg-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="mt-3">
        <label className="lg-label" htmlFor={`${id}-body`}>
          Draft {index + 1} body
        </label>
        <textarea id={`${id}-body`} className="lg-textarea" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="lg-hint">Read it through and fix anything before you send it.</p>
      </div>

      <div className="lg-actions mt-3">
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => copy("subject")}>
          <CopyLinkIcon size={16} />
          Copy subject
        </button>
        <button type="button" className="lg-btn lg-btn-sm" onClick={() => copy("body")}>
          <CopyLinkIcon size={16} />
          Copy body
        </button>
        <a className="lg-btn lg-btn-sm" href={links.outlook} target="_blank" rel="noopener noreferrer">
          Open in Outlook
          <ExternalIcon size={14} />
        </a>
        <a className="lg-btn lg-btn-sm" href={links.gmail} target="_blank" rel="noopener noreferrer">
          Open in Gmail
          <ExternalIcon size={14} />
        </a>
        <a className="lg-btn lg-btn-sm" href={links.mailto}>
          Open in mail app
        </a>
      </div>
      <p className="lg-hint mt-1" role="status">
        {copied}
        {!links.bodyIncluded && " This email is too long to fit in a link. Copy the body and paste it in."}
      </p>

      <div className="lg-claimcheck" aria-live="polite">
        <p className="lg-cc-head">
          <WarningIcon size={18} />
          {headline}
        </p>
        {findings.length > 0 && (
          <ul className="lg-findings">
            {findings.map((f, i) => (
              <li key={`${f.kind}-${f.quote}-${i}`}>
                <strong>{FINDING_LABELS[f.kind]}:</strong> <mark className="lg-flag">{f.quote}</mark> {f.reason}
              </li>
            ))}
          </ul>
        )}
        {status && <p className="lg-hint mt-2">{status}</p>}
        <div className="mt-2">
          <button type="button" className="lg-btn lg-btn-sm" onClick={recheck} disabled={checking || detail.ai.available === false}>
            <AiDraftIcon size={16} />
            {checking ? "Checking..." : check ? "Check again with AI" : "Check with AI"}
          </button>
        </div>
        <ErrorLine>{checkError}</ErrorLine>
        {checking && <QuillWait label="Checking..." />}
        {findings.length > 0 && (
          <div className="lg-preview" aria-label={`Draft ${index + 1} with flagged lines underlined`}>
            <p className="lg-sc lg-muted">Read-through, flagged lines underlined</p>
            <p className="lg-preview-text">
              <Flagged text={`${subject}\n\n${body}`} quotes={quotes} />
            </p>
          </div>
        )}
      </div>

      <details className="lg-more mt-3">
        <summary>I sent it: log the outreach</summary>
        <form onSubmit={logIt} className="lg-contactform">
          <div>
            <label className="lg-label" htmlFor={`${id}-follow`}>
              Follow up on
            </label>
            <input id={`${id}-follow`} type="date" className="lg-input lg-num" value={followUpOn} min={detail.today} max={detail.maxFollowUpOn} onChange={(e) => setFollowUpOn(e.target.value)} required />
          </div>
          <div>
            <label className="lg-label" htmlFor={`${id}-note`}>
              Note
            </label>
            <textarea id={`${id}-note`} className="lg-textarea" rows={2} maxLength={NOTE_MAX} value={logNote} onChange={(e) => setLogNote(e.target.value)} />
          </div>
          <div className="lg-actions">
            <button type="submit" className="lg-btn lg-btn-primary lg-btn-sm">
              Log outreach
            </button>
            {logged > 0 && !logError && (
              <span className="lg-ok" role="status">
                <Tick key={logged} size={18} />
                Logged.
              </span>
            )}
          </div>
          <ErrorLine>{logError}</ErrorLine>
        </form>
      </details>
    </article>
  );
}

export function DraftPanel({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const state = useDemoState();
  const id = useId();
  const defaultKind: DraftKind = detail.outreach.length > 0 ? "FOLLOW_UP" : "FIRST_TOUCH";
  const [kind, setKind] = useState<DraftKind>(defaultKind);
  const [contactId, setContactId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const drafting = pending || state.busy.drafting.includes(detail.company.id);

  if (!detail.ai.available) {
    return (
      <section id="draft-email" className="lg-draftpanel" aria-labelledby={`${id}-h`}>
        <h2 id={`${id}-h`} className="lg-h2">
          Draft letter
        </h2>
        <p className="mt-2">AI drafting is off for this workspace. An owner can turn it on in Settings.</p>
        <p className="mt-1">
          <Link href={demoRoutes.settings(ws)} className="lg-link">
            Open Settings
          </Link>
        </p>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await actions.draftEmail(ws, detail.company.id, { kind, contactId: contactId || null, note });
    setPending(false);
    if (!result.ok) setError(result.error);
  };

  const n = detail.verifiedFactCount;
  return (
    <section id="draft-email" className="lg-draftpanel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="lg-h2">
        Draft letter
      </h2>
      <form onSubmit={submit} className="lg-draftform">
        <fieldset>
          <legend className="lg-label">Kind</legend>
          <div className="lg-radios">
            {(["FIRST_TOUCH", "FOLLOW_UP"] as const).map((k) => (
              <label key={k} className="lg-radio">
                <input type="radio" className="lg-check" name={`${id}-kind`} checked={kind === k} onChange={() => setKind(k)} />
                {DRAFT_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="lg-label" htmlFor={`${id}-to`}>
            Send to
          </label>
          <select id={`${id}-to`} className="lg-select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">No contact yet (greets &quot;Hi there&quot;)</option>
            {detail.draftContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.title ? `, ${c.title}` : ""}
                {c.email ? "" : " (no email)"}
              </option>
            ))}
          </select>
        </div>
        <div className="lg-draftnote">
          <label className="lg-label" htmlFor={`${id}-note`}>
            Note for the AI
          </label>
          <textarea
            id={`${id}-note`}
            className="lg-textarea"
            rows={2}
            maxLength={DRAFT_NOTE_MAX}
            placeholder="Optional: what to emphasize. No names or emails; this goes to Google's AI."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="lg-draftgo">
          <p className="lg-hint">
            Drafting claims this company for you. The AI only uses facts verified on the{" "}
            <Link href={demoRoutes.facts(ws)} className="lg-link">
              fact sheet
            </Link>{" "}
            ({n}){n === 0 ? " and there are none yet, so drafts won't say anything specific about your org." : "."}
          </p>
          <button type="submit" className="lg-btn lg-btn-primary" disabled={drafting}>
            <AiDraftIcon size={18} />
            {drafting ? "Drafting... (up to a minute)" : "Draft two emails"}
          </button>
          <ErrorLine>{error}</ErrorLine>
        </div>
      </form>

      {drafting && <QuillWait label="Drafting... (up to a minute)" />}

      {detail.drafts.length > 0 && (
        <div className="lg-letters">
          {detail.drafts.map((d, i) => (
            <DraftCard key={d.id} ws={ws} detail={detail} draft={d} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
