import { McpServer, requireScopes } from "@modelcontextprotocol/server";
import { READ_SCOPE, WRITE_SCOPE } from "@/lib/mcp/config";
import * as tools from "@/lib/mcp/tools";
import type { McpPrincipal } from "@/lib/mcp/tools";
import {
  mcpAcceptBriefItemSchema,
  mcpApplyHandoffCalendarSchema,
  mcpApproveRemainingCardsSchema,
  mcpBuildHandoffCardsSchema,
  mcpChangeStageSchema,
  mcpCompanySchema,
  mcpCreateCompanySchema,
  mcpDeletePermanentlySchema,
  mcpEndExperimentSchema,
  mcpFillBlankDatesSchema,
  mcpGetHandoffSchema,
  mcpGetStatsSchema,
  mcpListCompaniesSchema,
  mcpListDuplicatePairsSchema,
  mcpListFactsSchema,
  mcpListMembersSchema,
  mcpListMyClaimsSchema,
  mcpListTemplatesSchema,
  mcpLogOutreachSchema,
  mcpMarkReplySchema,
  mcpPrepareEmailSchema,
  mcpPreviewImportSchema,
  mcpQueueSchema,
  mcpReleaseClaimSchema,
  mcpReleaseDepartingClaimsSchema,
  mcpReopenForNextYearSchema,
  mcpResolveDuplicateSchema,
  mcpReviewHandoffCardSchema,
  mcpRunImportSchema,
  mcpSaveContactSchema,
  mcpSaveFactSchema,
  mcpSaveRecontactDatesSchema,
  mcpSaveResearchSourceSchema,
  mcpSaveTemplateSchema,
  mcpRestorePreviousVersionSchema,
  mcpSetCompanyArchivedSchema,
  mcpSetDepartingSchema,
  mcpSetFactVerifiedSchema,
  mcpSetFollowUpSchema,
  mcpSetHandoffPublishedSchema,
  mcpSetResearchSourceArchivedSchema,
  mcpSetTemplateArchivedSchema,
  mcpStartExperimentSchema,
  mcpStartHandoffSchema,
  mcpUpdateCompanySchema,
  mcpWorkspaceSchema,
} from "@/lib/validation";

// The MCP server one request talks to. A fresh one is built for every request (the transport is
// stateless), bound to the person the access token belongs to, so no tool can act as anyone else.

const INSTRUCTIONS = [
  "Coppice is a shared sponsor outreach workspace for a student club.",
  "Start with list_workspaces; every other tool takes a workspaceId from it.",
  "Claim a company before logging outreach on it; a live claim by someone else blocks you.",
  "Only change things the person asked for. Ask before moving a company to COMMITTED or DECLINED.",
  "Ask the person before anything marked destructive or that needs confirm: true, and send confirm: true only after they agree.",
  "Coppice sends no email itself: logging outreach records what the person did.",
  tools.UNTRUSTED_NOTICE,
].join(" ");

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const ACTION = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
// Asking for an action without the write scope gets an OAuth step-up challenge (403
// insufficient_scope), so the assistant can ask the person for more access.
const needsWrite = requireScopes(READ_SCOPE, WRITE_SCOPE);

export function buildMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer({ name: "coppice", title: "Coppice", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  // One function for each group of tools, in the order of lib/mcp/tools/: W, C, P, K, S, H, I.
  registerWorkspaceTools(server, principal);
  registerCompanyTools(server, principal);
  registerContactTools(server, principal);
  registerKnowledgeTools(server, principal);
  registerStatsTools(server, principal);
  registerHandoffTools(server, principal);
  registerImportTools(server, principal);
  return server;
}

// Every tool body runs inside tools.guarded, so an unexpected error never reaches the assistant
// word for word.

// Group W, the workspace (read only).
function registerWorkspaceTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "list_workspaces",
    { title: "List workspaces", description: "Workspaces you belong to that allow assistants, with your role in each.", annotations: READ },
    () => tools.guarded(() => tools.listWorkspaces(principal)),
  );
  server.registerTool(
    "get_workspace",
    {
      title: "Get a workspace",
      description: "Your role, the claim window, whether AI is on and its use, companies per stage, archived count, industries and active templates.",
      inputSchema: mcpWorkspaceSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.getWorkspace(principal, args)),
  );
  server.registerTool(
    "list_members",
    {
      title: "List members",
      description: "Members with their role and join date, as in Settings. Owners also get emails, who is leaving, claims held and pending invitations.",
      inputSchema: mcpListMembersSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listMembers(principal, args)),
  );
}

// Group C, companies and claims.
function registerCompanyTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "list_companies",
    {
      title: "List or search companies",
      description:
        "Companies in a workspace, by name, with stage, follow-up date and who holds each. Active ones by default; filter by status, stage, claim, follow-up, industry or notes. Up to 50 a page; use cursor for more.",
      inputSchema: mcpListCompaniesSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listCompanies(principal, args)),
  );
  server.registerTool(
    "get_company",
    {
      title: "Get a company",
      description:
        "One company with its notes, contacts, outreach history, stage history, look-alikes, the values replaced in the last hour (previousVersions) and, while AI is on, its latest stored research brief and your recent drafts.",
      inputSchema: mcpCompanySchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.getCompany(principal, args)),
  );
  server.registerTool(
    "get_follow_up_queue",
    {
      title: "Follow-up queue",
      description: "Open companies whose follow-up date has arrived, most overdue first, optionally with never-contacted leads. Use cursor for more.",
      inputSchema: mcpQueueSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.getFollowUpQueue(principal, args)),
  );
  server.registerTool(
    "list_my_claims",
    { title: "My claims", description: "Companies you hold right now, and until when. Use cursor for more.", inputSchema: mcpListMyClaimsSchema, annotations: READ },
    (args) => tools.guarded(() => tools.listMyClaims(principal, args)),
  );
  server.registerTool(
    "list_duplicate_pairs",
    {
      title: "Possible duplicates",
      description: "Pairs of active companies with the same name or website that nobody has marked as different, with the one to keep by default. Use cursor for more.",
      inputSchema: mcpListDuplicatePairsSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listDuplicatePairs(principal, args)),
  );
  server.registerTool(
    "create_company",
    {
      title: "Add a company",
      description:
        "Add a company. If look-alikes exist nothing is saved and they are listed: show them to the person, and send separateFrom only after the person says they are different companies.",
      inputSchema: mcpCreateCompanySchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.createCompanyTool(principal, args)),
  );
  server.registerTool(
    "update_company",
    {
      title: "Edit a company",
      description:
        "Change a company's name, industry, website or notes. Change only what the person asked: notes are replaced in full, and the value replaced can be put back for one hour with restore_previous_version. Send original from get_company; if someone changed it since, nothing is saved.",
      inputSchema: mcpUpdateCompanySchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.updateCompanyTool(principal, args)),
  );
  server.registerTool(
    "restore_previous_version",
    {
      title: "Restore a previous version",
      description:
        "Put back the previous value of one company or contact field, from previousVersions in get_company. The value it replaces becomes the new previous version, so a restore can be undone. Each lasts one hour. Send field, contactId and current as get_company returned them; if the field changed since, nothing is restored.",
      inputSchema: mcpRestorePreviousVersionSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.restorePreviousVersionTool(principal, args)),
  );
  server.registerTool(
    "set_company_archived",
    {
      title: "Archive or unarchive a company",
      description: "Archive a company (hidden from the board and queue, history kept, any claim cleared) or bring it back. Someone else's live claim blocks it unless you are an owner.",
      inputSchema: mcpSetCompanyArchivedSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setCompanyArchivedTool(principal, args)),
  );
  server.registerTool(
    "resolve_duplicate",
    {
      title: "Resolve a duplicate",
      description:
        "For a pair from list_duplicate_pairs: same keeps one company (keepId) and archives the other, nothing is merged. separate remembers they are different and cannot be undone.",
      inputSchema: mcpResolveDuplicateSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.resolveDuplicateTool(principal, args)),
  );
  server.registerTool(
    "claim_company",
    {
      title: "Claim a company",
      description: "Claim a company for the workspace's claim window, as you. Fails if someone else holds it.",
      inputSchema: mcpCompanySchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.claimCompanyTool(principal, args)),
  );
  server.registerTool(
    "release_claim",
    {
      title: "Release a claim",
      description: "Give up your own claim on a company. With force, an owner releases someone else's claim: that needs confirm: true after the person agrees, and the holder is not told.",
      inputSchema: mcpReleaseClaimSchema,
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.releaseClaimTool(principal, args)),
  );
  server.registerTool(
    "log_outreach",
    {
      title: "Log outreach",
      description:
        "Record that you contacted a company you hold, and set the next follow-up date. Coppice sends nothing itself. Send a clientKey so a retry logs once.",
      inputSchema: mcpLogOutreachSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.logOutreachTool(principal, args)),
  );
  server.registerTool(
    "mark_reply",
    {
      title: "Mark which outreach got the reply",
      description: "Mark one outreach entry of a company in a reply stage as the one that got the answer, so template stats count it. A mark cannot be taken back.",
      inputSchema: mcpMarkReplySchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.markReplyTool(principal, args)),
  );
  server.registerTool(
    "set_follow_up",
    {
      title: "Set the follow-up date",
      description: "Set a company's next follow-up date, from today to a year out, without logging outreach or touching the claim. Someone else's live claim blocks it.",
      inputSchema: mcpSetFollowUpSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setFollowUpTool(principal, args)),
  );
  server.registerTool(
    "change_stage",
    {
      title: "Change stage",
      description:
        "Move a company to another stage. Moving to COMMITTED or DECLINED, or moving a company out of them (reopening a closed pitch), needs confirm: true after the person agrees.",
      inputSchema: mcpChangeStageSchema,
      // Marked destructive so the assistant's app asks the person first: Committed and Declined end
      // the pitch and release the claim, and confirm: true is filled in by the assistant itself.
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.changeStageTool(principal, args)),
  );
}

// Group P, contacts.
function registerContactTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "save_contact",
    {
      title: "Add or change a contact",
      description:
        "Add a contact to a company, or change one when you send contactId. Change only what the person asked: a replaced name, email or title can be put back for one hour with restore_previous_version. Archived companies are refused.",
      inputSchema: mcpSaveContactSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.saveContactTool(principal, args)),
  );
  server.registerTool(
    "delete_permanently",
    {
      title: "Delete for good",
      description:
        "Permanently delete a contact (any member), a fact or an uploaded packet with its facts (owners). It cannot be undone. Needs confirm: true after the person agrees.",
      inputSchema: mcpDeletePermanentlySchema,
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.deletePermanentlyTool(principal, args)),
  );
}

// Group K, knowledge. Nothing here asks a model for anything.
function registerKnowledgeTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "list_facts",
    {
      title: "List facts",
      description: "The fact sheet. Officers get the verified facts. Owners get every fact with its status, quote, page and stale flag, and the uploaded files. Use cursor for more.",
      inputSchema: mcpListFactsSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listFactsTool(principal, args)),
  );
  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "Active email templates with their text and, while an experiment runs, the arm each one is in. Owners also get archived templates and use counts. Use cursor for more.",
      inputSchema: mcpListTemplatesSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listTemplatesTool(principal, args)),
  );
  server.registerTool(
    "prepare_email",
    {
      title: "Prepare an email",
      description:
        "Fill a template, or check your own text, with the contact's first name, your name and the workspace name, then check numbers, links and past-sponsor claims against the verified facts. Coppice sends nothing: the person sends it, then you log it with log_outreach.",
      inputSchema: mcpPrepareEmailSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.prepareEmailTool(principal, args)),
  );
  server.registerTool(
    "list_research_sources",
    {
      title: "List research sources",
      description: "The approved pages that research briefs may read. Owners always see them; officers only while AI is on.",
      inputSchema: mcpWorkspaceSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.listResearchSourcesTool(principal, args)),
  );
  server.registerTool(
    "save_fact",
    {
      title: "Add or change a fact",
      description:
        "Owners only. Add a fact, or change one when you send factId. It is saved as waiting for an owner to verify it, and a changed fact loses its verified mark.",
      inputSchema: mcpSaveFactSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.saveFactTool(principal, args)),
  );
  server.registerTool(
    "set_fact_verified",
    {
      title: "Verify a fact",
      description:
        "Owners only. Verify a fact, which lets drafts and claim checks use it and so can reach sponsors, or take the mark off. Verifying needs confirm: true after the person agrees.",
      inputSchema: mcpSetFactVerifiedSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setFactVerifiedTool(principal, args)),
  );
  server.registerTool(
    "save_template",
    {
      title: "Add or change a template",
      description:
        "Owners only. Add an email template, or change one when you send templateId. The old text is not kept. Only the placeholders {{firstName}}, {{senderName}} and {{orgName}} are allowed.",
      inputSchema: mcpSaveTemplateSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.saveTemplateTool(principal, args)),
  );
  server.registerTool(
    "set_template_archived",
    {
      title: "Archive or unarchive a template",
      description: "Owners only. Take a template out of the pickers, keeping its history in the stats, or bring it back. A template in a running experiment cannot be archived.",
      inputSchema: mcpSetTemplateArchivedSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setTemplateArchivedTool(principal, args)),
  );
  server.registerTool(
    "save_research_source",
    {
      title: "Add or rename a research source",
      description:
        "Owners only. Add a web page that research briefs may read, or rename one when you send sourceId. Coppice will fetch the page whenever a brief uses it. LinkedIn and people-search sites are refused.",
      inputSchema: mcpSaveResearchSourceSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.saveResearchSourceTool(principal, args)),
  );
  server.registerTool(
    "set_research_source_archived",
    {
      title: "Archive a research source",
      description: "Owners only. Remove a page from the approved list. Briefs that already read it keep their copy; adding the same address again brings it back.",
      inputSchema: mcpSetResearchSourceArchivedSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setResearchSourceArchivedTool(principal, args)),
  );
  server.registerTool(
    "accept_brief_item",
    {
      title: "Add a brief item to the notes",
      description:
        "Add one item of a research brief that someone already requested in Coppice to the company's notes. Needs AI on, an open company and, for officers, no one else's live claim. You cannot ask for a brief.",
      inputSchema: mcpAcceptBriefItemSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.acceptBriefItemTool(principal, args)),
  );
}

// Group S, stats and the Template Lab. The variants are written by the assistant: Coppice asks no model.
function registerStatsTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "get_stats",
    {
      title: "Template stats",
      description:
        "The numbers the stats page shows: each template's sends, replies and likely range, best and worst when the data allows, and code-computed chances, by touch, AI-drafted against hand-written, gaps, and the Template Lab experiment.",
      inputSchema: mcpGetStatsSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.getStatsTool(principal, args)),
  );
  server.registerTool(
    "start_experiment",
    {
      title: "Start a template experiment",
      description:
        "Owners only. Test one or two variants you wrote against an active template, each the template with one change. The variants become templates the whole team sees. Works with AI off. Needs confirm: true after the person agrees.",
      inputSchema: mcpStartExperimentSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.startExperimentTool(principal, args)),
  );
  server.registerTool(
    "end_experiment",
    {
      title: "End a template experiment",
      description:
        "Owners only. End the running experiment and keep one of its templates. The others are archived and the stats keep their history. It cannot be restarted. Needs confirm: true after the person agrees.",
      inputSchema: mcpEndExperimentSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.endExperimentTool(principal, args)),
  );
}

// Group H, the year-end handoff. Everything that changes it is an owner's.
function registerHandoffTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "get_handoff",
    {
      title: "Get the handoff",
      description:
        "A board year's recap numbers and its handoff. Everyone gets the published cards. Owners also get the draft with every card, where each step stands, the playbook and the re-contact calendar. Use cursor for more.",
      inputSchema: mcpGetHandoffSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.getHandoffTool(principal, args)),
  );
  server.registerTool(
    "set_departing",
    {
      title: "Mark a member as leaving",
      description: "Owners only. Mark a member as leaving next year's board, or clear the mark. Nobody loses access: it only says whose claims release_departing_claims gives back, so ask the person before marking.",
      inputSchema: mcpSetDepartingSchema,
      // Destructive because the mark feeds a release, so assistants that ask before destructive tools ask here too.
      annotations: { ...ACTION, destructiveHint: true, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setDepartingTool(principal, args)),
  );
  server.registerTool(
    "release_departing_claims",
    {
      title: "Release leaving members' claims",
      description: "Owners only. Give back every company held by members marked as leaving, live claims included. They are not told and it cannot be undone. Needs confirm: true after the person agrees. Refused when every member is marked.",
      inputSchema: mcpReleaseDepartingClaimsSchema,
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.releaseDepartingClaimsTool(principal, args)),
  );
  server.registerTool(
    "start_handoff",
    {
      title: "Start the handoff",
      description: "Owners only. Start the handoff for a board year, or pick up the one that exists. It lists the companies with outreach that year. The current year and the last five are allowed.",
      inputSchema: mcpStartHandoffSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.startHandoffTool(principal, args)),
  );
  server.registerTool(
    "build_handoff_cards",
    {
      title: "Build plain handoff cards",
      description:
        "Owners only. This makes plain cards from the facts for every company that has no card yet. After this, Coppice's AI has nothing left to read for this handoff. While AI is on it needs confirm: true after the person agrees.",
      inputSchema: mcpBuildHandoffCardsSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.buildHandoffCardsTool(principal, args)),
  );
  server.registerTool(
    "review_handoff_card",
    {
      title: "Hide, show or approve a card",
      description:
        "Owners only. Hide or show a whole card or one bullet, and approve a card so officers see it once published. Hiding is applied first. Approving cannot be undone, but a card can be hidden. Only on a draft handoff.",
      inputSchema: mcpReviewHandoffCardSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.reviewHandoffCardTool(principal, args)),
  );
  server.registerTool(
    "approve_remaining_cards",
    {
      title: "Approve the remaining cards",
      description:
        "Owners only. Approve every card that is not hidden and not yet approved, without reading them one by one. Officers see them once published. Needs confirm: true after the person agrees.",
      inputSchema: mcpApproveRemainingCardsSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.approveRemainingCardsTool(principal, args)),
  );
  server.registerTool(
    "save_recontact_dates",
    {
      title: "Save re-contact dates",
      description: "Owners only. Save planned re-contact dates for companies with an approved card, or blank them. Dates run from today to a year out. They reach companies only when applied.",
      inputSchema: mcpSaveRecontactDatesSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.saveRecontactDatesTool(principal, args)),
  );
  server.registerTool(
    "fill_blank_dates",
    {
      title: "Fill blank re-contact dates",
      description: "Owners only. Give every approved card that has no re-contact date this one date, from today to a year out. Companies that declined are left alone.",
      inputSchema: mcpFillBlankDatesSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.fillBlankDatesTool(principal, args)),
  );
  server.registerTool(
    "apply_handoff_calendar",
    {
      title: "Apply the re-contact dates",
      description:
        "Owners only. Put each saved re-contact date on its company as the next follow-up, overwriting the old one. Many companies change at once and the old dates are not kept. Needs confirm: true after the person agrees.",
      inputSchema: mcpApplyHandoffCalendarSchema,
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.applyHandoffCalendarTool(principal, args)),
  );
  server.registerTool(
    "reopen_for_next_year",
    {
      title: "Reopen a company for next year",
      description: "Owners only. Move one Committed company with an approved card back to Contacted so it can be pitched again. Marked via assistant in its history. Needs confirm: true after the person agrees.",
      inputSchema: mcpReopenForNextYearSchema,
      annotations: { ...ACTION, destructiveHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.reopenForNextYearTool(principal, args)),
  );
  server.registerTool(
    "set_handoff_published",
    {
      title: "Publish or unpublish the handoff",
      description:
        "Owners only. Publish the handoff so every member reads its approved cards, playbook and calendar, or take it back to a draft. Publishing needs at least one approved card and confirm: true after the person agrees.",
      inputSchema: mcpSetHandoffPublishedSchema,
      annotations: { ...ACTION, idempotentHint: true },
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.setHandoffPublishedTool(principal, args)),
  );
}

// Group I, CSV import from text: preview first, then run.
function registerImportTools(server: McpServer, principal: McpPrincipal) {
  server.registerTool(
    "preview_import",
    {
      title: "Preview a CSV import",
      description:
        "Check CSV text with a header row and see what an import would do: the column mapping, rows with problems, and look-alikes of saved companies. Nothing is saved. At most about 35,000 characters, fewer with accents, quotes or many short lines. Split a bigger file and import each part.",
      inputSchema: mcpPreviewImportSchema,
      annotations: READ,
    },
    (args) => tools.guarded(() => tools.previewImportTool(principal, args)),
  );
  server.registerTool(
    "run_import",
    {
      title: "Run a CSV import",
      description:
        "Add the previewed rows as companies, all or none, skipping the rows you list. Send the preview's mapping and seen unchanged. At most about 35,000 characters. Split a bigger file. No bulk undo, so it needs confirm: true after the person agrees.",
      inputSchema: mcpRunImportSchema,
      annotations: ACTION,
      scopeChallenge: needsWrite,
    },
    (args) => tools.guarded(() => tools.runImportTool(principal, args)),
  );
}
