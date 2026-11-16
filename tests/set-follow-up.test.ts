import { afterAll, beforeEach, describe, expect, it, test, vi } from "vitest";
import { setFollowUp as setFollowUpAction } from "@/app/(app)/[workspaceId]/companies/actions";
import type { Membership } from "@/lib/authz";
import { claimCompany, dbToday, FOLLOW_UP_RANGE_MESSAGE, isCalendarDate, logOutreach, setFollowUp } from "@/lib/claims";
import { archiveCompany, createCompany } from "@/lib/companies";
import { addDays, localMidnight } from "@/lib/dates";
import { prisma, withTenant } from "@/lib/db";
import { form } from "./helpers/form";
import { asUser, signedOut } from "./helpers/next-request";
import { resetAndSeed } from "./helpers/seed";

vi.mock("next/headers", () => import("./helpers/next-request"));
// A spy, so a test can check which pages the action refreshes.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

// setFollowUp (lib/claims.ts) against the real database as app_user: only the next follow-up date
// changes, and only where the app lets that person change it.
const OWNER: Membership = { userId: "ownerA", workspaceId: "a", role: "owner" };
const OFFICER: Membership = { userId: "officerA", workspaceId: "a", role: "member" };
const OTHER_ORG: Membership = { userId: "ownerB", workspaceId: "b", role: "owner" };

async function company(name = "Acme", owner: Membership = OWNER) {
  const result = await createCompany(owner, { name });
  if (result.status !== "saved") throw new Error("seed company flagged");
  return result.companyId;
}

const row = (id: string, who: Membership = OWNER) =>
  withTenant(who, (tx) =>
    tx.company.findUniqueOrThrow({
      where: { id },
      select: { stage: true, claimedById: true, claimExpiresAt: true, lastContactedAt: true, nextFollowUpAt: true, updatedAt: true },
    }),
  );
const counts = (who: Membership = OWNER) => withTenant(who, async (tx) => ({ outreach: await tx.outreach.count(), changes: await tx.stageChange.count() }));
const expireClaim = (id: string) =>
  withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() - interval '1 minute' WHERE id = ${id}`);
const setStage = (id: string, stage: string) => withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET stage = ${stage}::"Stage" WHERE id = ${id}`);

let today: string;
beforeEach(async () => {
  await resetAndSeed();
  revalidatePath.mockClear();
  today = await dbToday();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setFollowUp", () => {
  it("sets the date as midnight in West Lafayette, and nothing else", async () => {
    const id = await company();
    const before = await row(id);
    const on = addDays(today, 9);
    const result = await setFollowUp(OFFICER, id, on);
    expect(result).toEqual({ ok: true, data: { nextFollowUpAt: localMidnight(on) } });
    const after = await row(id);
    expect(after.nextFollowUpAt).toEqual(localMidnight(on));
    // No claim, no renewed claim, no contact, no history, no outreach.
    expect(after).toMatchObject({ stage: before.stage, claimedById: null, claimExpiresAt: null, lastContactedAt: null });
    expect(await counts()).toEqual({ outreach: 0, changes: 0 });
  });

  it("stores the same moment logOutreach stores for the same date", async () => {
    const a = await company("Via log");
    const b = await company("Via follow-up");
    const on = addDays(today, 20);
    await claimCompany(OFFICER, a);
    expect((await logOutreach(OFFICER, a, { channel: "EMAIL", note: null, followUpOn: on })).ok).toBe(true);
    await setFollowUp(OFFICER, b, on);
    expect((await row(a)).nextFollowUpAt).toEqual((await row(b)).nextFollowUpAt);
  });

  it("does not renew a claim you hold, and leaves your claim in place", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await withTenant(OWNER, (tx) => tx.$executeRaw`UPDATE "Company" SET "claimExpiresAt" = now() + interval '1 day' WHERE id = ${id}`);
    const claimBefore = (await row(id)).claimExpiresAt;
    expect((await setFollowUp(OFFICER, id, addDays(today, 3))).ok).toBe(true);
    const after = await row(id);
    expect(after.claimExpiresAt).toEqual(claimBefore);
    expect(after.claimedById).toBe("officerA");
    expect(after.lastContactedAt).toBeNull();
  });

  it("is refused under someone else's live claim, and writes nothing", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const before = await row(id);
    const result = await setFollowUp(OWNER, id, addDays(today, 3));
    // Owners are not exempt: only the holder reschedules.
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^officerA holds this company until [A-Z][a-z]{2} \d{1,2}\.$/) });
    expect(await row(id)).toEqual(before);
    expect(await counts()).toEqual({ outreach: 0, changes: 0 });
  });

  it("is allowed on an expired claim, and does not take it over", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    await expireClaim(id);
    const on = addDays(today, 5);
    expect((await setFollowUp(OWNER, id, on)).ok).toBe(true);
    const after = await row(id);
    expect(after.nextFollowUpAt).toEqual(localMidnight(on));
    expect(after.claimedById).toBe("officerA");
  });

  it("is allowed for the holder, and for you on your own expired claim", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    expect((await setFollowUp(OFFICER, id, addDays(today, 2))).ok).toBe(true);
    await expireClaim(id);
    expect((await setFollowUp(OFFICER, id, addDays(today, 4))).ok).toBe(true);
    expect((await row(id)).nextFollowUpAt).toEqual(localMidnight(addDays(today, 4)));
  });

  it("is refused on an archived company", async () => {
    const id = await company();
    await archiveCompany(OWNER, id);
    const result = await setFollowUp(OWNER, id, addDays(today, 3));
    expect(result).toEqual({ ok: false, error: "Company not found." });
    expect((await row(id)).nextFollowUpAt).toBeNull();
  });

  test.for(["COMMITTED", "DECLINED"] as const)("is refused on a %s company", async (stage) => {
    const id = await company();
    await setStage(id, stage);
    const result = await setFollowUp(OWNER, id, addDays(today, 3));
    expect(result).toEqual({ ok: false, error: `This company is ${stage === "COMMITTED" ? "Committed" : "Declined"}, so its follow-up can't change.` });
    expect((await row(id)).nextFollowUpAt).toBeNull();
  });

  it("refuses a company id from another workspace, and leaves that company alone", async () => {
    const theirs = await company("Theirs", OTHER_ORG);
    const before = await row(theirs, OTHER_ORG);
    expect(await setFollowUp(OWNER, theirs, addDays(today, 3))).toEqual({ ok: false, error: "Company not found." });
    expect(await row(theirs, OTHER_ORG)).toEqual(before);
  });

  it("refuses an id that matches no company", async () => {
    expect(await setFollowUp(OWNER, "nope", addDays(today, 3))).toEqual({ ok: false, error: "Company not found." });
  });

  test.for<[string, () => string]>([
    ["yesterday", () => addDays(today, -1)],
    ["more than a year out", () => addDays(today, 366)],
    ["not a date", () => "next friday"],
    ["a day that doesn't exist", () => "2027-02-30"],
    ["a month that doesn't exist", () => "2027-13-01"],
    ["a date with the wrong shape", () => "11/21/2027"],
    ["an empty string", () => ""],
  ])("refuses a date that is %s, and writes nothing", async ([, make]) => {
    const id = await company();
    const before = await row(id);
    expect(await setFollowUp(OWNER, id, make())).toEqual({ ok: false, error: FOLLOW_UP_RANGE_MESSAGE });
    expect(await row(id)).toEqual(before);
  });

  it("accepts today and a year from today, the same range logOutreach allows", async () => {
    const id = await company();
    expect((await setFollowUp(OWNER, id, today)).ok).toBe(true);
    expect((await setFollowUp(OWNER, id, addDays(today, 365))).ok).toBe(true);
    expect(await setFollowUp(OWNER, id, addDays(today, 366))).toEqual({ ok: false, error: FOLLOW_UP_RANGE_MESSAGE });
  });

  it("two people setting different dates at once leave one of them standing", async () => {
    const id = await company();
    const [x, y] = await Promise.all([setFollowUp(OWNER, id, addDays(today, 6)), setFollowUp(OFFICER, id, addDays(today, 7))]);
    expect(x.ok && y.ok).toBe(true);
    const stored = (await row(id)).nextFollowUpAt;
    expect([localMidnight(addDays(today, 6)), localMidnight(addDays(today, 7))].map((d) => d.getTime())).toContain(stored!.getTime());
  });
});

describe("isCalendarDate", () => {
  test.for([
    ["2026-11-13", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2027-04-31", false],
    ["2027-1-1", false],
    ["2027-11-13T00:00:00Z", false],
    [" 2027-11-13", false],
  ] as const)("%s is %s", ([text, expected]) => {
    expect(isCalendarDate(text)).toBe(expected);
  });
});

describe("the setFollowUp server action", () => {
  const send = (user: string, fields: Record<string, string>) => asUser(user, () => setFollowUpAction(null, form(fields)));

  it("sets the date for a member and refreshes the pages that show it", async () => {
    const id = await company();
    const on = addDays(today, 12);
    expect(await send("officerA", { workspaceId: "a", companyId: id, followUpOn: on })).toEqual({ ok: true, data: undefined });
    expect((await row(id)).nextFollowUpAt).toEqual(localMidnight(on));
    expect(revalidatePath).toHaveBeenCalledWith(`/a/companies/${id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/a");
  });

  it("checks the form with Zod before anything else", async () => {
    const id = await company();
    expect(await send("officerA", { workspaceId: "a", companyId: id, followUpOn: "tomorrow" })).toEqual({ ok: false, error: "Pick a follow-up date." });
    expect(await send("officerA", { workspaceId: "a", companyId: "", followUpOn: addDays(today, 1) })).toMatchObject({ ok: false });
  });

  it("refuses someone who isn't a member of the workspace", async () => {
    const id = await company();
    expect(await send("ownerB", { workspaceId: "a", companyId: id, followUpOn: addDays(today, 3) })).toEqual({ ok: false, error: "You are not a member of this workspace." });
    expect((await row(id)).nextFollowUpAt).toBeNull();
  });

  it("refuses a company from another workspace, naming it as the member's own workspace", async () => {
    const theirs = await company("Theirs", OTHER_ORG);
    expect(await send("ownerA", { workspaceId: "a", companyId: theirs, followUpOn: addDays(today, 3) })).toEqual({ ok: false, error: "Company not found." });
    expect((await row(theirs, OTHER_ORG)).nextFollowUpAt).toBeNull();
  });

  it("returns the claim's refusal and refreshes the page that was showing the old claim", async () => {
    const id = await company();
    await claimCompany(OFFICER, id);
    const result = await send("ownerA", { workspaceId: "a", companyId: id, followUpOn: addDays(today, 3) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("holds this company until") });
    expect(revalidatePath).toHaveBeenCalledWith(`/a/companies/${id}`);
  });

  it("needs a signed-in user", async () => {
    const id = await company();
    await expect(signedOut(() => setFollowUpAction(null, form({ workspaceId: "a", companyId: id, followUpOn: addDays(today, 3) })))).rejects.toThrow();
  });
});
