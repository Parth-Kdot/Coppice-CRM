import { ActionForm } from "./action-form";
import { ClaimIcon } from "./icons";
import { Ribbon } from "./marks";
import type { Stage } from "@/generated/prisma/enums";
import type { Role } from "@/lib/authz";
import type { ClaimState } from "@/lib/claims";
import { when } from "@/lib/dates";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  stage: Stage;
  role: Role;
  // Worked out by claimState() against the database clock.
  state: ClaimState;
  holderName: string | null;
  expiresAt: Date | null;
  actions: { claim: Action; release: Action; forceRelease: Action };
};

// The claim ticket at the top of the right-hand page: a paper ticket with a perforated stub. The
// stub carries the gilt ribbon when the claim is yours, a plain mark when someone else holds it and
// when nobody does. The body says who holds the company and until when, in words, and holds the
// buttons that fit: Claim, Release, and for owners Force release. A refused claim is written under
// the buttons by the form itself, naming the holder and the expiry. Rendered on the server; only the
// forms run in the browser.
export function ClaimPanel(props: Props) {
  const { state, holderName, expiresAt, actions } = props;
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input type="hidden" name="companyId" value={props.companyId} />
    </>
  );
  const closed = TERMINAL_STAGES.includes(props.stage);
  const kind = state === "mine" ? "mine" : state === "theirs" ? "theirs" : "free";
  const holder = holderName ?? "Someone";

  let text: string;
  if (closed) text = `This company is ${STAGE_LABELS[props.stage].toLowerCase()}, so it can't be claimed.`;
  else if (state === "mine") text = `You hold this until ${when(expiresAt as Date)}.`;
  else if (state === "theirs") text = `Held by ${holder} until ${when(expiresAt as Date)}.`;
  else if (state === "expired") text = `${holder}'s claim expired ${when(expiresAt as Date)}.`;
  else text = "Not claimed.";

  const stub = kind === "mine" ? "Yours" : kind === "theirs" ? "Held" : closed ? "Closed" : "Free";

  return (
    <section className="lg-ticket" data-kind={kind} aria-labelledby="ticket-title">
      <div className="lg-ticket-stub" aria-hidden="true">
        {kind === "mine" ? <Ribbon size="lg" drop className="lg-ticket-ribbon" /> : <ClaimIcon size={26} />}
        <span>{stub}</span>
      </div>
      <div className="lg-ticket-body">
        <h2 id="ticket-title" className="lg-ticket-title lg-tag">
          Claim
        </h2>
        <p className="lg-ticket-text" aria-live="polite">
          {text}
        </p>
        {!closed && (
          <div className="lg-ticket-actions">
            {(state === "free" || state === "expired") && (
              <ActionForm action={actions.claim} submitLabel="Claim" primary successMessage={`Claimed ${props.companyName}.`}>
                {ids}
              </ActionForm>
            )}
            {state === "mine" && (
              <ActionForm
                action={actions.release}
                submitLabel="Release"
                confirmMessage={`Release your claim on ${props.companyName}?`}
                successMessage={`You released ${props.companyName}.`}
              >
                {ids}
              </ActionForm>
            )}
            {state === "theirs" && props.role === "owner" && (
              <ActionForm
                action={actions.forceRelease}
                submitLabel="Force release"
                confirmMessage={`Release ${holder}'s claim on ${props.companyName}?`}
                successMessage={`${holder}'s claim on ${props.companyName} was released.`}
              >
                {ids}
              </ActionForm>
            )}
          </div>
        )}
        {state === "theirs" && !closed && (
          <p className="lg-hint lg-ticket-hint">
            {props.role === "owner"
              ? "Logging outreach is for the person who holds the claim. As an owner you can release it."
              : "There is no outreach form while someone else holds this company. Ask them, or an owner."}
          </p>
        )}
      </div>
    </section>
  );
}

