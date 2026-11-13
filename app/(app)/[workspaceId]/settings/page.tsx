import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Disclosure } from "@/components/ledger/disclosure";
import { WarningIcon } from "@/components/ledger/icons";
import { DeleteWorkspaceForm, InviteForm, MemberList, OpenFromHash, type MemberRow } from "@/components/ledger/invite-form";
import { ResearchSourcesSection } from "@/components/ledger/research-sources";
import { PageHead } from "@/components/ledger/shared";
import { ShowMore } from "@/components/ledger/show-more";
import { Stepper } from "@/components/ledger/stepper";
import { TemplatesSection } from "@/components/ledger/templates-section";
import { isConfigured } from "@/lib/ai/client";
import { AI_WINDOW_DAYS, aiUsageDetail } from "@/lib/ai/run";
import { describeAiFailures, describeAiUsage } from "@/lib/ai/usage";
import { requireMembershipOr404, roleLabel } from "@/lib/authz";
import { day } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { AI_LIMIT_MAX, CLAIM_WINDOW_MAX_DAYS, CLAIM_WINDOW_MIN_DAYS, WORKSPACE_NAME_MAX } from "@/lib/limits";
import { mcpResourceUrl } from "@/lib/mcp/config";
import { accessLabel, listConnections } from "@/lib/mcp/connections";
import { listSources } from "@/lib/research/sources";
import { toRole } from "@/lib/roles";
import { getExperimentView } from "@/lib/template-lab/lab";
import { listTemplates } from "@/lib/templates";
import { ONLY_OWNER_MESSAGE, workspaceRow } from "@/lib/workspaces";
import {
  cancelInvitation,
  changeMemberRole,
  deleteWorkspace,
  inviteMember,
  leaveWorkspace,
  removeMember,
  renameWorkspace,
  updateAiSettings,
  updateClaimWindow,
  updateMcpSettings,
} from "./actions";
import { disconnectAssistant } from "./assistant-actions";
import { addResearchSource, archiveResearchSource, renameResearchSource } from "./source-actions";
import "@/components/ledger/pages.css";
import "@/components/ledger/settings.css";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/settings">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Settings");
}

const METER_CELLS = 20;

// A name an assistant registered with, set apart (first-strong isolate) inside a sentence, so a
// name in a right-to-left script can't reorder the punctuation around it, as <bdi> does in the row.
const isolate = (name: string) => `\u2068${name}\u2069`;

// The AI feature's state, in one place, so the summary, the body and the officer's line agree.
type AiState = "on" | "off" | "unavailable";
const AI_STATE_LABEL: Record<AiState, string> = { on: "On", off: "Off", unavailable: "Not available" };
function aiState(enabled: boolean): AiState {
  if (!isConfigured()) return "unavailable";
  return enabled ? "on" : "off";
}

// Settings: Members open at the top (the one thing people come here for), then every other section
// collapsed to one line, most used first. Officers see the members, the claim window, AI's state and
// the read-only sections; everything an officer can't change is either a sentence or left out.
export default async function SettingsPage({ params }: PageProps<"/[workspaceId]/settings">) {
  const { workspaceId } = await params;
  const me = await requireMembershipOr404(workspaceId);
  const isOwner = me.role === "owner";

  // Separate queries (and separate withTenant transactions) side by side, in two rounds of at most
  // four connections each, so one render never asks for more than the pool's default of five.
  const [workspace, members, invitations, connections] = await Promise.all([
    workspaceRow(workspaceId),
    prisma.membership.findMany({
      where: { workspaceId },
      // Emails are only loaded for owners, so they never reach an officer's browser at all.
      select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: isOwner } } },
      // The id breaks ties (an import of members can share a timestamp), so rows never swap places.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    isOwner
      ? prisma.invitation.findMany({
          where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    // Your own assistants only (lib/mcp/connections.ts): its three queries run one after the other.
    listConnections(me.userId),
  ]);
  // aiUsageDetail makes two queries of its own.
  const [ai, templates, ownerSources] = await Promise.all([aiUsageDetail(me), listTemplates(me), isOwner ? listSources(me) : null]);
  // The running experiment's templates are locked in the list below (their text, and archiving them).
  const experiment = await getExperimentView(me);
  const state = aiState(ai.enabled);
  const aiOn = state === "on";
  // Research pages: owners always manage them; officers see them only while the feature is on.
  const sources = ownerSources ?? (aiOn ? await listSources(me) : []);

  // My own row first, then everyone else in the order they joined.
  const rows: MemberRow[] = members
    .map((m) => ({
      id: m.id,
      name: m.user.name,
      email: m.user.email ?? null,
      role: toRole(m.role),
      joined: day(m.createdAt),
      isMe: m.userId === me.userId,
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe));
  const ownerCount = rows.filter((r) => r.role === "owner").length;

  const ids = <input type="hidden" name="workspaceId" value={workspaceId} />;
  const filled = ai.limit > 0 ? Math.min(METER_CELLS, Math.ceil((ai.used / ai.limit) * METER_CELLS)) : ai.used > 0 ? METER_CELLS : 0;
  const atLimit = ai.used >= ai.limit;
  const claimLine = `Claims last ${workspace.claimWindowDays} ${workspace.claimWindowDays === 1 ? "day" : "days"}`;
  const aiSummary = state === "unavailable" ? AI_STATE_LABEL[state] : `${AI_STATE_LABEL[state]} · ${ai.used} of ${ai.limit} calls`;

  return (
    <div className="lg-page-settings lg-settings">
      <OpenFromHash />
      <PageHead title="Settings" />

      <section className="lg-set-members" aria-labelledby="set-members" data-tour="settings-members" id="members">
        <h2 id="set-members" className="lg-h2 lg-set-h2">
          Members
          <span className="lg-set-h2-count">
            {" "}
            · {rows.length}
            {invitations.length > 0 && <> · {invitations.length} invited</>}
          </span>
        </h2>
        <MemberList
          members={rows}
          isOwner={isOwner}
          ownerCount={ownerCount}
          onlyOwnerMessage={ONLY_OWNER_MESSAGE}
          workspaceName={workspace.name}
          workspaceId={workspaceId}
          actions={{ changeRole: changeMemberRole, remove: removeMember, leave: leaveWorkspace }}
        />
        {isOwner && (
          <>
            <InviteForm workspaceId={workspaceId} workspaceName={workspace.name} action={inviteMember} />
            {invitations.length > 0 && (
              <div className="lg-set-invites">
                <h3 className="lg-tag">Waiting to join</h3>
                <ShowMore initial={5} label="invitations" as="ul" listClassName="lg-invitelist">
                  {invitations.map((invite) => (
                    <li key={invite.id}>
                      <div className="lg-invite-text">
                        <p className="lg-invite-email">{invite.email}</p>
                        <p className="lg-hint">
                          {roleLabel(toRole(invite.role ?? "member"))} · pending until {day(invite.expiresAt)}
                        </p>
                      </div>
                      <ActionForm
                        action={cancelInvitation}
                        submitLabel="Cancel"
                        submitAriaLabel={`Cancel invitation for ${invite.email}`}
                        successMessage="Invitation canceled."
                        focusAfter="#set-members"
                        leaveRow
                        className="lg-invite-cancel"
                        small
                      >
                        {ids}
                        <input type="hidden" name="invitationId" value={invite.id} />
                      </ActionForm>
                    </li>
                  ))}
                </ShowMore>
              </div>
            )}
          </>
        )}
      </section>

      <div className="lg-set-more">
        <TemplatesSection
          isOwner={isOwner}
          workspaceId={workspaceId}
          templates={templates}
          lab={{
            aiOn,
            running: experiment?.status === "RUNNING",
            arms: experiment?.status === "RUNNING" ? Object.fromEntries(experiment.arms.map((a) => [a.templateId, a.label])) : {},
          }}
        />

        {isOwner ? (
          <Disclosure summary="Claim window" count={claimLine} data-tour="settings-claim-window">
            <p className="lg-set-note">How long an officer holds a company after claiming it, before anyone else can take it.</p>
            <ActionForm
              action={updateClaimWindow}
              submitLabel="Save"
              submitAriaLabel="Save claim window"
              successMessage="Saved."
              savedNote
              className="lg-setrow lg-claimform"
              focusAfter=".lg-claimform button[type=submit]"
            >
              {ids}
              <Stepper name="days" label="Claim window in days" defaultValue={workspace.claimWindowDays} min={CLAIM_WINDOW_MIN_DAYS} max={CLAIM_WINDOW_MAX_DAYS} />
              <span>days</span>
            </ActionForm>
            <p className="lg-hint mt-2">Claims already taken keep the expiry they were given.</p>
          </Disclosure>
        ) : (
          // Laid out like the rows around it (a title, then its value), without the chevron.
          <p className="lg-set-line" data-tour="settings-claim-window">
            <span className="lg-set-line-title">Claim window</span>
            <span className="lg-disc-count">{claimLine}</span>
          </p>
        )}

        <Disclosure summary="AI" count={aiSummary} data-tour="ai-usage">
          <p className="lg-set-note">AI drafts emails from your verified facts. Email addresses and phone numbers in US or international (+) format are masked.</p>
          {state === "unavailable" &&
            (isOwner ? (
              <p className="lg-error">
                <WarningIcon size={16} />
                <span>AI isn&apos;t set up on this server yet: it needs a GEMINI_API_KEY.</span>
              </p>
            ) : (
              <p>AI isn&apos;t available yet. Everything else works.</p>
            ))}
          {state !== "unavailable" && (
            <div className="lg-usage">
              <p className="lg-usage-line">
                {ai.used} of {ai.limit} AI {ai.limit === 1 ? "call" : "calls"} used in the last {AI_WINDOW_DAYS} days.
              </p>
              <div className="lg-meter" data-full={atLimit || undefined} aria-hidden="true">
                {Array.from({ length: METER_CELLS }, (_, i) => (
                  <span key={i} data-on={i < filled || undefined} />
                ))}
              </div>
              {atLimit && ai.limit > 0 && <p className="lg-error">Limit reached. {isOwner ? "Raise it below." : "Ask an owner to raise it."}</p>}
              {ai.breakdown.parts.length > 0 && (
                <Disclosure variant="inline" summary="See what used them">
                  <p className="lg-usage-detail">
                    That is {describeAiUsage(ai.breakdown)} {describeAiFailures(ai.breakdown.failed)} Everyone in the workspace is counted. One Draft
                    click uses two calls: one to write, one to check.
                  </p>
                </Disclosure>
              )}
            </div>
          )}
          <Disclosure variant="inline" summary="What is sent to Google and Groq" className="lg-set-privacy">
            <p className="max-w-[66ch]">
              Drafts pitch emails from facts your workspace has verified. AI runs on Google&apos;s free Gemini tier, which may use what
              it&apos;s sent to improve Google&apos;s products. Contact names are filled in after a draft comes back, and email addresses and
              phone numbers in US or international (+) format are masked. A name in your packet, a note or an edited draft can still reach it, so leave those out. A
              template you base a draft on is sent too, masked the same way, so keep names out of templates. A draft request carries
              your verified facts, the company&apos;s name, industry, website and stage, the contact&apos;s job title and any note you add. For a
              follow-up it also carries the date and channel of each of the last five earlier outreach entries, whether they replied, and the
              subject of its AI draft with the names put back to placeholders.
              {" "}A &ldquo;Who to contact&rdquo; brief sends Gemini only the public text and addresses of the research pages an owner approved, with email
              addresses and phone numbers masked, plus the company&apos;s name and website; never your notes or contacts.
            </p>
            <p className="max-w-[66ch]">
              &ldquo;Explain these numbers&rdquo; on the stats page sends Gemini your template names and the numbers on that page (sends, replies and
              rates), never a note, a company or a contact. The Template Lab, which proposes one-change variants of a template, sends Gemini that
              template&apos;s text, masked like a draft&apos;s, and up to 40 of your verified facts. A template with an email address or phone number in
              it is not sent: take contact details out first.
            </p>
            <p className="max-w-[66ch]">
              Smart import, an option on the CSV importer, sends Gemini a sheet&apos;s headers only when they are plain spreadsheet words (like
              &ldquo;Last contacted&rdquo;), and otherwise their shape (like &ldquo;2 words&rdquo;), the company names and industries from columns plainly
              labeled as such (like &ldquo;Company&rdquo; or &ldquo;Industry&rdquo;), and, for up to 15 sample rows, only the shape of its other cells (like
              &ldquo;6 words, has a date&rdquo;), not their words. To spot look-alikes it also sends Gemini the sheet&apos;s company names and the names of the
              companies already saved in this workspace, archived ones included, each cut before any note (&ldquo;Acme (ask Dana)&rdquo; is sent as
              &ldquo;Acme&rdquo;) or left out if it is only a note; with more than 600 names in all, that check is skipped. Its free-text cells, which can include
              names, go to Groq instead, with email addresses and phone numbers in US or international (+) format masked. Groq says it doesn&apos;t keep what it&apos;s sent by default, apart from logs it may hold for up to 30 days to
              look into errors or abuse.
              Ask Coppice sends Groq your question, your last few questions in that conversation, and the names of companies it just showed you,
              and Groq keeps them as described above. Notes, contacts and outreach history are not sent; answers are read from your workspace by code.
              An AI assistant a member connects is separate (see AI assistants below): what it reads, contact names included, goes to
              the company behind it.
            </p>
          </Disclosure>
          {isOwner && (
            <ActionForm
              action={updateAiSettings}
              submitLabel="Save"
              submitAriaLabel="Save AI settings"
              successMessage="Saved."
              savedNote
              className="lg-aiform lg-aiset"
              focusAfter=".lg-aiset button[type=submit]"
            >
              {ids}
              <label className="lg-switch">
                <input name="enabled" type="checkbox" defaultChecked={ai.enabled} className="lg-check" />
                <span>AI on for this workspace</span>
              </label>
              <p className="lg-hint">This doesn&apos;t affect AI assistants; turn those off under AI assistants below.</p>
              <div className="lg-setrow">
                <span className="lg-label !mb-0">Limit</span>
                <Stepper name="limit" label={`AI calls allowed per ${AI_WINDOW_DAYS} days`} defaultValue={ai.limit} min={0} max={AI_LIMIT_MAX} step={10} />
                <span>calls per {AI_WINDOW_DAYS} days</span>
              </div>
            </ActionForm>
          )}
        </Disclosure>

        {(isOwner || aiOn) && (
          <Disclosure
            summary="Research sources"
            count={sources.length === 0 ? "None yet" : sources.length}
            data-tour="research-sources"
            className="lg-set-wrap"
          >
            <ResearchSourcesSection
              workspaceId={workspaceId}
              sources={sources}
              isOwner={isOwner}
              aiOn={aiOn}
              actions={{ add: addResearchSource, rename: renameResearchSource, archive: archiveResearchSource }}
            />
          </Disclosure>
        )}

        <Disclosure summary="AI assistants (MCP)" count={workspace.mcpEnabled ? "On" : "Off"} data-tour="mcp" id="mcp">
          <div className="lg-set-mcp">
            <p className="max-w-[66ch]">
              Members can connect their own AI assistant (any that supports remote MCP servers) to read this workspace and, if they allow it,
              claim companies, log outreach and move stages as them, marked &quot;via assistant&quot; in a company&apos;s history.
            </p>
            <p className="lg-mcp-privacy max-w-[66ch]">
              <WarningIcon size={16} />
              <span>
                Everything an assistant reads here goes to the AI company behind it, under that company&apos;s terms: company names and
                notes, contact names, emails and titles, and outreach notes. Coppice&apos;s own masking does not apply.
              </span>
            </p>
            <h3 className="lg-h3 mt-4">How to connect</h3>
            <ol className="lg-mcp-steps">
              <li>
                In your assistant, add a custom connector (or remote MCP server) with this address:
                <code className="lg-mcp-url">{mcpResourceUrl()}</code>
              </li>
              <li>Sign in with Google, with the same account you use for Coppice.</li>
              <li>Coppice shows what the assistant asks for. Allow it, or deny it.</li>
            </ol>
            <h3 className="lg-h3 mt-4" id="set-mcp-mine">
              Your connected assistants
            </h3>
            <p className="lg-hint max-w-[66ch]">
              Only you see this list. Removing the connector in your assistant may not end its access; Disconnect here ends it at once, in
              every workspace you are in. An owner turning assistants off blocks every one in this workspace until it is turned back on.
            </p>
            {connections.length === 0 ? (
              <p className="mt-2">None connected.</p>
            ) : (
              <div className="lg-set-invites !mt-2">
                <ShowMore initial={5} label="assistants" as="ul" listClassName="lg-invitelist" listLabel="Your connected assistants">
                  {connections.map((c) => (
                    <li key={c.clientId}>
                      <div className="lg-invite-text">
                        {/* The name is whatever the assistant registered with: cleaned, and isolated so it can't reorder the text around it. */}
                        <p className="lg-invite-email">
                          <bdi>{c.name}</bdi>
                        </p>
                        <p className="lg-hint">
                          {!workspace.mcpEnabled && <>Off in this workspace · </>}
                          Returns to {c.returnsTo} · {accessLabel(c)} · allowed {day(c.allowedAt)}
                          {c.lastRenewedAt && <> · last connected {day(c.lastRenewedAt)}</>}
                        </p>
                      </div>
                      <ActionForm
                        action={disconnectAssistant}
                        submitLabel="Disconnect"
                        submitAriaLabel={`Disconnect ${isolate(c.name)}`}
                        confirmMessage={`Disconnect ${isolate(c.name)}? It loses access to Coppice at once, in every workspace. To use it again, connect it again.`}
                        successMessage={`${isolate(c.name)} disconnected.`}
                        focusAfter="#set-mcp-mine"
                        leaveRow
                        refreshOnError
                        className="lg-invite-cancel"
                        small
                      >
                        {ids}
                        <input type="hidden" name="clientId" value={c.clientId} />
                      </ActionForm>
                    </li>
                  ))}
                </ShowMore>
              </div>
            )}
            {isOwner ? (
              <ActionForm
                action={updateMcpSettings}
                submitLabel="Save"
                submitAriaLabel="Save AI assistant setting"
                successMessage="Saved."
                className="lg-aiform lg-mcpset"
                focusAfter=".lg-mcpset button[type=submit]"
              >
                {ids}
                <label className="lg-switch">
                  <input name="enabled" type="checkbox" defaultChecked={workspace.mcpEnabled} className="lg-check" />
                  <span>Allow AI assistants in this workspace</span>
                </label>
              </ActionForm>
            ) : (
              <p className="mt-3">
                Assistants are {workspace.mcpEnabled ? "allowed" : "off"} in this workspace. Only an owner can change that.
              </p>
            )}
          </div>
        </Disclosure>

        {isOwner && (
          <Disclosure summary="Workspace" count="Rename or delete" id="workspace">
            <ActionForm
              action={renameWorkspace}
              submitLabel="Rename"
              successMessage="Workspace renamed."
              savedNote
              className="lg-setrow lg-renameform"
              focusAfter=".lg-renameform button[type=submit]"
            >
              {ids}
              <div className="lg-renamefield">
                <label className="lg-label" htmlFor="set-ws-name">
                  Name
                </label>
                <input
                  id="set-ws-name"
                  name="name"
                  required
                  minLength={2}
                  maxLength={WORKSPACE_NAME_MAX}
                  defaultValue={workspace.name}
                  autoComplete="off"
                  className="lg-input"
                />
              </div>
            </ActionForm>
            <Disclosure variant="inline" summary="Danger zone" className="lg-set-danger">
              <DeleteWorkspaceForm workspaceId={workspaceId} workspaceName={workspace.name} action={deleteWorkspace} />
            </Disclosure>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
