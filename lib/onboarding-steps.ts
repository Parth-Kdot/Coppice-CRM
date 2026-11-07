// The two onboarding tours as data: which cards there are, what each says, and which real control
// it points at. Pure (no database, no DOM), so the card lists are tested directly
// (tests/onboarding-steps.test.ts); components/ledger/tour.tsx draws them.
//
//   basicsSteps(ctx)  The mandatory basics, taken once per workspace on the first visit:
//                     welcome, queue, claim, log with a follow-up, board, add or import, search,
//                     (owners) invite, done. Officers get 8 cards, owners 9. An officer who finished
//                     them and is now an owner gets only the invite card.
//   aiSteps(ctx)      The optional AI tour offered after the basics: fact sheet, Pitch Drafter, Claim
//                     Checker, Smart import, research briefs, AI assistants, AI usage, done. With AI
//                     unavailable or off, the AI-only cards collapse into one card that says so.
//
// Each card is one short title and one sentence. `anchors` name the real control it points at, in
// order of preference: the first one that is on the page and visible gets the highlight. An anchor
// is a data-tour value (the de-bloat packages added them), or a plain CSS selector (it starts with
// "#", "." or "[") for a page whose hook is still being added. A card whose control is missing
// shows centred, with `illustration` if it has one.

export type TourName = "basics" | "ai";
export type TourRole = "owner" | "member";

// Where a card's control lives. "company" is a company page the tour picks (yours first).
export type TourRoute = "queue" | "board" | "company" | "import" | "facts" | "settings";

export type Illustration = "queue" | "claim" | "log" | "board" | "check";

export type TourStep = {
  key: string;
  kind: "welcome" | "coach" | "done";
  title: string;
  body: string;
  // null: the control is on every page (the search), or there is no control (done cards).
  route: TourRoute | null;
  anchors: string[];
  // Phone (760px and narrower) prefers these, then falls back to `anchors`.
  phoneAnchors?: string[];
  illustration?: Illustration;
  // The label of the button that moves focus to the highlighted control.
  tryLabel?: string;
  // The data-tour of a collapsed disclosure to open when the card shows (the company page's AI tools).
  open?: string;
  // A link inside the card, for a card that sends you somewhere else (AI off: Settings).
  link?: { route: TourRoute; label: string };
};

export type BasicsContext = {
  role: TourRole;
  // The workspace has no companies yet: the first-run panel stands in for the queue.
  empty: boolean;
  // The role the basics were finished as, or null if they were never finished.
  basicsRole: TourRole | null;
  claimWindowDays?: number;
};

export type AiContext = {
  role: TourRole;
  // The server has an AI key (lib/ai/client.ts isConfigured).
  aiConfigured: boolean;
  // An owner switched AI on for this workspace.
  aiOn: boolean;
  // An owner allowed outside AI assistants (MCP) for this workspace.
  mcpOn: boolean;
};

export const ROUTE_LABELS: Record<TourRoute, string> = {
  queue: "Go to the queue",
  board: "Go to the board",
  company: "Open a company",
  import: "Go to Import",
  facts: "Go to Facts",
  settings: "Go to Settings",
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

const inviteStep: TourStep = {
  key: "invite",
  kind: "coach",
  title: "Invite your officers",
  body: "Invite your officers by their Google email, then send them the copied invite message.",
  route: "settings",
  anchors: ["invite", "settings-members", '[aria-labelledby="set-invites"]', '[aria-labelledby="set-members"]'],
};

export function basicsSteps({ role, empty, basicsRole, claimWindowDays = 14 }: BasicsContext): TourStep[] {
  // Finished as an officer, an owner now: the one card they have not seen.
  if (basicsRole === "member" && role === "owner") return [inviteStep];

  const steps: TourStep[] = [
    {
      key: "welcome",
      kind: "welcome",
      title: "Welcome",
      body: "Two minutes on how the team works here, then it is all yours.",
      route: "queue",
      anchors: [],
    },
    {
      key: "queue",
      kind: "coach",
      title: "Your queue",
      body: empty
        ? "Once companies are in, this is your to-do list: companies whose follow-up date has arrived, oldest first."
        : "This is your to-do list: companies whose follow-up date has arrived, oldest first.",
      route: "queue",
      anchors: empty ? ["firstrun"] : ["queue-list"],
      illustration: "queue",
    },
    {
      key: "claim",
      kind: "coach",
      title: "Claim before you email",
      body: `Claim a company before you email so nobody double-pitches. A claim lasts ${days(claimWindowDays)}.`,
      route: "queue",
      anchors: empty ? [] : ["queue-claim"],
      illustration: "claim",
      tryLabel: "Try it",
    },
    {
      key: "log",
      kind: "coach",
      title: "Log it, pick a follow-up",
      body: "After you email, log it here and pick a follow-up date. The company comes back to your queue that day.",
      // An empty workspace has no company page to show yet: the drawing stands in.
      route: empty ? null : "company",
      anchors: empty ? [] : ["log-outreach", "log-followup", "company-claim"],
      illustration: "log",
    },
    {
      key: "board",
      kind: "coach",
      title: "The board",
      body: "Every company by stage. When a reply comes in, move it: drag it, or tap its stage mark.",
      route: "board",
      anchors: empty ? [] : ["slip-move", "board-columns"],
      illustration: "board",
    },
    {
      key: "add",
      kind: "coach",
      title: "Add companies",
      body: "Bring in your sponsor spreadsheet or add one company. Look-alikes are caught for you.",
      route: "queue",
      anchors: empty ? (role === "owner" ? ["firstrun-import"] : ["firstrun-add"]) : ["add-menu"],
      phoneAnchors: empty ? undefined : ["tab-add"],
    },
    {
      key: "search",
      kind: "coach",
      title: "Find anything",
      body: "Ctrl K or / finds any company from anywhere.",
      route: null,
      anchors: ["search"],
      phoneAnchors: ["search-tab"],
    },
  ];
  if (role === "owner") steps.push(inviteStep);
  steps.push({
    key: "done",
    kind: "done",
    title: "You are set.",
    body: "Recommended next: the AI tour, about 4 minutes.",
    route: null,
    anchors: [],
  });
  return steps;
}

export function aiSteps({ role, aiConfigured, aiOn, mcpOn }: AiContext): TourStep[] {
  const owner = role === "owner";
  const aiWorks = aiConfigured && aiOn;
  const steps: TourStep[] = [
    {
      key: "facts",
      kind: "coach",
      title: "The fact sheet",
      body: owner
        ? "Drafts only state facts an owner verified. Upload your sponsorship packet, then verify each fact."
        : "Drafts only state facts an owner verified; owners upload the packet and verify each fact here.",
      route: "facts",
      anchors: owner ? ["facts-upload", "facts-verify-all", "facts-add"] : [],
    },
  ];

  if (aiWorks) {
    steps.push(
      {
        key: "drafter",
        kind: "coach",
        title: "Pitch Drafter",
        body: "Draft two emails from your verified facts. Nothing is sent from here.",
        route: "company",
        anchors: ["#draft-email", "ai-tools"],
        open: "ai-tools",
      },
      {
        key: "checker",
        kind: "coach",
        title: "Claim Checker",
        body: "Every draft is checked; anything not backed by a verified fact is flagged.",
        route: "company",
        anchors: [".lg-claimcheck"],
        open: "ai-tools",
        illustration: "check",
      },
      {
        key: "smart",
        kind: "coach",
        title: "Smart import",
        body: "Messy notes column? Smart import reads stages and dates out of it.",
        route: "import",
        anchors: ["smart-switch", "import-drop"],
      },
      {
        key: "research",
        kind: "coach",
        title: "Research briefs",
        body: "Ask for a brief from approved web pages; you choose what goes into notes.",
        route: "company",
        anchors: ["research-brief", "ai-tools"],
        open: "ai-tools",
      },
    );
  } else if (!aiConfigured) {
    steps.push({
      key: "ai-off",
      kind: "coach",
      title: "AI is not set up yet",
      body: owner
        ? "AI is not set up on this server yet, so drafting, checking and research are off. Everything else works."
        : "AI is not available here yet. Everything else works.",
      route: null,
      anchors: [],
    });
  } else {
    steps.push({
      key: "ai-off",
      kind: "coach",
      title: "AI is off",
      body: owner ? "AI is off for this workspace. Turn it on in Settings > AI." : "AI is not available here yet. Everything else works.",
      route: null,
      anchors: [],
      link: owner ? { route: "settings", label: "Open Settings" } : undefined,
    });
  }

  steps.push({
    key: "mcp",
    kind: "coach",
    title: "AI assistants",
    body: owner
      ? mcpOn
        ? "AI assistants are allowed here: each person connects their own to work in Coppice from chat."
        : "Connect an AI assistant to work in Coppice from chat. Switch it on here."
      : mcpOn
        ? "You can connect an AI assistant to work in Coppice from chat; this section shows how."
        : "An AI assistant can work in Coppice from chat once an owner switches it on here.",
    route: "settings",
    anchors: ["mcp", '[aria-labelledby="set-mcp"]'],
  });

  if (aiWorks) {
    steps.push({
      key: "usage",
      kind: "coach",
      title: "AI usage",
      body: "Every AI call counts toward the monthly limit. A Draft click uses 2, failed calls count too.",
      route: "settings",
      anchors: ["ai-usage", ".lg-usage", '[aria-labelledby="set-ai"]'],
    });
  }

  steps.push({
    key: "done",
    kind: "done",
    title: "That is the AI tour.",
    body: "Replay either tour from the account menu.",
    route: null,
    anchors: [],
  });
  return steps;
}

// The step a tour opens at: where the person left off, kept inside the list (the list can be
// shorter than it was, e.g. an owner made officer loses the invite card). It never opens on the
// done card: reaching that card is what finishes a tour, so a resume lands on the card before it.
export function resumeIndex(steps: readonly TourStep[], saved: number): number {
  if (steps.length === 0) return 0;
  const last = steps.at(-1)?.kind === "done" ? steps.length - 2 : steps.length - 1;
  return Math.max(0, Math.min(Math.max(0, last), Math.trunc(saved)));
}

// Whether the basics still gate this person in this workspace: never finished, or finished as an
// officer by someone who is an owner now (they see the invite card once).
export function basicsPending(progress: { basicsDoneAt: unknown; basicsRole: string | null } | null, role: TourRole): boolean {
  if (!progress || !progress.basicsDoneAt) return true;
  return progress.basicsRole === "member" && role === "owner";
}

// The CSS selector for one anchor: a data-tour value, or a selector as written.
export function anchorSelector(anchor: string): string {
  return /^[#.[]/.test(anchor) ? anchor : `[data-tour="${anchor}"]`;
}
