// Member roles, with no server imports so client code can use them too. Better Auth's built-in role
// names are "owner" and "member"; the UI shows "member" as Officer.
export type Role = "owner" | "member";

// The role a stored role string means. Only the exact word "owner" is an owner, which is the rule
// lib/authz.ts enforces on every request.
export const toRole = (raw: string): Role => (raw === "owner" ? "owner" : "member");

export function roleLabel(role: Role): string {
  return role === "owner" ? "Owner" : "Officer";
}
