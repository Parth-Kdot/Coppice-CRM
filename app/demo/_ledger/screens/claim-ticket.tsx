"use client";

import { useState } from "react";
import { formatWhen } from "@/demo/dates";
import type { CompanyDetail } from "@/demo/selectors";
import { useDemoActions } from "@/demo/store";
import { ClaimIcon, ReleaseIcon } from "../icons";
import { Ribbon } from "../marks";
import { useConfirm, useNotify } from "../providers";
import { ErrorLine, useClaimAction } from "./shared";

// The claim ticket, at the top of the right-hand page. A paper ticket with a perforated stub: the
// stub carries the gilt ribbon when the claim is yours, a dashed bookmark when someone else holds it,
// and an empty one when nobody does. The body says who holds the company and until when, in words,
// and holds Claim, Release and (for owners) Force release. A refused claim writes its reason in a rust
// note in the ticket's margin, naming the holder and the expiry.

export function ClaimTicket({ ws, detail }: { ws: string; detail: CompanyDetail }) {
  const actions = useDemoActions();
  const confirm = useConfirm();
  const notify = useNotify();
  const claimAction = useClaimAction(ws);
  const [error, setError] = useState<string | null>(null);
  const { company, claim } = detail;
  const holder = claim.holderName ?? "Someone";
  const refusal = claimAction.errors[company.id];

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

  const kind = claim.state === "mine" ? "mine" : claim.state === "theirs" ? "theirs" : "free";

  return (
    <section className="lg-ticket" data-kind={kind} aria-labelledby="ticket-title">
      <div className="lg-ticket-stub" aria-hidden="true">
        {kind === "mine" ? <Ribbon size="lg" drop={claimAction.dropping === company.id} className="lg-ticket-ribbon" /> : <ClaimIcon size={26} />}
        <span className="lg-sc">{kind === "mine" ? "Yours" : kind === "theirs" ? "Held" : "Free"}</span>
      </div>
      <div className="lg-ticket-body">
        <h2 id="ticket-title" className="lg-ticket-title lg-sc">
          Claim
        </h2>
        <p className={`lg-ticket-text ${kind === "mine" ? "lg-claimtext-mine" : ""}`} aria-live="polite">
          {text}
        </p>
        <div className="lg-actions">
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
        {kind === "theirs" && !detail.canForceRelease && !detail.closed && (
          <p className="lg-hint lg-ticket-hint">There is no outreach form while someone else holds this company. Ask them, or an owner.</p>
        )}
        {refusal && (
          <div className="lg-rownote lg-ticket-note" role="alert">
            <span>{refusal}</span>
            <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => claimAction.dismiss(company.id)}>
              Dismiss
            </button>
          </div>
        )}
        <ErrorLine>{error}</ErrorLine>
      </div>
    </section>
  );
}
