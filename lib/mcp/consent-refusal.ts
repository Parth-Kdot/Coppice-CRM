// What the consent buttons show when Allow is refused (components/oauth-consent.tsx). The auth
// client hands back the body of the server's answer together with its status.
// - The sentence for the cap on assistants that came from a metadata document (400 invalid_request,
//   lib/mcp/cimd-budget.ts) is shown as the server wrote it.
// - A 429 means Coppice is too busy fetching assistants' details just now.
// - Anything else is shown as an expired request.
export type ConsentRefusal = { status?: number; error?: string; error_description?: string };

export function consentRefusalText(refused: ConsentRefusal | null | undefined): string {
  if (refused?.error === "invalid_request" && refused.error_description?.startsWith("You have connected ")) return refused.error_description;
  if (refused?.status === 429) return "Coppice is busy connecting assistants right now. Wait a minute, then try again.";
  return "This request has expired. Go back to your assistant and connect again.";
}
