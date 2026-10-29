"use client";

import { useRef } from "react";
import { CheckIcon, WarningIcon } from "../ledger/icons";
import { AI } from "./copy";
import { useReveal } from "./reveal";

// Facts and drafts: how the AI works in Coppice, told as four steps beside two example panels, a
// fact read from a packet and a draft with the claim check under it. Both panels are made up and
// labeled as an example. Nothing here is a live control.
export function AiSection() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const { mock } = AI;
  return (
    <section ref={root} id="ai" className="ld-sec ld-ai" aria-labelledby="ai-title">
      <div className="ld-wrap ld-grid ld-ai-grid">
        <div className="ld-ai-copy">
          <h2 id="ai-title" className="ld-h2">
            {AI.headline}
          </h2>
          <p className="ld-sub">{AI.body}</p>
          <ol className="ld-ai-steps">
            {AI.steps.map((step) => (
              <li key={step.title}>
                <div>
                  <h3 className="ld-h4">{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="ld-ai-note">{AI.optional}</p>
        </div>

        <div className="ld-ai-mock ld-reveal">
          <p className="ld-ai-label">{mock.label}</p>
          <div className="ld-panel" aria-hidden="true">
            <p className="ld-panel-title lg-sc">Fact sheet</p>
            <p className="ld-fact-text">{mock.fact.text}</p>
            <p className="ld-fact-src">{mock.fact.source}</p>
            <p className="ld-fact-quote lg-quote">&ldquo;{mock.fact.quote}&rdquo;</p>
            <p className="ld-fact-marks">
              <span>
                <CheckIcon size={16} />
                {mock.fact.found}
              </span>
              <span>
                <CheckIcon size={16} />
                {mock.fact.verified}
              </span>
            </p>
          </div>
          <div className="ld-panel" aria-hidden="true">
            <p className="ld-panel-title lg-sc">{mock.draftTitle}</p>
            <p className="ld-draft-text">
              {mock.draftParts.map((part, i) =>
                "mark" in part && part.mark ? (
                  <span key={i} className="ld-flag">
                    {part.text}
                  </span>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
            <p className="ld-finding">
              <WarningIcon size={16} />
              <span>
                {mock.finding.quote}: {mock.finding.reason}
              </span>
            </p>
            <div className="ld-draft-foot">
              <p className="ld-check-line">{mock.checkLine}</p>
              {mock.compose.map((label) => (
                <span key={label} className="ld-fakebtn">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
