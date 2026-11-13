import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { changeMemberRole, leaveWorkspace } from "@/app/(app)/[workspaceId]/settings/actions";
import { LAST_OWNER_MESSAGE } from "@/lib/action-failure";
import { prisma } from "@/lib/db";
import { form } from "./helpers/form";
import { asUser } from "./helpers/next-request";
import { ownerCount, resetAndSeed, roleOf } from "./helpers/seed";

// The membership_keep_an_owner trigger (prisma/migrations/*_keep_an_owner) guarantees every
// workspace keeps at least one owner, even when two changes race.
vi.mock("next/headers", () => import("./helpers/next-request"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const ROUNDS = 20;
// Each round is a real race against the database, so 20 rounds usually take under a second but
// can pass Vitest's default 5 seconds on a busy machine or CI runner. A slow run isn't a failure;
// a wrong result is.
const RACE_TIMEOUT = 20_000;

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

// Workspace "a" with two owners: ownerA and officerA (promoted).
async function twoOwners() {
  await prisma.membership.update({ where: { id: "m-officerA" }, data: { role: "owner" } });
}

describe("the database itself", () => {
  it("refuses demoting the last owner, even bypassing the app", async () => {
    await expect(
      prisma.membership.update({ where: { id: "m-ownerA" }, data: { role: "member" } }),
    ).rejects.toThrow(LAST_OWNER_MESSAGE);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses deleting the last owner's membership", async () => {
    await expect(prisma.membership.delete({ where: { id: "m-ownerA" } })).rejects.toThrow(LAST_OWNER_MESSAGE);
    expect(await roleOf("m-ownerA")).toBe("owner");
  });

  it("refuses deleting a user who is the last owner of a workspace (fails closed)", async () => {
    await expect(prisma.user.delete({ where: { id: "ownerA" } })).rejects.toThrow(LAST_OWNER_MESSAGE);
  });

  it("allows changes that keep an owner: officers leaving, and one of two owners stepping down", async () => {
    await prisma.membership.delete({ where: { id: "m-officerA" } });
    await prisma.membership.create({
      data: { id: "m-officerA", workspaceId: "a", userId: "officerA", role: "owner", createdAt: new Date() },
    });
    await prisma.membership.update({ where: { id: "m-ownerA" }, data: { role: "member" } });
    expect(await ownerCount("a")).toBe(1);
  });

  it("still lets a whole workspace be deleted along with its memberships", async () => {
    await prisma.workspace.delete({ where: { id: "a" } });
    expect(await prisma.membership.count({ where: { workspaceId: "a" } })).toBe(0);
  });

  it(`two owners stepping down at the same instant: one always stays (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await twoOwners();
      const results = await Promise.allSettled([
        prisma.membership.update({ where: { id: "m-ownerA" }, data: { role: "member" } }),
        prisma.membership.update({ where: { id: "m-officerA" }, data: { role: "member" } }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ownerCount("a")).toBe(1);
      await prisma.membership.updateMany({ where: { workspaceId: "a" }, data: { role: "owner" } });
      await prisma.membership.update({ where: { id: "m-officerA" }, data: { role: "member" } });
    }
  }, RACE_TIMEOUT);
});

describe("through the app's actions", () => {
  const stepDown = (userId: string, memberId: string) =>
    asUser(userId, () => changeMemberRole(null, form({ workspaceId: "a", memberId, role: "member" })));
  const leave = (userId: string) => asUser(userId, () => leaveWorkspace(null, form({ workspaceId: "a" })));

  it(`two owners demoting themselves at once: exactly one succeeds (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetAndSeed();
      await twoOwners();
      const results = await Promise.all([stepDown("ownerA", "m-ownerA"), stepDown("officerA", "m-officerA")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      // The loser gets a readable message, never a crash.
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: expect.stringContaining("owner") });
      expect(await ownerCount("a")).toBe(1);
    }
  }, RACE_TIMEOUT);

  it(`two owners leaving at once: one owner always stays (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await resetAndSeed();
      await twoOwners();
      // A successful leave redirects (throws NEXT_REDIRECT); a refused one returns ok: false.
      const results = await Promise.allSettled([leave("ownerA"), leave("officerA")]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(await ownerCount("a")).toBe(1);
    }
  }, RACE_TIMEOUT);
});
