"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Disclosure } from "@/components/ledger/disclosure";
import { FactChip } from "@/components/ledger/lab/explain-panel";
import type { WeeklyBriefView } from "@/lib/weekly-brief";
import "./weekly-brief.css";

// The Monday brief at the top of the queue home. The page renders it at once from what is stored
// (or the code-written lines when nothing is yet). Only when this week's brief is missing does the
// browser ask the route to write it, once, after the page is on screen, so Claim and Log outreach
// never wait behind the AI. It never polls: a brief someone else is writing shows on the next visit.
// Every number in the narrated text is a chip drawn from the stored facts, as on the stats page.

type Props = { workspaceId: string; initial: WeeklyBriefView };
type Asked = "no" | "done" | "failed";

export function WeeklyBrief({ workspaceId, initial }: Props) {
  const [view, setView] = useState(initial);
  const [asked, setAsked] = useState<Asked>("no");
  const started = useRef(false);
  // The chip the person last pressed, spelled out under the text.
  const [open, setOpen] = useState<{ p: number; i: number } | null>(null);

  useEffect(() => {
    if (initial.state !== "missing" || started.current) return;
    started.current = true;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/weekly-brief`, {
      method: "POST",
      redirect: "manual",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = response.ok ? ((await response.json()) as { brief: WeeklyBriefView | null }) : null;
        if (body?.brief) {
          setView(body.brief);
          setAsked("done");
        } else setAsked("failed");
      })
      .catch(() => setAsked("failed"));
  }, [initial.state, workspaceId]);

  const narrated = view.paragraphs.length > 0;
  const writing = (view.state === "missing" && asked === "no") || view.state === "writing";
  const shownFact = open ? view.paragraphs[open.p]?.[open.i] : null;
  const lines = (
    <ul className="lg-wbrief-lines">
      {view.lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );

  return (
    <Disclosure summary="Monday brief" count={view.weekLabel} defaultOpen={view.openByDefault} id="monday-brief" className="lg-wbrief">
      <div className="lg-wbrief-body" aria-busy={writing || undefined}>
        {narrated ? (
          <>
            <div className="lg-explain-text lg-wbrief-text" aria-label="This week in plain words">
              {view.paragraphs.map((paragraph, p) => (
                <p key={p}>
                  {paragraph.map((segment, i) =>
                    segment.kind === "words" ? (
                      <span key={i}>{segment.text}</span>
                    ) : (
                      <FactChip
                        key={i}
                        segment={segment}
                        pressed={open?.p === p && open.i === i}
                        onPress={() => setOpen(open?.p === p && open.i === i ? null : { p, i })}
                      />
                    ),
                  )}
                </p>
              ))}
            </div>
            {shownFact?.kind === "fact" && (
              <p className="lg-hint lg-wbrief-what" role="status">
                <strong>{shownFact.text}</strong> is {shownFact.what}.
              </p>
            )}
            <p className="lg-hint lg-wbrief-meta">
              {view.writtenAt && <>Written {view.writtenAt}. </>}
              Every number is counted by Coppice.
              {view.dropped > 0 && <> {view.dropped === 1 ? "1 sentence was left out by the checks." : `${view.dropped} sentences were left out by the checks.`}</>}
            </p>
            <Disclosure summary="The numbers" variant="inline" className="lg-wbrief-numbers">
              {lines}
            </Disclosure>
          </>
        ) : (
          <>
            {lines}
            <p className="lg-hint lg-wbrief-meta" role="status">
              {writing
                ? "Coppice is writing this week's brief. The numbers are here meanwhile."
                : asked === "failed"
                  ? "The brief couldn't be written just now. The numbers above are counted by Coppice."
                  : "Counted by Coppice."}
            </p>
          </>
        )}

        {view.mine.count > 0 && (
          <p className="lg-wbrief-mine">
            <span className="lg-wbrief-mine-lead">{view.mine.count === 1 ? "Your claim that ends this week:" : "Your claims that end this week:"}</span>{" "}
            {view.mine.rows.map((claim, i) => (
              <span key={claim.id}>
                {i > 0 && ", "}
                <Link href={`/${workspaceId}/companies/${claim.id}`} className="lg-link">
                  {claim.name}
                </Link>{" "}
                <span className="lg-muted">({claim.until})</span>
              </span>
            ))}
            {view.mine.count > view.mine.rows.length && <span>, and {view.mine.count - view.mine.rows.length} more</span>}.
          </p>
        )}
      </div>
    </Disclosure>
  );
}
