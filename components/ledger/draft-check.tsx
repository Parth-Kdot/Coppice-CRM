"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AiDraftIcon, WarningIcon } from "./icons";
import { focusSoon } from "./focus";
import { QuillWait, Tick } from "./marks";
import { ErrorLine } from "./shared";
import type { DraftCheck } from "@/lib/claim-check";
import { checkRules, type Finding, type FindingKind, type RuleContext } from "@/lib/claim-rules";
import type { ActionResult } from "@/lib/validation";
import "./company.css";

// What the box needs from the draft panel (components/draft-panel.tsx), which spreads its own props
// into it: the workspace, the rules' context, the check action, and the draft being checked.
type Props = {
  workspaceId: string;
  rules: RuleContext;
  actions: { check: (prev: ActionResult<DraftCheck> | null, form: FormData) => Promise<ActionResult<DraftCheck>> };
  draftId: string;
  subject: string;
  body: string;
  initial: DraftCheck | null;
  n: number;
};

const KIND_LABELS: Record<FindingKind, string> = {
  number: "Number",
  link: "Link",
  history: "History",
  unsupported: "Not in the facts",
};

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

// The Claim Checker's box under a draft. The rules rerun on every keystroke; the AI's findings
// count only while the text is exactly what the AI checked, and "Check again" asks it about the
// text as edited. Rule findings and AI findings sit in their own parts, so it is always clear which
// is which.
export function ClaimCheck({ draftId, subject, body, initial, n, ...props }: Props) {
  const [check, setCheck] = useState(initial);
  const [state, checkAction, checking] = useActionState(async (prev: ActionResult<DraftCheck> | null, form: FormData) => {
    const result = await props.actions.check(prev, form);
    if (result.ok) setCheck(result.data);
    return result;
  }, null);
  // "Check again" is disabled, then gone, once the check is back: focus goes to what it found.
  const statusLine = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state && document.activeElement === document.body) focusSoon(statusLine.current);
  }, [state]);

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
        <p className="lg-hint mt-1" ref={statusLine}>
          {status}
        </p>
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
