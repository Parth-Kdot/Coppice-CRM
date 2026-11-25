import type { z } from "zod";
import { aiUsage } from "@/lib/ai/run";
import { checkRules, factNumbers, HISTORY_REASON, ruleSupport } from "@/lib/claim-rules";
import { claimSupport } from "@/lib/claim-support";
import { claimState, dbNow, dbToday } from "@/lib/claims";
import { prisma, withTenant } from "@/lib/db";
import { addFact, getFactSheet, hasMaskToken, isStale, setFactVerified, updateFact, verifiedFacts } from "@/lib/facts";
import { notFoundMessage } from "@/lib/messages";
import { fill, placeholderProblem, type Names } from "@/lib/placeholders";
import { acceptBriefItem } from "@/lib/research/accept";
import { loadBrief } from "@/lib/research/brief";
import { addSource, archiveSource, listSources, renameSource } from "@/lib/research/sources";
import { parseSourceUrl, SKIP_MESSAGES } from "@/lib/research/urls";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { activeTemplates, archiveTemplate, createTemplate, listTemplates, unarchiveTemplate, updateTemplate } from "@/lib/templates";
import { workspaceRow } from "@/lib/workspaces";
import {
  addResearchSourceSchema,
  factTextSchema,
  MCP_LIST_LIMIT,
  renameResearchSourceSchema,
  templateFieldsSchema,
  type mcpAcceptBriefItemSchema,
  type mcpListFactsSchema,
  type mcpListTemplatesSchema,
  type mcpPrepareEmailSchema,
  type mcpSaveFactSchema,
  type mcpSaveResearchSourceSchema,
  type mcpSaveTemplateSchema,
  type mcpSetFactVerifiedSchema,
  type mcpSetResearchSourceArchivedSchema,
  type mcpSetTemplateArchivedSchema,
  type mcpWorkspaceSchema,
} from "@/lib/validation";
import {
  BAD_CURSOR,
  confirmNeededLater,
  decodeCursor,
  fail,
  formCheck,
  fromResult,
  iso,
  moreFields,
  ok,
  openCompany,
  openWorkspace,
  recordActivity,
  untrusted,
  type McpPrincipal,
  type ToolResult,
} from "./shared";

// Group K, knowledge: the fact sheet, templates, an email filled in from a template and checked
// by the claim rules, research sources and the brief items a person asked for in the app. Nothing
// here asks a model for anything: facts, templates and sources are plain rows, and prepare_email
// is code (lib/placeholders.ts and lib/claim-rules.ts). Coppice sends nothing.

// ----- Facts -----

export async function listFactsTool(principal: McpPrincipal, args: z.infer<typeof mcpListFactsSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;

  // Officers get what the fact sheet page shows them and what drafts may say: verified facts.
  if (member.role !== "owner") {
    const rows = await verifiedFacts(member, offset + MCP_LIST_LIMIT + 1);
    return ok({
      facts: rows.slice(offset, offset + MCP_LIST_LIMIT).map((f) => ({ id: f.id, text: untrusted(f.text), verifiedAt: iso(f.verifiedAt) })),
      ...moreFields(rows.length > offset + MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "These are the verified facts, oldest first."),
    });
  }

  // Owners get every fact with its status, quote, page and a stale flag, and the uploaded files.
  const sheet = await getFactSheet(member);
  const now = await dbNow();
  return ok({
    facts: sheet.facts.slice(offset, offset + MCP_LIST_LIMIT).map((f) => ({
      id: f.id,
      text: untrusted(f.text),
      source: f.source,
      status: f.verifiedAt ? "verified" : "waiting",
      verifiedAt: iso(f.verifiedAt),
      verifiedBy: untrusted(f.verifiedBy?.name),
      quote: untrusted(f.quote),
      page: f.pageNumber,
      quoteFound: f.quoteFound,
      file: untrusted(f.factSheet?.fileName),
      stale: isStale(f, now),
      holdsMaskedContact: hasMaskToken(f.text),
    })),
    files: sheet.sheets.slice(0, MCP_LIST_LIMIT).map((s) => ({ id: s.id, fileName: untrusted(s.fileName), pageCount: s.pageCount, uploadedAt: iso(s.createdAt), uploadedBy: untrusted(s.uploadedBy.name) })),
    ...moreFields(sheet.facts.length > offset + MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Facts waiting for a check are listed first."),
  });
}

export async function saveFactTool(principal: McpPrincipal, args: z.infer<typeof mcpSaveFactSchema>): Promise<ToolResult> {
  const text = formCheck(factTextSchema, args.text);
  if (text.refused) return text.refused;
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // A fact an assistant adds or changes is always saved as waiting for an owner to verify it,
  // even where the app's own form would save it verified.
  const waiting = "Saved as waiting for an owner to verify it. Drafts cannot use it until an owner verifies it in Coppice or with set_fact_verified.";
  if (args.factId) {
    const result = await updateFact(member, args.factId, text.data, { unverified: true });
    const factId = args.factId;
    return fromResult(result, async () => {
      await recordActivity(principal, member, { tool: "save_fact", action: "updated", targetId: factId });
      return ok({ saved: true, factId, verified: false, note: waiting });
    });
  }
  const result = await addFact(member, text.data, { unverified: true });
  return fromResult(result, async (data) => {
    await recordActivity(principal, member, { tool: "save_fact", action: "added", targetId: data.factId });
    return ok({ saved: true, factId: data.factId, verified: false, note: waiting });
  });
}

export async function setFactVerifiedTool(principal: McpPrincipal, args: z.infer<typeof mcpSetFactVerifiedSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Already as the person wants it: nothing changes, so nothing is logged and no yes is needed.
  const fact = await withTenant(member, (tx) =>
    tx.factSheetItem.findFirst({ where: { id: args.factId, workspaceId: member.workspaceId }, select: { verifiedAt: true } }),
  );
  if (fact && (fact.verifiedAt !== null) === args.verified) return ok({ factId: args.factId, verified: args.verified, changed: false });
  // Verifying is what lets a number reach a sponsor, so it needs the person's yes. Taking the mark off does not.
  if (args.verified && args.confirm !== true) {
    return confirmNeededLater(principal, "set_fact_verified", "Verifying a fact lets drafts and claim checks use it, so what it says can reach sponsors.");
  }
  const result = await setFactVerified(member, args.factId, args.verified);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "set_fact_verified", action: args.verified ? "verified" : "unverified", targetId: args.factId });
    return ok({ factId: args.factId, verified: args.verified, changed: true });
  });
}

// ----- Templates -----

export async function listTemplatesTool(principal: McpPrincipal, args: z.infer<typeof mcpListTemplatesSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const isOwner = member.role === "owner";
  const active = await activeTemplates(member);
  // Owners also see archived templates and how often each was used, as Settings shows.
  const rows = isOwner
    ? (await listTemplates(member)).map((t) => ({ id: t.id, name: t.name, body: t.body, archived: t.archivedAt !== null, uses: t.uses, arm: active.find((a) => a.id === t.id)?.arm }))
    : active.map((t) => ({ id: t.id, name: t.name, body: t.body, archived: false, uses: undefined, arm: t.arm }));
  return ok({
    templates: rows.slice(offset, offset + MCP_LIST_LIMIT).map((t) => ({
      id: t.id,
      name: untrusted(t.name),
      body: untrusted(t.body),
      ...(isOwner ? { archived: t.archived, uses: t.uses } : {}),
      experiment: t.arm ? { experimentId: t.arm.experimentId, arm: t.arm.label, suggested: t.arm.suggested, sends: t.arm.sends } : null,
    })),
    ...moreFields(rows.length > offset + MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Templates are listed by name."),
  });
}

export async function saveTemplateTool(principal: McpPrincipal, args: z.infer<typeof mcpSaveTemplateSchema>): Promise<ToolResult> {
  // The app's own form rules: line breaks normalized, trimmed, only the three placeholders.
  const fields = formCheck(templateFieldsSchema, { name: args.name, body: args.body });
  if (fields.refused) return fields.refused;
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.templateId) {
    const templateId = args.templateId;
    const result = await updateTemplate(member, templateId, fields.data);
    return fromResult(result, async () => {
      await recordActivity(principal, member, { tool: "save_template", action: "updated", targetId: templateId });
      return ok({ saved: true, templateId });
    });
  }
  const result = await createTemplate(member, fields.data);
  return fromResult(result, async (data) => {
    await recordActivity(principal, member, { tool: "save_template", action: "added", targetId: data.templateId });
    return ok({ saved: true, templateId: data.templateId });
  });
}

export async function setTemplateArchivedTool(principal: McpPrincipal, args: z.infer<typeof mcpSetTemplateArchivedSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Already as the person wants it: nothing changes, so nothing is logged.
  const template = await withTenant(member, (tx) =>
    tx.template.findFirst({ where: { id: args.templateId, workspaceId: member.workspaceId }, select: { archivedAt: true } }),
  );
  if (template && (template.archivedAt !== null) === args.archived) return ok({ templateId: args.templateId, archived: args.archived, changed: false });
  const result = args.archived ? await archiveTemplate(member, args.templateId) : await unarchiveTemplate(member, args.templateId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "set_template_archived", action: args.archived ? "archived" : "unarchived", targetId: args.templateId });
    return ok({ templateId: args.templateId, archived: args.archived, changed: true });
  });
}

// ----- prepare_email -----

const FINDING_REASONS = {
  number: "No verified fact has this number.",
  link: "Links are not checked. Make sure it goes where you mean.",
  history: "Check this company really has a history with the organization.",
  unsupported: "Nothing in the verified facts supports this.",
} as const;

// Fills a template (or checks the assistant's own text) with the names and runs the Claim
// Checker's code rules over it, with the company's accepted research and logged history as
// support, as the draft panel does. A read: nothing is saved and nothing is sent. The person sends
// the email themselves and then logs it with log_outreach.
export async function prepareEmailTool(principal: McpPrincipal, args: z.infer<typeof mcpPrepareEmailSchema>): Promise<ToolResult> {
  if ((args.templateId === undefined) === (args.text === undefined)) return fail("Send either templateId or text, not both and not neither.");
  if (args.text !== undefined) {
    const problem = placeholderProblem(args.text);
    if (problem) return fail(problem);
  }
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId, { allowArchived: true });
  if (found.refused) return found.refused;

  let body = args.text ?? "";
  if (args.templateId !== undefined) {
    const template = (await activeTemplates(member)).find((t) => t.id === args.templateId);
    if (!template) return fail("Template not found, or it is archived. list_templates shows the active ones.");
    body = template.body;
    const problem = placeholderProblem(body);
    if (problem) return fail(problem);
  }
  const contact = args.contactId
    ? await withTenant(member, (tx) => tx.contact.findFirst({ where: { id: args.contactId, companyId: args.companyId, workspaceId: member.workspaceId }, select: { name: true } }))
    : null;
  if (args.contactId && !contact) return fail(notFoundMessage("Contact"));
  const sender = await prisma.user.findUnique({ where: { id: member.userId }, select: { name: true } });
  const workspace = await workspaceRow(member.workspaceId);
  const names: Names = { firstName: contact?.name.trim().split(/\s+/)[0] || "there", senderName: sender?.name ?? "", orgName: workspace.name };
  const text = fill(body, names);
  const facts = await verifiedFacts(member);
  const support = ruleSupport(await claimSupport(member, args.companyId, await dbToday()));
  const findings = checkRules(text, { factNumbers: factNumbers(facts), website: found.company.website, support });
  return ok({
    text: untrusted(text),
    // The generic reasons, except a history reason naming the board year they replied in, which
    // code wrote from logged rows.
    findings: findings.map((f) => ({
      kind: f.kind,
      quote: untrusted(f.quote),
      reason: f.kind === "history" && f.reason !== HISTORY_REASON ? f.reason : FINDING_REASONS[f.kind],
    })),
    note: "Coppice sends nothing. The person sends this themselves, then logs it with log_outreach.",
  });
}

// ----- Research sources -----

export async function listResearchSourcesTool(principal: McpPrincipal, args: z.infer<typeof mcpWorkspaceSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // The same visibility as Settings: owners always, officers only while AI is on for the workspace.
  if (member.role !== "owner" && !(await aiUsage(member)).enabled) {
    return ok({ sources: [], note: "Officers see the research sources only while AI is on for the workspace." });
  }
  const sources = await listSources(member);
  return ok({
    sources: sources.slice(0, MCP_LIST_LIMIT).map((s) => ({ id: s.id, url: untrusted(s.url), label: untrusted(s.label), addedBy: untrusted(s.addedBy.name), addedAt: iso(s.createdAt) })),
  });
}

export async function saveResearchSourceTool(principal: McpPrincipal, args: z.infer<typeof mcpSaveResearchSourceSchema>): Promise<ToolResult> {
  // Renaming: the app's own label rule. A source's address is never changed.
  if (args.sourceId) {
    if (args.url !== undefined) return fail("A source's address cannot be changed. Add the new address as a new source.");
    const label = formCheck(renameResearchSourceSchema.shape.label, args.label ?? "");
    if (label.refused) return label.refused;
    const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
    if (gate.refused) return gate.refused;
    const sourceId = args.sourceId;
    const result = await renameSource(gate.member, sourceId, label.data);
    return fromResult(result, async () => {
      await recordActivity(principal, gate.member, { tool: "save_research_source", action: "updated", targetId: sourceId });
      return ok({ saved: true, sourceId });
    });
  }
  if (args.url === undefined) return fail("Send the page's address in url to add a source.");
  // Adding: the address goes through parseSourceUrl, and the stored value is the parsed address.
  const checked = parseSourceUrl(args.url);
  if (!checked.ok) return fail(SKIP_MESSAGES[checked.reason]);
  const label = formCheck(addResearchSourceSchema.shape.label, args.label ?? null);
  if (label.refused) return label.refused;
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const result = await addSource(gate.member, checked.url.href, label.data);
  return fromResult(result, async (data) => {
    await recordActivity(principal, gate.member, { tool: "save_research_source", action: "added", targetId: data.sourceId });
    return ok({ saved: true, sourceId: data.sourceId, address: untrusted(checked.url.href) });
  });
}

export async function setResearchSourceArchivedTool(principal: McpPrincipal, args: z.infer<typeof mcpSetResearchSourceArchivedSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Already archived: nothing changes, so nothing is logged.
  const source = await withTenant(member, (tx) =>
    tx.researchSource.findFirst({ where: { id: args.sourceId, workspaceId: member.workspaceId }, select: { archivedAt: true } }),
  );
  if (source?.archivedAt) return ok({ sourceId: args.sourceId, archived: true, changed: false });
  const result = await archiveSource(member, args.sourceId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "set_research_source_archived", action: "archived", targetId: args.sourceId });
    return ok({ sourceId: args.sourceId, archived: true, changed: true, note: "Briefs that already read this page keep their copy. Add the same address again to bring it back." });
  });
}

// ----- Brief items -----

// "Add to notes" on an item of a brief someone asked for in the app. The assistant never asks for a
// brief (that is an AI feature); it only adds an item that is already stored. lib/research/accept.ts
// keeps its rules (AI on, not archived, the item is in that brief); the company page's own rules are
// added here: not on a closed company, and an officer not on someone else's live claim.
export async function acceptBriefItemTool(principal: McpPrincipal, args: z.infer<typeof mcpAcceptBriefItemSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId);
  if (found.refused) return found.refused;
  const { company } = found;
  if (TERMINAL_STAGES.includes(company.stage)) return fail(`This company is ${STAGE_LABELS[company.stage]}. Reopen it before adding research to its notes.`);
  if (member.role !== "owner" && claimState(company, await dbNow(), member.userId) === "theirs") {
    return fail("Someone else holds this company. Only they or an owner can add research to its notes.");
  }
  // An item that is already in the notes is accepted again without a change, so it is not logged again.
  const brief = await loadBrief(member, { id: args.briefId, companyId: args.companyId });
  const already = brief ? [...brief.items, ...brief.inboxes].some((i) => i.id === args.itemId && i.accepted) : false;
  const result = await acceptBriefItem(member, args.companyId, args.briefId, args.itemId, "ASSISTANT");
  return fromResult(result, async () => {
    if (!already) await recordActivity(principal, member, { tool: "accept_brief_item", action: "updated", companyId: args.companyId });
    return ok({ added: !already, alreadyThere: already });
  });
}
