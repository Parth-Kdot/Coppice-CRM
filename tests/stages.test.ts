import { describe, expect, test } from "vitest";
import type { Stage } from "@/generated/prisma/enums";
import { ANSWERED_STAGES, REPLY_STAGES, opensReply } from "@/lib/stages";

// Which stage moves ask "Which outreach got the reply?". A no counts as a reply, so a move into
// Declined from before any answer asks too; a company that already answered isn't asked again.
describe("opensReply", () => {
  test.each<[Stage, Stage]>([
    ["CONTACTED", "DECLINED"],
    ["NOT_CONTACTED", "DECLINED"],
    ["DECLINED", "REPLIED"],
    ["DECLINED", "COMMITTED"],
    ["CONTACTED", "REPLIED"],
  ])("moving from %s to %s asks", (from, to) => {
    expect(opensReply(from, to)).toBe(true);
  });

  test.each<[Stage, Stage]>([
    ["REPLIED", "DECLINED"],
    ["IN_CONVERSATION", "DECLINED"],
    ["COMMITTED", "DECLINED"],
    ["REPLIED", "IN_CONVERSATION"],
    ["DECLINED", "CONTACTED"],
    ["DECLINED", "NOT_CONTACTED"],
  ])("moving from %s to %s doesn't ask", (from, to) => {
    expect(opensReply(from, to)).toBe(false);
  });
});

describe("the reply stage lists", () => {
  test("a reply can be marked in the answered stages and in Declined", () => {
    expect(REPLY_STAGES).toEqual([...ANSWERED_STAGES, "DECLINED"]);
  });

  test("Declined is not an answered stage, so the unmarked-reply gap leaves it out", () => {
    expect(ANSWERED_STAGES).toEqual(["REPLIED", "IN_CONVERSATION", "COMMITTED"]);
    expect(ANSWERED_STAGES).not.toContain("DECLINED");
  });
});
