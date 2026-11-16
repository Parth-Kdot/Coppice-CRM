import { McpServer, requireScopes } from "@modelcontextprotocol/server";
import { READ_SCOPE, WRITE_SCOPE } from "@/lib/mcp/config";
import * as tools from "@/lib/mcp/tools";
import type { McpPrincipal } from "@/lib/mcp/tools";
import {
  mcpChangeStageSchema,
  mcpCompanySchema,
  mcpListCompaniesSchema,
  mcpListMembersSchema,
  mcpListMyClaimsSchema,
  mcpLogOutreachSchema,
  mcpQueueSchema,
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
        "One company with its notes, contacts, outreach history, stage history, look-alikes and, while AI is on, its latest stored research brief and your recent drafts.",
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
