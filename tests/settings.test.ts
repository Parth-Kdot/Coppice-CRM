import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  removeMember,
  updateClaimWindow,
} from "@/app/(app)/[workspaceId]/settings/actions";
import { checkMembership } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { form, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { invite, ownerCount, resetAndSeed, roleOf } from "./helpers/seed";

// Real server actions, real database. Only Next.js's request APIs are swapped for test ones.
vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const NOT_OK = { ok: false, error: expect.any(String) };
const OK = { ok: true, data: undefined };

// Seed: workspace "a" (ownerA owner, officerA officer) and "b" (ownerB owner).
beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeOfficerAOwner() {
  await prisma.membership.update({ where: { id: "m-officerA" }, data: { role: "owner" } });
}

describe("every settings action when signed out", () => {
  test.for([
    ["inviteMember", () => inviteMember(null, form({ workspaceId: "a", email: "x@example.com", role: "member" }))],
    ["cancelInvitation", () => cancelInvitation(null, form({ workspaceId: "a", invitationId: "inv" }))],
    ["changeMemberRole", () => changeMemberRole(null, form({ workspaceId: "a", memberId: "m-officerA", role: "owner" }))],
    ["removeMember", () => removeMember(null, form({ workspaceId: "a", memberId: "m-officerA" }))],
    ["leaveWorkspace", () => leaveWorkspace(null, form({ workspaceId: "a" }))],
    ["updateClaimWindow", () => updateClaimWindow(null, form({ workspaceId: "a", days: "30" }))],
  ] as const)("%s sends you to /signin and changes nothing", async ([, run]) => {
    await expect(signedOut(run)).rejects.toEqual(redirectTo("/signin"));
    expect(await roleOf("m-officerA")).toBe("member");
    expect(await prisma.invitation.count()).toBe(0);
  });
});

describe("inviteMember", () => {
  const invite = (fields: Record<string, string>) =>
    inviteMember(null, form({ workspaceId: "a", email: "new@example.com", role: "member", ...fields }));

  it("lets the owner invite an officer", async () => {
    expect(await asUser("ownerA", () => invite({}))).toEqual(OK);
    expect(await prisma.invitation.findFirst({ select: { email: true, role: true, status: true } })).toEqual({
      email: "new@example.com",
      role: "member",
      status: "pending",
    });
  });

  it("lets the owner invite another owner", async () => {
    expect(await asUser("ownerA", () => invite({ role: "owner" }))).toEqual(OK);
    expect((await prisma.invitation.findFirst())?.role).toBe("owner");
  });

  it("stores the email trimmed and lowercased", async () => {
    await asUser("ownerA", () => invite({ email: "  New.Person@Example.COM " }));
    expect((await prisma.invitation.findFirst())?.email).toBe("new.person@example.com");
  });

  test.for([
    ["a bad email", { email: "not-an-email" }],
    ["an empty email", { email: "" }],
    ["an unknown role", { role: "admin" }],
    ["a missing workspace id", { workspaceId: "" }],
  ] as const)("rejects %s", async ([, fields]) => {
    expect(await asUser("ownerA", () => invite(fields))).toEqual(NOT_OK);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("re-inviting the same email replaces the old invitation instead of stacking", async () => {
    await asUser("ownerA", () => invite({}));
    await asUser("ownerA", () => invite({}));
    expect(await prisma.invitation.count({ where: { status: "pending" } })).toBe(1);
  });

  it("refuses inviting someone who is already a member", async () => {
    expect(await asUser("ownerA", () => invite({ email: "officerA@example.com" }))).toEqual(NOT_OK);
  });

  it("refuses an officer, even inviting an officer", async () => {
    expect(await asUser("officerA", () => invite({}))).toEqual(NOT_OK);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("refuses another workspace's owner", async () => {
    expect(await asUser("ownerB", () => invite({}))).toEqual(NOT_OK);
    expect(await prisma.invitation.count()).toBe(0);
  });
});

describe("cancelInvitation", () => {
  beforeEach(() => invite({ id: "inv-a", email: "new@example.com" }));
  const statusOf = async () => (await prisma.invitation.findUnique({ where: { id: "inv-a" } }))?.status;
  const cancel = (fields: Record<string, string> = {}) =>
    cancelInvitation(null, form({ workspaceId: "a", invitationId: "inv-a", ...fields }));

  it("lets the owner cancel", async () => {
    expect(await asUser("ownerA", () => cancel())).toEqual(OK);
    expect(await statusOf()).toBe("canceled");
  });

  it("refuses an officer", async () => {
    expect(await asUser("officerA", () => cancel())).toEqual(NOT_OK);
    expect(await statusOf()).toBe("pending");
  });

  it("refuses workspace B's owner, even passing their own workspace id", async () => {
    expect(await asUser("ownerB", () => cancel({ workspaceId: "b" }))).toEqual(NOT_OK);
    expect(await statusOf()).toBe("pending");
  });

  it("returns an error for an invitation that doesn't exist", async () => {
    expect(await asUser("ownerA", () => cancel({ invitationId: "nope" }))).toEqual(NOT_OK);
  });

  it("returns an error for missing ids instead of crashing", async () => {
    expect(await asUser("ownerA", () => cancel({ invitationId: "" }))).toEqual({
      ok: false,
      error: "Invitation not found.",
    });
  });

  it("cancelling twice leaves it cancelled", async () => {
    await asUser("ownerA", () => cancel());
    const second = await asUser("ownerA", () => cancel());
    expect(second.ok === true || second.ok === false).toBe(true);
    expect(await statusOf()).toBe("canceled");
  });
});

describe("changeMemberRole", () => {
  const change = (memberId: string, role: string, workspaceId = "a") =>
    changeMemberRole(null, form({ workspaceId, memberId, role }));

  it("hands ownership over: promote the officer, then the old owner steps down", async () => {
    expect(await asUser("ownerA", () => change("m-officerA", "owner"))).toEqual(OK);
    expect(await asUser("ownerA", () => change("m-ownerA", "member"))).toEqual(OK);
    expect(await roleOf("m-officerA")).toBe("owner");
    expect(await roleOf("m-ownerA")).toBe("member");
    expect(await ownerCount("a")).toBe(1);
  });

  it("setting the role someone already has is harmless", async () => {
    expect(await asUser("ownerA", () => change("m-officerA", "member"))).toEqual(OK);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  it("refuses an officer promoting themselves", async () => {
    expect(await asUser("officerA", () => change("m-officerA", "owner"))).toEqual(NOT_OK);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  it("refuses an officer demoting the owner", async () => {
    expect(await asUser("officerA", () => change("m-ownerA", "member"))).toEqual(NOT_OK);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses workspace B's owner changing a member of A", async () => {
    expect(await asUser("ownerB", () => change("m-officerA", "owner", "b"))).toEqual(NOT_OK);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  it("refuses demoting the last owner, with workspace wording", async () => {
    const result = await asUser("ownerA", () => change("m-ownerA", "member"));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("workspace") });
    expect(result.ok === false && result.error).not.toMatch(/organization/i);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  test.for([
    ["an unknown role", "m-officerA", "admin"],
    ["a member id that doesn't exist", "nope", "owner"],
    ["an empty member id", "", "owner"],
  ] as const)("rejects %s", async ([, memberId, role]) => {
    expect(await asUser("ownerA", () => change(memberId, role))).toEqual(NOT_OK);
    expect(await roleOf("m-officerA")).toBe("member");
  });
});

describe("removeMember", () => {
  const remove = (memberId: string, workspaceId = "a") => removeMember(null, form({ workspaceId, memberId }));

  it("lets the owner remove an officer, who loses access immediately", async () => {
    expect(await asUser("ownerA", () => remove("m-officerA"))).toEqual(OK);
    expect(await roleOf("m-officerA")).toBeUndefined();
    await expect(checkMembership("officerA", "a")).rejects.toThrow();
    expect(await asUser("officerA", () => leaveWorkspace(null, form({ workspaceId: "a" })))).toEqual(NOT_OK);
  });

  it("lets an owner remove another owner when two owners remain", async () => {
    await makeOfficerAOwner();
    expect(await asUser("ownerA", () => remove("m-officerA"))).toEqual(OK);
    expect(await ownerCount("a")).toBe(1);
  });

  it("refuses the last owner removing themselves", async () => {
    expect(await asUser("ownerA", () => remove("m-ownerA"))).toEqual(NOT_OK);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses an officer removing the owner", async () => {
    expect(await asUser("officerA", () => remove("m-ownerA"))).toEqual(NOT_OK);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses workspace B's owner removing a member of A", async () => {
    expect(await asUser("ownerB", () => remove("m-officerA", "b"))).toEqual(NOT_OK);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  test.for([
    ["a member id that doesn't exist", "nope"],
    ["an empty member id", ""],
  ] as const)("rejects %s", async ([, memberId]) => {
    expect(await asUser("ownerA", () => remove(memberId))).toEqual(NOT_OK);
  });
});

describe("leaveWorkspace", () => {
  const leave = (workspaceId = "a") => leaveWorkspace(null, form({ workspaceId }));

  it("lets an officer leave and sends them to /workspaces", async () => {
    await expect(asUser("officerA", () => leave())).rejects.toEqual(redirectTo("/workspaces"));
    expect(await roleOf("m-officerA")).toBeUndefined();
  });

  it("lets an owner leave when another owner remains", async () => {
    await makeOfficerAOwner();
    await expect(asUser("ownerA", () => leave())).rejects.toEqual(redirectTo("/workspaces"));
    expect(await ownerCount("a")).toBe(1);
  });

  it("refuses the last owner", async () => {
    expect(await asUser("ownerA", () => leave())).toEqual(NOT_OK);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses someone who isn't a member", async () => {
    expect(await asUser("ownerB", () => leave())).toEqual(NOT_OK);
  });

  it("rejects a missing workspace id", async () => {
    expect(await asUser("officerA", () => leave(""))).toEqual({ ok: false, error: "Workspace not found." });
  });
});

describe("updateClaimWindow", () => {
  const windowOf = async (id: string) =>
    (await prisma.workspace.findUnique({ where: { id }, select: { claimWindowDays: true } }))?.claimWindowDays;
  const update = (days: string, workspaceId = "a") => updateClaimWindow(null, form({ workspaceId, days }));

  it("starts at 14 days", async () => {
    expect(await windowOf("a")).toBe(14);
  });

  test.for([
    ["1", 1],
    ["60", 60],
    ["30", 30],
    [" 30 ", 30],
  ] as const)("accepts %j as %i days", async ([days, expected]) => {
    expect(await asUser("ownerA", () => update(days))).toEqual(OK);
    expect(await windowOf("a")).toBe(expected);
  });

  test.for(["0", "61", "-5", "2.5", "abc", ""])("rejects %j", async (days) => {
    expect(await asUser("ownerA", () => update(days))).toEqual(NOT_OK);
    expect(await windowOf("a")).toBe(14);
  });

  it("refuses an officer", async () => {
    expect(await asUser("officerA", () => update("30"))).toEqual(NOT_OK);
    expect(await windowOf("a")).toBe(14);
  });

  it("refuses another workspace's owner, and leaves their own workspace alone", async () => {
    expect(await asUser("ownerB", () => update("30"))).toEqual(NOT_OK);
    expect(await windowOf("a")).toBe(14);
    expect(await windowOf("b")).toBe(14);
  });
});
