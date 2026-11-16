import type { z } from "zod";
import { addContact, removeContact, updateContact } from "@/lib/companies";
import { withTenant } from "@/lib/db";
import { deleteFact, deleteFactSheet } from "@/lib/facts";
import { notFoundMessage } from "@/lib/messages";
import { contactFieldsSchema, type mcpDeletePermanentlySchema, type mcpSaveContactSchema } from "@/lib/validation";
import { confirmNeeded, confirmNeededLater, fail, formCheck, fromResult, ok, openCompany, openWorkspace, recordActivity, type McpPrincipal, type ToolResult } from "./shared";

// Group P, contacts: add or change a contact, and the one tool for every permanent delete. A
// contact lives under a company, so both tools check the company first: it must be in the
// workspace and not archived (the app hides these controls on an archived company), and a contact
// must belong to the company the assistant named, which lib/companies.ts does not check itself.

export async function saveContactTool(principal: McpPrincipal, args: z.infer<typeof mcpSaveContactSchema>): Promise<ToolResult> {
  if (!args.contactId && args.name === undefined) return fail("Send the contact's name to add a contact.");
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId);
  if (found.refused) return found.refused;

  if (!args.contactId) {
    // The app's own form rules: trimmed, a valid address, an empty box is none.
    const fields = formCheck(contactFieldsSchema, { name: args.name, email: args.email ?? null, title: args.title ?? null });
    if (fields.refused) return fields.refused;
    const result = await addContact(member, args.companyId, fields.data);
    return fromResult(result, async (data) => {
      await recordActivity(principal, member, { tool: "save_contact", action: "added", companyId: args.companyId, targetId: data.contactId });
      return ok({ saved: true, contactId: data.contactId });
    });
  }

  const current = await withTenant(member, (tx) =>
    tx.contact.findFirst({ where: { id: args.contactId, companyId: args.companyId, workspaceId: member.workspaceId }, select: { name: true, email: true, title: true } }),
  );
  if (!current) return fail(notFoundMessage("Contact"));
  // A change keeps every field the assistant left out; an empty string clears email or title.
  const fields = formCheck(contactFieldsSchema, {
    name: args.name ?? current.name,
    email: args.email ?? current.email,
    title: args.title ?? current.title,
  });
  if (fields.refused) return fields.refused;
  if (fields.data.name === current.name && fields.data.email === current.email && fields.data.title === current.title) {
    return ok({ saved: true, changed: false, contactId: args.contactId });
  }
  // Only the fields the assistant sent are written, so a field someone else changed since the read
  // above keeps its value and its previous version.
  const result = await updateContact(
    member,
    args.contactId,
    {
      name: args.name !== undefined ? fields.data.name : undefined,
      email: args.email !== undefined ? fields.data.email : undefined,
      title: args.title !== undefined ? fields.data.title : undefined,
    },
    "ASSISTANT",
  );
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "save_contact", action: "updated", companyId: args.companyId, targetId: args.contactId });
    return ok({ saved: true, changed: true, contactId: args.contactId });
  });
}

const WHAT: Record<z.infer<typeof mcpDeletePermanentlySchema>["what"], string> = {
  contact: "Deleting a contact removes their name, email and title for good.",
  fact: "Deleting a fact removes it for good. A fact read from a packet can only come back by uploading the packet again.",
  fact_sheet:
    "Deleting an uploaded packet removes its page text and every fact read from it, verified ones included. Facts typed by hand stay. It can only come back by uploading the file again and verifying the facts again.",
};

export async function deletePermanentlyTool(principal: McpPrincipal, args: z.infer<typeof mcpDeletePermanentlySchema>): Promise<ToolResult> {
  // A contact needs no database read to ask first, so asking costs nothing. Facts and packets are
  // owner only: the gate and the owner check come first, then the question (the counted call is given back).
  if (args.what === "contact" && args.confirm !== true) return confirmNeeded("delete_permanently", WHAT.contact);
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: args.what !== "contact" });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) return confirmNeededLater(principal, "delete_permanently", WHAT[args.what]);

  if (args.what === "contact") {
    const contact = await withTenant(member, (tx) => tx.contact.findFirst({ where: { id: args.id, workspaceId: member.workspaceId }, select: { companyId: true } }));
    if (!contact) return fail(notFoundMessage("Contact"));
    const found = await openCompany(member, contact.companyId);
    if (found.refused) return found.refused;
    const result = await removeContact(member, args.id);
    return fromResult(result, async () => {
      await recordActivity(principal, member, { tool: "delete_permanently", action: "deleted_contact", companyId: contact.companyId, targetId: args.id });
      return ok({ deleted: "contact" });
    });
  }
  const result = args.what === "fact" ? await deleteFact(member, args.id) : await deleteFactSheet(member, args.id);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "delete_permanently", action: args.what === "fact" ? "deleted_fact" : "deleted_fact_sheet", targetId: args.id });
    return ok({ deleted: args.what });
  });
}
