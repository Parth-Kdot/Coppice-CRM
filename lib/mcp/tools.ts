// What each MCP tool does lives in lib/mcp/tools/, one file for each group (lib/mcp/server.ts
// registers them in the same order):
//
//   shared.ts      the gate (openWorkspace), results (ok, fail, refusedBy, untrusted), guarded, the
//                  confirm and owner helpers, cursors and the activity recorder
//   workspace.ts   Group W: list_workspaces, get_workspace, list_members
//   companies.ts   Group C: companies, the queue, claims, outreach, stages and previous versions
//   contacts.ts    Group P: contacts and permanent deletes
//   knowledge.ts   Group K: facts, templates, prepare_email, research sources, brief items
//   stats.ts       Group S: stats and experiments
//   handoff.ts     Group H: the year-end handoff
//   import.ts      Group I: CSV import
//
// Every tool that touches a workspace goes through openWorkspace first: the person's rate limit,
// the same membership check as requireMembership, and the workspace's MCP switch. Reads then run
// inside withTenant, so row-level security applies too. Tools call lib functions (never server
// actions), so every rule the app keeps holds for assistants as well. Claims, outreach and stage
// moves are recorded with via = ASSISTANT, and every change an assistant makes also writes one
// AssistantActivity row that Settings lists for every member. This file only re-exports, so
// imports of "@/lib/mcp/tools" keep working.

export * from "./tools/shared";
export * from "./tools/workspace";
export * from "./tools/companies";
export * from "./tools/contacts";
export * from "./tools/knowledge";
export * from "./tools/stats";
export * from "./tools/handoff";
export * from "./tools/import";
