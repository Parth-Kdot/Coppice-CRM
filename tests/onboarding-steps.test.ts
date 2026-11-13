import { describe, expect, it, test } from "vitest";
import { autoOpenView, isEditable, placeCard, scrollTarget } from "@/components/ledger/tour-logic";
import { aiSteps, anchorSelector, basicsPending, basicsSteps, resumeIndex, type AiContext, type BasicsContext } from "@/lib/onboarding-steps";

// The tours' card lists and the coach card's placement rules, without a database or a browser.

const keys = (steps: { key: string }[]) => steps.map((s) => s.key);

describe("basicsSteps", () => {
  test.each<[string, BasicsContext, string[]]>([
    ["an officer", { role: "member", empty: false, basicsRole: null }, ["welcome", "queue", "claim", "log", "board", "add", "search", "done"]],
    ["an owner", { role: "owner", empty: false, basicsRole: null }, ["welcome", "queue", "claim", "log", "board", "add", "search", "invite", "done"]],
    ["an officer, empty workspace", { role: "member", empty: true, basicsRole: null }, ["welcome", "queue", "claim", "log", "board", "add", "search", "done"]],
    ["an owner, empty workspace", { role: "owner", empty: true, basicsRole: null }, ["welcome", "queue", "claim", "log", "board", "add", "search", "invite", "done"]],
    ["an officer who finished them, replaying", { role: "member", empty: false, basicsRole: "member" }, ["welcome", "queue", "claim", "log", "board", "add", "search", "done"]],
    ["an owner who finished them as an owner", { role: "owner", empty: false, basicsRole: "owner" }, ["welcome", "queue", "claim", "log", "board", "add", "search", "invite", "done"]],
    ["an officer made owner after finishing", { role: "owner", empty: false, basicsRole: "member" }, ["invite"]],
    ["an owner made officer after finishing", { role: "member", empty: false, basicsRole: "owner" }, ["welcome", "queue", "claim", "log", "board", "add", "search", "done"]],
  ])("%s", (_, ctx, expected) => {
    expect(keys(basicsSteps(ctx))).toEqual(expected);
  });

  it("officers get 8 cards and owners 9; the first is the welcome and the last the done card", () => {
    const officer = basicsSteps({ role: "member", empty: false, basicsRole: null });
    const owner = basicsSteps({ role: "owner", empty: false, basicsRole: null });
    expect([officer.length, owner.length]).toEqual([8, 9]);
    for (const steps of [officer, owner]) {
      expect(steps[0].kind).toBe("welcome");
      expect(steps.at(-1)?.kind).toBe("done");
      expect(steps.slice(1, -1).every((s) => s.kind === "coach")).toBe(true);
    }
  });

  it("an empty workspace points at the first-run panel and draws what isn't there yet", () => {
    const owner = basicsSteps({ role: "owner", empty: true, basicsRole: null });
    const officer = basicsSteps({ role: "member", empty: true, basicsRole: null });
    const by = (steps: ReturnType<typeof basicsSteps>, key: string) => steps.find((s) => s.key === key)!;
    expect(by(owner, "queue").anchors).toEqual(["firstrun"]);
    expect(by(owner, "claim").anchors).toEqual([]);
    expect(by(owner, "claim").illustration).toBe("claim");
    expect(by(owner, "log").anchors).toEqual([]);
    expect(by(owner, "log").route).toBeNull();
    expect(by(owner, "board").illustration).toBe("board");
    expect(by(owner, "add").anchors).toEqual(["firstrun-import"]);
    expect(by(officer, "add").anchors).toEqual(["firstrun-add"]);
  });

  it("anchors on the data-tour hooks, phone first where the control moves", () => {
    const steps = basicsSteps({ role: "owner", empty: false, basicsRole: null });
    const by = (key: string) => steps.find((s) => s.key === key)!;
    expect(by("queue").anchors).toEqual(["queue-list"]);
    expect(by("claim").anchors).toEqual(["queue-claim"]);
    expect(by("log").anchors).toEqual(["log-outreach", "log-followup", "company-claim"]);
    expect(by("log").route).toBe("company");
    expect(by("board").route).toBe("board");
    expect(by("add").anchors).toEqual(["add-menu"]);
    expect(by("add").phoneAnchors).toEqual(["tab-add"]);
    expect(by("search").phoneAnchors).toEqual(["search-tab"]);
    expect(by("invite").route).toBe("settings");
    expect(by("invite").anchors[0]).toBe("invite");
  });

  it("an empty board isn't visited just to show a drawing", () => {
    expect(basicsSteps({ role: "member", empty: true, basicsRole: null }).find((s) => s.key === "board")?.route).toBeNull();
  });

  it("says what fits: a phone taps Search, the log card speaks to the claim banner, the done card counts the AI tour", () => {
    const steps = basicsSteps({ role: "member", empty: false, basicsRole: null, aiCards: 7 });
    expect(steps.find((s) => s.key === "search")?.phoneBody).toBe("Tap Search to find any company from anywhere.");
    expect(steps.find((s) => s.key === "log")?.anchorBody).toMatchObject({ anchor: "company-claim", body: expect.stringMatching(/^Claim it, then log/) });
    expect(steps.at(-1)?.body).toBe("Recommended next: the AI tour, 7 short cards.");
  });

  it("without AI set up on the server, the done card offers the AI tour as optional, not recommended", () => {
    const body = basicsSteps({ role: "owner", empty: false, basicsRole: null, aiCards: 3, aiConfigured: false }).at(-1)?.body ?? "";
    expect(body).toMatch(/^Optional: the AI tour, 3 short cards\./);
    expect(body).not.toMatch(/Recommended/);
  });

  test.each([1, 14, 60])("the claim card says how long a claim lasts (%i)", (days) => {
    const claim = basicsSteps({ role: "member", empty: false, basicsRole: null, claimWindowDays: days }).find((s) => s.key === "claim")!;
    expect(claim.body).toContain(`A claim lasts ${days} ${days === 1 ? "day" : "days"}.`);
  });

  it("every card is a short title and one plain sentence or two", () => {
    for (const role of ["owner", "member"] as const)
      for (const step of [...basicsSteps({ role, empty: false, basicsRole: null }), ...aiSteps({ role, aiConfigured: true, aiOn: true, mcpOn: false })]) {
        expect(step.title.length).toBeLessThanOrEqual(30);
        expect(step.body.length).toBeLessThanOrEqual(120);
      }
  });
});

describe("aiSteps", () => {
  test.each<[string, AiContext, string[]]>([
    ["AI on, owner", { role: "owner", aiConfigured: true, aiOn: true, mcpOn: true }, ["facts", "smart", "drafter", "checker", "research", "mcp", "usage", "done"]],
    ["AI on, officer", { role: "member", aiConfigured: true, aiOn: true, mcpOn: true }, ["facts", "smart", "drafter", "checker", "research", "mcp", "usage", "done"]],
    ["AI off for the workspace", { role: "owner", aiConfigured: true, aiOn: false, mcpOn: false }, ["facts", "ai-off", "mcp", "done"]],
    ["AI not set up on the server", { role: "owner", aiConfigured: false, aiOn: true, mcpOn: false }, ["facts", "ai-off", "mcp", "done"]],
    ["AI not set up, officer", { role: "member", aiConfigured: false, aiOn: false, mcpOn: false }, ["facts", "ai-off", "mcp", "done"]],
  ])("%s", (_, ctx, expected) => {
    expect(keys(aiSteps(ctx))).toEqual(expected);
  });

  it("with AI off, owners are sent to Settings and officers told everything else works", () => {
    const owner = aiSteps({ role: "owner", aiConfigured: true, aiOn: false, mcpOn: false }).find((s) => s.key === "ai-off")!;
    const officer = aiSteps({ role: "member", aiConfigured: true, aiOn: false, mcpOn: false }).find((s) => s.key === "ai-off")!;
    expect(owner.body).toBe("AI is off for this workspace. Turn it on in Settings > AI.");
    expect(owner.link?.route).toBe("settings");
    expect(officer.body).toBe("AI is not available here yet. Everything else works.");
    expect(officer.link).toBeUndefined();
  });

  it("with no AI key on the server, nobody is told to switch it on", () => {
    for (const role of ["owner", "member"] as const) {
      const card = aiSteps({ role, aiConfigured: false, aiOn: true, mcpOn: false }).find((s) => s.key === "ai-off")!;
      expect(card.body).not.toMatch(/turn it on/i);
      expect(card.link).toBeUndefined();
    }
  });

  test.each<[string, AiContext, RegExp]>([
    ["owner, MCP off", { role: "owner", aiConfigured: true, aiOn: true, mcpOn: false }, /Switch it on here\./],
    ["owner, MCP on", { role: "owner", aiConfigured: true, aiOn: true, mcpOn: true }, /are allowed here/],
    ["officer, MCP off", { role: "member", aiConfigured: true, aiOn: true, mcpOn: false }, /once an owner switches it on/],
    ["officer, MCP on", { role: "member", aiConfigured: true, aiOn: true, mcpOn: true }, /You can connect/],
  ])("the assistants card for %s", (_, ctx, wording) => {
    const mcp = aiSteps(ctx).find((s) => s.key === "mcp")!;
    expect(mcp.body).toMatch(wording);
    expect(mcp.route).toBe("settings");
  });

  it("officers read about the fact sheet; owners are pointed at the upload", () => {
    const owner = aiSteps({ role: "owner", aiConfigured: true, aiOn: true, mcpOn: false })[0];
    const officer = aiSteps({ role: "member", aiConfigured: true, aiOn: true, mcpOn: false })[0];
    expect(owner.anchors[0]).toBe("facts-upload");
    expect(officer.anchors).toEqual([]);
    expect(officer.body).toMatch(/owners upload/);
  });

  it("the company-page cards open the AI tools first", () => {
    const steps = aiSteps({ role: "member", aiConfigured: true, aiOn: true, mcpOn: false });
    for (const key of ["drafter", "checker", "research"]) expect(steps.find((s) => s.key === key)?.open).toBe("ai-tools");
  });

  it("grouped by page: each page is visited once, and the tour ends back on the queue", () => {
    const routes = aiSteps({ role: "owner", aiConfigured: true, aiOn: true, mcpOn: false }).map((s) => s.route);
    expect(routes).toEqual(["facts", "import", "company", "company", "company", "settings", "settings", "queue"]);
    expect(basicsSteps({ role: "owner", empty: false, basicsRole: null }).at(-1)?.route).toBe("queue");
  });

  it("with no company yet, the company-page cards draw what they will show and stay put", () => {
    const steps = aiSteps({ role: "owner", aiConfigured: true, aiOn: true, mcpOn: false, empty: true });
    for (const key of ["drafter", "checker", "research"]) {
      const card = steps.find((s) => s.key === key)!;
      expect(card).toMatchObject({ route: null, anchors: [], open: undefined });
      expect(card.illustration).toBeDefined();
    }
    expect(steps.find((s) => s.key === "drafter")?.body).toMatch(/once companies are in/);
  });

  it("with AI off, the owner's fact sheet card says to add facts by hand, not to upload a packet", () => {
    const off = aiSteps({ role: "owner", aiConfigured: true, aiOn: false, mcpOn: false })[0];
    expect(off.body).toMatch(/Add facts by hand here; turn AI on to read a packet/);
    expect(off.anchors[0]).toBe("facts-add");
  });

  it("the assistants and usage cards point inside their sections, so the section opens", () => {
    const owner = aiSteps({ role: "owner", aiConfigured: true, aiOn: true, mcpOn: false });
    expect(owner.find((s) => s.key === "mcp")?.anchors[0]).toBe(".lg-mcpset");
    expect(owner.find((s) => s.key === "usage")?.anchors[0]).toBe(".lg-usage");
    expect(owner.find((s) => s.key === "usage")?.body).toMatch(/last 30 days/);
  });
});

describe("resuming and gating", () => {
  const steps = basicsSteps({ role: "member", empty: false, basicsRole: null });
  test.each([
    [0, 0],
    [3, 3],
    [6, 6],
    // The done card (7) is never resumed onto: reaching it is what finishes the tour.
    [7, 6],
    [12, 6],
    [-2, 0],
    [2.7, 2],
  ])("saved step %s opens card %s", (saved, expected) => {
    expect(resumeIndex(steps, saved)).toBe(expected);
  });

  test.each<[string, Parameters<typeof basicsPending>[0], "owner" | "member", boolean]>([
    ["no row", null, "member", true],
    ["started, not finished", { basicsDoneAt: null, basicsRole: null }, "owner", true],
    ["finished as officer, still officer", { basicsDoneAt: new Date(), basicsRole: "member" }, "member", false],
    ["finished as officer, owner now", { basicsDoneAt: new Date(), basicsRole: "member" }, "owner", true],
    ["finished as owner, officer now", { basicsDoneAt: new Date(), basicsRole: "owner" }, "member", false],
    ["finished as owner", { basicsDoneAt: new Date(), basicsRole: "owner" }, "owner", false],
  ])("basics due: %s", (_, progress, role, expected) => {
    expect(basicsPending(progress, role)).toBe(expected);
  });

  test.each([
    ["queue-list", '[data-tour="queue-list"]'],
    ["#draft-email", "#draft-email"],
    [".lg-usage", ".lg-usage"],
    ['[aria-labelledby="set-mcp"]', '[aria-labelledby="set-mcp"]'],
  ])("anchor %s is the selector %s", (anchor, selector) => {
    expect(anchorSelector(anchor)).toBe(selector);
  });
});

describe("the coach card's placement", () => {
  const viewport = { width: 1280, height: 900 };
  const card = { width: 340, height: 200 };

  it("sits under a small control, never over it", () => {
    const at = placeCard({ anchor: { top: 100, left: 300, width: 120, height: 40 }, card, viewport, phone: false });
    expect(at).toEqual({ place: "beside", left: 300, top: 154 });
  });

  it("flips above a control near the bottom of the screen", () => {
    const at = placeCard({ anchor: { top: 800, left: 300, width: 120, height: 40 }, card, viewport, phone: false });
    expect(at.place).toBe("beside");
    if (at.place === "beside") expect(at.top + card.height).toBeLessThanOrEqual(800);
  });

  it("stays inside the screen at the right edge", () => {
    const at = placeCard({ anchor: { top: 100, left: 1200, width: 60, height: 40 }, card, viewport, phone: false });
    expect(at.place === "beside" && at.left + card.width).toBeLessThanOrEqual(viewport.width - 16);
  });

  test.each([
    ["a tall control (the queue)", { top: 120, left: 100, width: 800, height: 700 }, "dock"],
    ["no control on this page", null, "center"],
  ])("docks or centres for %s", (_, anchor, place) => {
    expect(placeCard({ anchor, card, viewport, phone: false }).place).toBe(place);
  });

  it("no room on either side: docked in the corner rather than covering the control", () => {
    expect(placeCard({ anchor: { top: 300, left: 100, width: 200, height: 300 }, card: { width: 340, height: 320 }, viewport, phone: false }).place).toBe("dock");
  });

  it("is always the bottom sheet on a phone", () => {
    expect(placeCard({ anchor: { top: 100, left: 10, width: 100, height: 40 }, card, viewport: { width: 375, height: 812 }, phone: true })).toEqual({ place: "sheet" });
  });
});

describe("never interrupting", () => {
  test.each([
    [false, false, "card"],
    [true, false, "pill"],
    [false, true, "pill"],
    [true, true, "pill"],
  ] as const)("text field focused %s, dialog open %s: %s", (editableFocused, dialogOpen, view) => {
    expect(autoOpenView({ editableFocused, dialogOpen })).toBe(view);
  });

  test.each([
    [{ tagName: "INPUT", type: "text" }, true],
    [{ tagName: "INPUT", type: "email" }, true],
    [{ tagName: "INPUT", type: "" }, true],
    [{ tagName: "INPUT", type: "checkbox" }, false],
    [{ tagName: "INPUT", type: "radio" }, false],
    [{ tagName: "TEXTAREA" }, true],
    [{ tagName: "SELECT" }, true],
    [{ tagName: "DIV", isContentEditable: true }, true],
    [{ tagName: "BUTTON" }, false],
    [{ tagName: "BODY" }, false],
  ])("%o is a place someone types: %s", (el, expected) => {
    expect(isEditable(el)).toBe(expected);
  });
  it("nothing focused is not typing", () => expect(isEditable(null)).toBe(false));

  test.each([
    ["already in view", { top: 200, height: 40, scrollY: 0, viewTop: 8, viewBottom: 500 }, null],
    ["below the band: centred in it", { top: 900, height: 40, scrollY: 100, viewTop: 8, viewBottom: 408 }, 812],
    ["above the band", { top: -300, height: 40, scrollY: 1000, viewTop: 8, viewBottom: 408 }, 512],
    ["taller than the band: its top at the band's top", { top: 600, height: 900, scrollY: 0, viewTop: 8, viewBottom: 408 }, 592],
    ["never above the page", { top: -50, height: 40, scrollY: 20, viewTop: 8, viewBottom: 408 }, 0],
  ])("scrolling: %s", (_, input, expected) => {
    expect(scrollTarget(input)).toBe(expected);
  });
});
