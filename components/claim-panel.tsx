import { ActionForm } from "@/components/action-form";
import type { Stage } from "@/generated/prisma/enums";
import type { Role } from "@/lib/authz";
import { CHANNEL_LABELS, CHANNELS } from "@/lib/channels";
import type { ClaimState } from "@/lib/claims";
import { addDays, when } from "@/lib/dates";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { NOTE_MAX, type ActionResult } from "@/lib/validation";

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
  // Today in West Lafayette, from the database ("2026-10-25"), for the follow-up date box.
  today: string;
  actions: { claim: Action; release: Action; forceRelease: Action; logOutreach: Action };
};

// The claim box at the top of a company page: who holds it, the buttons that fit, and the log
// outreach form for the holder. Rendered on the server; only the buttons run in the browser.
export function ClaimPanel(props: Props) {
  const { state, holderName, expiresAt, actions } = props;
  const ids = (
    <>
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input type="hidden" name="companyId" value={props.companyId} />
    </>
  );

  if (TERMINAL_STAGES.includes(props.stage)) {
    return <p className="text-sm text-zinc-500">This company is {STAGE_LABELS[props.stage]}, so it can&apos;t be claimed.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state === "free" && (
        <ActionForm action={actions.claim} submitLabel="Claim">
          {ids}
          <span>Not claimed.</span>
        </ActionForm>
      )}
      {state === "expired" && (
        <ActionForm action={actions.claim} submitLabel="Claim">
          {ids}
          <span>
            {holderName}&apos;s claim expired {when(expiresAt as Date)}.
          </span>
        </ActionForm>
      )}
      {state === "theirs" && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Held by {holderName} until {when(expiresAt as Date)}.
          </span>
          {props.role === "owner" && (
            <ActionForm
              action={actions.forceRelease}
              submitLabel="Force release"
              confirmMessage={`Release ${holderName}'s claim on ${props.companyName}?`}
            >
              {ids}
            </ActionForm>
          )}
        </div>
      )}
      {state === "mine" && (
        <>
          <ActionForm action={actions.release} submitLabel="Release" confirmMessage={`Release your claim on ${props.companyName}?`}>
            {ids}
            <span>You hold this until {when(expiresAt as Date)}.</span>
          </ActionForm>
          {/* The queue's "Log outreach" links jump here. */}
          <section id="log-outreach" className="flex flex-col gap-2 rounded border p-3">
            <h3 className="font-semibold">Log outreach</h3>
            <p className="text-sm text-zinc-500">After you reach out from your own inbox or in person. Saving renews your claim.</p>
            <ActionForm action={actions.logOutreach} submitLabel="Log outreach" successMessage="Logged.">
              {ids}
              <select name="channel" defaultValue="EMAIL" aria-label="Channel" className="rounded border px-2 py-1">
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {CHANNEL_LABELS[channel]}
                  </option>
                ))}
              </select>
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
              <textarea
                name="note"
                rows={3}
                maxLength={NOTE_MAX}
                placeholder="What you sent or talked about"
                aria-label="Note"
                className="w-full rounded border px-2 py-1"
              />
            </ActionForm>
          </section>
        </>
      )}
    </div>
  );
}
