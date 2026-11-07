import { ActionForm } from "@/components/action-form";
import { ClaimButton } from "@/components/ledger/company-blocks";
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

// Where focus goes after a release removes the Release button: the strip's new Claim button. (The
// Claim button hands focus on by itself: to the log card, or to the strip after a refusal.)
const AFTER_RELEASE = '[data-tour="company-claim"] button';

// The claim strip: one line saying who holds the company and until when, with the one button that
// fits. Yours: "Yours until Nov 21" and a quiet Release. Free: "Nobody holds this" and Claim it. Your
// own claim ran out: "Your claim expired Nov 5" and Claim again (the log form still shows, since
// logging renews it). Someone else's: a plain sentence, and for an owner Force release. A closed
// company (Committed, Declined) has no strip: it can't be claimed and the header says why. A
// refused claim (someone was quicker) is written under the strip and the page re-renders with the
// winner. Rendered on the server; only the forms run in the browser.
export function ClaimPanel(props: Props) {
  const { state, holderName, expiresAt, actions } = props;
  if (TERMINAL_STAGES.includes(props.stage)) return null;
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input type="hidden" name="companyId" value={props.companyId} />
    </>
  );
  const holder = holderName ?? "Someone";
  const first = holder.split(/\s+/)[0] || holder;
  const date = expiresAt ? day(expiresAt) : "";
  const via = (state === "mine" || state === "theirs") && props.claimedVia === "ASSISTANT" ? <span className="lg-via">via assistant</span> : null;

  let text: React.ReactNode;
  let action: React.ReactNode = null;
  if (state === "mine") {
    text = <>Yours until {date}.</>;
    action = (
      <ActionForm
        action={actions.release}
        submitLabel="Release"
        small
        submitAriaLabel={`Release your claim on ${props.companyName}`}
        confirmMessage={`Release your claim on ${props.companyName}? Someone else can claim it then.`}
        successMessage={`You released ${props.companyName}.`}
        focusAfter={AFTER_RELEASE}
        className="lg-strip-form"
      >
        {ids}
      </ActionForm>
    );
  } else if (state === "theirs") {
    text =
      props.role === "owner" ? (
        <>
          {holder} holds this until {date}.
        </>
      ) : (
        <>
          {holder} holds this until {date}. Until then only {first} can log outreach, move it or archive it.
        </>
      );
    if (props.role === "owner") {
      action = (
        <ActionForm
          action={actions.forceRelease}
          submitLabel="Force release"
          small
          confirmMessage={`Release ${holder}'s claim on ${props.companyName}?`}
          successMessage={`${holder}'s claim on ${props.companyName} was released.`}
          focusAfter={AFTER_RELEASE}
          className="lg-strip-form"
        >
          {ids}
        </ActionForm>
      );
    }
  } else {
    text =
      state === "expired-mine" ? (
        <>Your claim expired {date}. Claim it again to keep working, or just log outreach.</>
      ) : state === "expired" ? (
        <>
          {holder}&rsquo;s claim expired {date}. Nobody holds this now.
        </>
      ) : (
        <>Nobody holds this.</>
      );
    action = (
      <ClaimButton
        action={actions.claim}
        workspaceId={props.workspaceId}
        companyId={props.companyId}
        companyName={props.companyName}
        label={state === "expired-mine" ? "Claim again" : "Claim it"}
      />
    );
  }

  return (
    <section className="lg-strip" data-kind={state} aria-labelledby="claim-h" data-tour="company-claim" tabIndex={-1}>
      <h2 id="claim-h" className="lg-sr" tabIndex={-1}>
        Claim
      </h2>
      <p className="lg-strip-text" aria-live="polite">
        {text}
        {via}
      </p>
      {action}
    </section>
  );
}
