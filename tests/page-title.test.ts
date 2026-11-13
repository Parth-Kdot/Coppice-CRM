import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { loadWorkspace, workspaceName } from "@/app/(app)/[workspaceId]/load-workspace";
import { pageTitle } from "@/app/(app)/[workspaceId]/page-title";
import { archiveCompany, createCompany } from "@/lib/companies";
import { prisma } from "@/lib/db";
import { notFoundError, redirectTo } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));

const OWNER = { userId: "ownerA", workspaceId: "a", role: "owner" } as const;

beforeEach(resetAndSeed);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("tab titles", () => {
  it("name the page and the workspace", async () => {
    expect(await asUser("officerA", () => pageTitle("a", "Board"))).toEqual({ title: { absolute: "Board, Org A" } });
    expect(await asUser("ownerB", () => pageTitle("b", "Settings"))).toEqual({ title: { absolute: "Settings, Org B" } });
  });

  it("read only the workspace's name", async () => {
    expect(await asUser("officerA", () => workspaceName("a"))).toBe("Org A");
  });

  test.for(["b", "does-not-exist"])("show the same 404 for workspace %s as every other page, so ids can't be probed", async (id) => {
    await expect(asUser("officerA", () => pageTitle(id, "Board"))).rejects.toEqual(notFoundError);
  });

  it("send a signed-out visitor to /signin", async () => {
    await expect(signedOut(() => pageTitle("a", "Board"))).rejects.toEqual(redirectTo("/signin"));
  });
});

describe("loadWorkspace", () => {
  it("says whether the workspace has an active company, and an archived one does not count", async () => {
    expect((await asUser("ownerA", () => loadWorkspace("a"))).counts.companies).toBe(0);
    const made = await createCompany(OWNER, { name: "Globex" });
    if (made.status !== "saved") throw new Error("flagged");
    expect((await asUser("ownerA", () => loadWorkspace("a"))).counts.companies).toBe(1);
    expect((await archiveCompany(OWNER, made.companyId)).ok).toBe(true);
    expect((await asUser("ownerA", () => loadWorkspace("a"))).counts.companies).toBe(0);
  });

  it("returns the workspace, the person's role and the switcher's workspaces", async () => {
    const loaded = await asUser("officerA", () => loadWorkspace("a"));
    expect(loaded.workspace).toMatchObject({ name: "Org A", aiEnabled: false });
    expect(loaded.membership).toMatchObject({ userId: "officerA", workspaceId: "a", role: "member" });
    expect(loaded.workspaces).toEqual([{ id: "a", name: "Org A", role: "Officer" }]);
  });

  test.for(["b", "does-not-exist"])("shows a 404 for workspace %s", async (id) => {
    await expect(asUser("officerA", () => loadWorkspace(id))).rejects.toEqual(notFoundError);
  });
});
