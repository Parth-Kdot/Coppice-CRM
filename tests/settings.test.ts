import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetAndSeed } from "./helpers/seed";
import { signedInHeaders } from "./helpers/session";

// Server actions read the request with next/headers, which only exists inside Next.js.
// These mocks hand them the signed-in user's headers instead. The database is real.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  leaveWorkspace,
  removeMember,
  updateClaimWindow,
} = await import("@/app/(app)/[workspaceId]/settings/actions");

async function as(userId: string) {
  request.headers = await signedInHeaders(userId);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const roleOf = async (memberId: string) =>
  (await prisma.membership.findUnique({ where: { id: memberId }, select: { role: true } }))?.role;

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("inviteMember", () => {
  const invite = (workspaceId: string) => form({ workspaceId, email: "new@example.com", role: "member" });

  it("lets the owner invite", async () => {
    await as("ownerA");
    await expect(inviteMember(null, invite("a"))).resolves.toEqual({ ok: true, data: undefined });
    expect(await prisma.invitation.count({ where: { workspaceId: "a", email: "new@example.com" } })).toBe(1);
  });

  it("refuses an officer and another workspace's owner", async () => {
    await as("officerA");
    expect((await inviteMember(null, invite("a"))).ok).toBe(false);
    await as("ownerB");
    expect((await inviteMember(null, invite("a"))).ok).toBe(false);
    expect(await prisma.invitation.count()).toBe(0);
  });
});

describe("cancelInvitation", () => {
  beforeEach(async () => {
    await prisma.invitation.create({
      data: {
        id: "inv-a",
        workspaceId: "a",
        email: "new@example.com",
        role: "member",
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: "ownerA",
      },
    });
  });
  const statusOf = async () => (await prisma.invitation.findUnique({ where: { id: "inv-a" } }))?.status;

  it("lets the owner cancel", async () => {
    await as("ownerA");
    expect((await cancelInvitation(null, form({ workspaceId: "a", invitationId: "inv-a" }))).ok).toBe(true);
    expect(await statusOf()).toBe("canceled");
  });

  it("refuses an officer", async () => {
    await as("officerA");
    expect((await cancelInvitation(null, form({ workspaceId: "a", invitationId: "inv-a" }))).ok).toBe(false);
    expect(await statusOf()).toBe("pending");
  });

  it("refuses workspace B's owner, even passing their own workspace id", async () => {
    await as("ownerB");
    expect((await cancelInvitation(null, form({ workspaceId: "b", invitationId: "inv-a" }))).ok).toBe(false);
    expect(await statusOf()).toBe("pending");
  });
});

describe("changeMemberRole", () => {
  it("lets the owner promote an officer, which is how ownership is handed over", async () => {
    await as("ownerA");
    const result = await changeMemberRole(null, form({ workspaceId: "a", memberId: "m-officerA", role: "owner" }));
    expect(result.ok).toBe(true);
    expect(await roleOf("m-officerA")).toBe("owner");
  });

  it("refuses an officer promoting themselves", async () => {
    await as("officerA");
    const result = await changeMemberRole(null, form({ workspaceId: "a", memberId: "m-officerA", role: "owner" }));
    expect(result.ok).toBe(false);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  it("refuses workspace B's owner changing a member of A", async () => {
    await as("ownerB");
    expect((await changeMemberRole(null, form({ workspaceId: "b", memberId: "m-officerA", role: "owner" }))).ok).toBe(false);
    expect(await roleOf("m-officerA")).toBe("member");
  });

  it("refuses demoting the last owner, with workspace wording", async () => {
    await as("ownerA");
    const result = await changeMemberRole(null, form({ workspaceId: "a", memberId: "m-ownerA", role: "member" }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("workspace") });
    expect(await roleOf("m-ownerA")).toBe("owner");
  });
});

describe("removeMember", () => {
  it("lets the owner remove an officer", async () => {
    await as("ownerA");
    expect((await removeMember(null, form({ workspaceId: "a", memberId: "m-officerA" }))).ok).toBe(true);
    expect(await roleOf("m-officerA")).toBeUndefined();
  });

  it("refuses an officer removing the owner", async () => {
    await as("officerA");
    expect((await removeMember(null, form({ workspaceId: "a", memberId: "m-ownerA" }))).ok).toBe(false);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses workspace B's owner removing a member of A", async () => {
    await as("ownerB");
    expect((await removeMember(null, form({ workspaceId: "b", memberId: "m-officerA" }))).ok).toBe(false);
    expect(await roleOf("m-officerA")).toBe("member");
  });
});

describe("leaveWorkspace", () => {
  it("lets an officer leave and sends them to /workspaces", async () => {
    await as("officerA");
    // redirect() works by throwing; Next.js catches it and navigates.
    await expect(leaveWorkspace(null, form({ workspaceId: "a" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await roleOf("m-officerA")).toBeUndefined();
  });

  it("refuses the last owner", async () => {
    await as("ownerA");
    expect((await leaveWorkspace(null, form({ workspaceId: "a" }))).ok).toBe(false);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses someone who isn't a member", async () => {
    await as("ownerB");
    expect((await leaveWorkspace(null, form({ workspaceId: "a" }))).ok).toBe(false);
  });
});

describe("updateClaimWindow", () => {
  const windowOf = async (id: string) =>
    (await prisma.workspace.findUnique({ where: { id }, select: { claimWindowDays: true } }))?.claimWindowDays;

  it("starts at 14 and lets the owner set 1 to 60 days", async () => {
    expect(await windowOf("a")).toBe(14);
    await as("ownerA");
    expect((await updateClaimWindow(null, form({ workspaceId: "a", days: "1" }))).ok).toBe(true);
    expect((await updateClaimWindow(null, form({ workspaceId: "a", days: "60" }))).ok).toBe(true);
    expect(await windowOf("a")).toBe(60);
  });

  it("rejects 0, 61 and fractions", async () => {
    await as("ownerA");
    for (const days of ["0", "61", "2.5", "abc"]) {
      expect((await updateClaimWindow(null, form({ workspaceId: "a", days }))).ok).toBe(false);
    }
    expect(await windowOf("a")).toBe(14);
  });

  it("refuses an officer and another workspace's owner", async () => {
    await as("officerA");
    expect((await updateClaimWindow(null, form({ workspaceId: "a", days: "30" }))).ok).toBe(false);
    await as("ownerB");
    expect((await updateClaimWindow(null, form({ workspaceId: "a", days: "30" }))).ok).toBe(false);
    expect(await windowOf("a")).toBe(14);
  });
});
