"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { askArchive } from "@/app/(app)/[workspaceId]/capsule/actions";
import { ARCHIVE_QUESTION_MAX } from "@/lib/capsule/limits";
import type { ArchiveAnswer } from "@/lib/capsule";
import { formatYmd } from "@/lib/dates";
import { ErrorLine } from "../shared";
import { useRun } from "./use-run";

// Ask the Archive: a question box over what past boards wrote down. Retrieval is by code, one model
// call reads the best matching notes, and code checks every sentence against them, so each sentence
// carries numbered footnotes that show the quote, the company, the date, and link to the company
// page. Nothing is stored. The answer sits under the box; "no match" and "unclear" are plain lines.

export function ArchiveAsk({ workspaceId, perDay }: { workspaceId: string; perDay: number }) {
  const id = useId();
  const { run, pending, error } = useRun<ArchiveAnswer>(askArchive);
  const [answer, setAnswer] = useState<{ question: string; data: ArchiveAnswer } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  const submit = async () => {
    const question = text.trim();
    if (question.length < 3 || pending) return;
    setAnswer(null);
    const result = await run({ workspaceId, question });
    if (result?.ok) setAnswer({ question, data: result.data });
  };

  return (
    <div className="lg-cap-ask" data-tour="capsule-ask">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="lg-label" htmlFor={`${id}-q`}>
          Ask what past boards wrote
        </label>
        <textarea
          id={`${id}-q`}
          ref={field}
          className="lg-textarea lg-cap-q"
          rows={2}
          maxLength={ARCHIVE_QUESTION_MAX}
          value={text}
          placeholder="For example: when do companies answer about the career fair?"
          aria-describedby={`${id}-hint`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="lg-cap-askrow">
          <button type="submit" className="lg-btn" disabled={pending || text.trim().length < 3}>
            {pending ? "Looking..." : "Ask"}
          </button>
          <p id={`${id}-hint`} className="lg-hint">
            Answers come only from your companies&apos; notes, with the quote that backs each one. Up to {perDay} questions a day each.
          </p>
        </div>
      </form>
      <div role="status" aria-live="polite" className="lg-cap-answer-slot">
        {pending && <p className="lg-hint">Reading the best matching notes...</p>}
      </div>
      <ErrorLine>{error}</ErrorLine>
      {answer && <Answer workspaceId={workspaceId} question={answer.question} data={answer.data} />}
    </div>
  );
}

function Answer({ workspaceId, question, data }: { workspaceId: string; question: string; data: ArchiveAnswer }) {
  const id = useId();
  if (data.status === "none") {
    return (
      <div className="lg-cap-answer" data-status="none">
        <p className="lg-cap-answerq">{question}</p>
        <p>{data.message}</p>
      </div>
    );
  }
  return (
    <div className="lg-cap-answer" data-status="answered">
      <p className="lg-cap-answerq">{question}</p>
      <p className="lg-cap-sentences">
        {data.sentences.map((s, i) => (
          <span key={i} className="lg-cap-sentence">
            {s.text}
            {s.footnotes.map((n) => (
              <sup key={n}>
                <a className="lg-link lg-cap-fnref" href={`#${id}-fn${n}`} aria-label={`Footnote ${n}`}>
                  {n}
                </a>
              </sup>
            ))}{" "}
          </span>
        ))}
      </p>
      <ol className="lg-cap-footnotes" aria-label="Where this came from">
        {data.footnotes.map((f) => (
          <li key={f.n} id={`${id}-fn${f.n}`} value={f.n}>
            <span className="lg-cap-fnnum lg-num" aria-hidden="true">
              {f.n}
            </span>
            <p>
              {f.quote ? <q className="lg-quote">{f.quote}</q> : <span className="lg-hint">Also cited, no quote of its own.</span>}
              <span className="lg-hint">
                {" "}
                {f.kind === "company" ? "Company notes" : "Outreach note"}, {formatYmd(f.date, { month: "short", day: "numeric", year: "numeric" })}.{" "}
              </span>
              <Link className="lg-link" href={`/${workspaceId}/companies/${f.companyId}`}>
                {f.companyName}
              </Link>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
