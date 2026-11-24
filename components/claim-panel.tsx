import { ClaimButton, TicketRelease } from "@/components/ledger/company-blocks";
import { ClaimIcon } from "@/components/ledger/icons";
import { Ribbon } from "@/components/ledger/marks";
import type { Stage, Via } from "@/generated/prisma/enums";
import type { Role } from "@/lib/authz";
import type { ClaimView } from "@/lib/claims";
import { day } from "@/lib/dates";
import { TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";

type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  stage: Stage;
  role: Role;
  // Worked out by claimView() against the database clock.
  state: ClaimView;
  holderName: string | null;
  expiresAt: Date | null;
  // How the live claim was made; ASSISTANT gets a "via assistant" stamp.
  claimedVia?: Via | null;
  actions: { claim: Action; release: Action; forceRelease: Action };
};

// The claim ticket at the top of the right-hand page: a paper ticket with a perforated stub. The
// stub says whose it is in one word ("Yours", "Held", "Free", "Lapsed"); a claim that is yours is a
// moss ticket with the gilt ribbon hanging from the stub. The body carries the "Claim" eyebrow, one
// line in the display serif saying who holds the company and until when, and the one button that
// fits: Claim it, Release, or for an owner Force release. Your own claim that ran out says so and
// offers Claim again (the log form still shows, since logging renews it). A closed company
// (Committed, Declined) has no ticket: it can't be claimed and the header says why.
//
// Rendered on the server; only the buttons run in the browser. Claiming stamps the new ticket and
// drops the ribbon onto it; releasing tears the body off along the perforation (company-blocks.tsx).
// Releasing your own claim asks nothing first (it is easy to take back): the note says so and offers
// Undo, which claims it again. An owner's Force release still asks.
// The section is keyed by state, so a new ticket is a new element and never inherits a torn one.
export function ClaimPanel(props: Props) {
  const { state, holderName, expiresAt, actions } = props;
  if (TERMINAL_STAGES.includes(props.stage)) return null;
  const holder = holderName ?? "Someone";
  const first = holder.split(/\s+/)[0] || holder;
  const date = expiresAt ? day(expiresAt) : "";
  const via = (state === "mine" || state === "theirs") && props.claimedVia === "ASSISTANT" ? <span className="lg-via">via assistant</span> : null;
  const ids = { workspaceId: props.workspaceId, companyId: props.companyId };

  let stub: string;
  let text: React.ReactNode;
  let hint: React.ReactNode = null;
  let action: React.ReactNode = null;
  if (state === "mine") {
    stub = "Yours";
    text = <>You hold this until {date}.</>;
    action = (
      <TicketRelease
        action={actions.release}
        {...ids}
        submitLabel="Release"
        ariaLabel={`Release your claim on ${props.companyName}`}
        successMessage={`You released ${props.companyName}.`}
        undo={actions.claim}
      />
    );
  } else if (state === "theirs") {
    stub = "Held";
    text = (
      <>
        {holder} holds this until {date}.
      </>
    );
    if (props.role === "owner") {
      action = (
        <TicketRelease
          action={actions.forceRelease}
          {...ids}
          submitLabel="Force release"
          confirmMessage={`Release ${holder}'s claim on ${props.companyName}?`}
          successMessage={`${holder}'s claim on ${props.companyName} was released.`}
        />
      );
    } else {
      hint = <>Until then only {first} can log outreach, move it or archive it.</>;
    }
  } else {
    stub = state === "expired-mine" ? "Lapsed" : "Free";
    text = state === "expired-mine" ? <>Your claim expired {date}.</> : state === "expired" ? <>{holder}&rsquo;s claim expired {date}.</> : <>Nobody holds this.</>;
    if (state === "expired-mine") hint = <>Claim it again to keep working, or just log outreach.</>;
    action = <ClaimButton action={actions.claim} {...ids} companyName={props.companyName} label={state === "expired-mine" ? "Claim again" : "Claim it"} />;
  }

  return (
    <section key={state} className="lg-ticket" data-kind={state} aria-labelledby="claim-h" data-tour="company-claim" tabIndex={-1}>
      <div className="lg-ticket-stub" aria-hidden="true">
        {state === "mine" ? <Ribbon size="lg" className="lg-ticket-ribbon" /> : <ClaimIcon size={22} className="lg-ticket-icon" />}
        <span className="lg-ticket-word">{stub}</span>
      </div>
      <div className="lg-ticket-body">
        <h2 id="claim-h" className="lg-ticket-eyebrow lg-tag" tabIndex={-1}>
          Claim
        </h2>
        <div className="lg-ticket-main">
          <p className="lg-ticket-text" aria-live="polite">
            {text}
            {via}
          </p>
          {action}
        </div>
        {hint && <p className="lg-hint lg-ticket-hint">{hint}</p>}
      </div>
    </section>
  );
}
