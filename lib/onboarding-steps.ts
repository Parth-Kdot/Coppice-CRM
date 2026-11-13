// The two onboarding tours as data: which cards there are, what each says, and which real control
// it points at. Pure (no database, no DOM), so the card lists are tested directly
// (tests/onboarding-steps.test.ts); components/ledger/tour.tsx draws them.
//
//   basicsSteps(ctx)  The basics, taken once on the first visit (someone who finished them in another
//                     workspace skips them; everyone else, existing members included, takes them once):
//                     welcome, queue, claim, log with a follow-up, board, add or import, search,
//                     (owners) invite, done. Officers get 8 cards, owners 9. An officer who finished
//                     them and is now an owner gets only the invite card.
//   aiSteps(ctx)      The optional AI tour offered after the basics, grouped by page so it moves as
//                     little as it can: fact sheet, Smart import, Pitch Drafter, Claim Checker, Who to
//                     contact (one company page), Ask Coppice, AI assistants, AI usage (Settings), done. With AI
//                     unavailable or off, the AI-only cards collapse into one card that says so. With
//                     no company yet, the company-page cards show a drawing instead of a page.
//
// Each card is one short title and one sentence. `anchors` name the real control it points at, in
// order of preference: the first one that is on the page and visible gets the highlight. An anchor
// is a data-tour value, or a plain CSS selector (it starts with "#", "." or "[") for a control
// that has no data-tour hook. A card whose control is missing shows centred, with `illustration` if
// it has one.

export type TourName = "basics" | "ai";
export type TourRole = "owner" | "member";

// Where a card's control lives. "company" is a company page the tour picks (yours first).
export type TourRoute = "queue" | "board" | "company" | "import" | "facts" | "ask" | "settings";

export type Illustration = "queue" | "claim" | "log" | "board" | "check" | "draft" | "brief";

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
  // What the card says on a phone instead of `body` (there is no keyboard shortcut there).
  phoneBody?: string;
  // What the card says instead of `body` when the control found is this anchor (the claim banner
  // stands in for the log form until the company is claimed).
  anchorBody?: { anchor: string; body: string };
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
  // How many cards the AI tour has, for the done card's estimate.
  aiCards?: number;
  // The server has an AI key. Without one the done card offers the AI tour as optional, not
  // recommended: most of it would be about features that can't be used here yet.
  aiConfigured?: boolean;
};

export type AiContext = {
  role: TourRole;
  // The server has an AI key (lib/ai/client.ts isConfigured).
  aiConfigured: boolean;
  // An owner switched AI on for this workspace.
  aiOn: boolean;
  // An owner allowed outside AI assistants (MCP) for this workspace.
  mcpOn: boolean;
  // The workspace has no companies yet, so there is no company page to show.
  empty?: boolean;
};

export const ROUTE_LABELS: Record<TourRoute, string> = {
  queue: "Go to the queue",
  board: "Go to the board",
  company: "Open a company",
  import: "Go to Import",
  facts: "Go to Facts",
  ask: "Go to Ask Coppice",
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

export function basicsSteps({ role, empty, basicsRole, claimWindowDays = 14, aiCards, aiConfigured = true }: BasicsContext): TourStep[] {
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
      anchorBody: { anchor: "company-claim", body: "Claim it, then log your email here and pick a follow-up date. It comes back to your queue that day." },
      illustration: "log",
    },
    {
      key: "board",
      kind: "coach",
      title: "The board",
      body: "Every company by stage. When a reply comes in, move it: drag it, or tap its stage mark.",
      // An empty board shows nothing yet: the drawing stands in, without leaving the page.
      route: empty ? null : "board",
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
      phoneBody: "Tap Search to find any company from anywhere.",
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
    body: aiConfigured
      ? aiCards
        ? `Recommended next: the AI tour, ${aiCards} short cards.`
        : "Recommended next: the AI tour."
      : `Optional: the AI tour${aiCards ? `, ${aiCards} short cards` : ""}. AI drafting isn't set up on this server yet.`,
    route: "queue",
    anchors: [],
  });
  return steps;
}

export function aiSteps({ role, aiConfigured, aiOn, mcpOn, empty = false }: AiContext): TourStep[] {
  const owner = role === "owner";
  const aiWorks = aiConfigured && aiOn;
  const steps: TourStep[] = [
    {
      key: "facts",
      kind: "coach",
      title: "The fact sheet",
      body: owner
        ? aiWorks
          ? "Drafts only state facts an owner verified. Upload your sponsorship packet, then verify each fact."
          : "Drafts only state facts an owner verified. Add facts by hand here; turn AI on to read a packet."
        : "Drafts only state facts an owner verified; owners upload the packet and verify each fact here.",
      route: "facts",
      anchors: owner ? (aiWorks ? ["facts-upload", "facts-verify-all", "facts-add"] : ["facts-add", "facts-verify-all"]) : [],
    },
  ];

  // A company-page card: on the page when there is one, otherwise a drawing and where it will be.
  const onCompany = (step: Omit<TourStep, "kind" | "route"> & { illustration: Illustration; emptyBody: string }): TourStep => {
    const { emptyBody, ...card } = step;
    return empty ? { ...card, kind: "coach", route: null, anchors: [], open: undefined, body: emptyBody } : { ...card, kind: "coach", route: "company" };
  };

  if (aiWorks) {
    steps.push(
      {
        key: "smart",
        kind: "coach",
        title: "Smart import",
        body: "Messy notes column? Smart import reads stages and dates out of it.",
        route: "import",
        anchors: ["smart-switch", "import-drop"],
      },
      onCompany({
        key: "drafter",
        title: "Pitch Drafter",
        body: "Draft two emails from your verified facts. Nothing is sent from here.",
        emptyBody: "On a company page, once companies are in: two emails drafted from your verified facts.",
        anchors: ["#draft-email", "ai-tools"],
        open: "ai-tools",
        illustration: "draft",
      }),
      onCompany({
        key: "checker",
        title: "Claim Checker",
        body: "Every draft is checked; anything not backed by a verified fact is flagged.",
        emptyBody: "Every draft is checked; anything not backed by a verified fact is flagged.",
        anchors: [".lg-claimcheck"],
        open: "ai-tools",
        illustration: "check",
      }),
      onCompany({
        key: "research",
        title: "Who to contact",
        body: "A research brief from pages an owner approved; you choose what goes into notes.",
        emptyBody: "On a company page, once companies are in: a research brief from pages an owner approved.",
        anchors: ["research-brief", "ai-tools"],
        open: "ai-tools",
        illustration: "brief",
      }),
      {
        key: "ask",
        kind: "coach",
        title: "Ask Coppice",
        body: "Ask about your pipeline in plain words. Anything it proposes waits for you to confirm.",
        route: "ask",
        anchors: ["ask-coppice"],
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
    // Inside the collapsed section: pointing at it opens it, so the switch (or the steps) shows.
    anchors: owner ? [".lg-mcpset", ".lg-set-mcp", "mcp"] : [".lg-set-mcp", "mcp"],
  });

  if (aiWorks) {
    steps.push({
      key: "usage",
      kind: "coach",
      title: "AI usage",
      body: "Every AI call counts toward the limit for the last 30 days. A Draft click uses 2; failed calls count too.",
      route: "settings",
      anchors: [".lg-usage", "ai-usage"],
    });
  }

  steps.push({
    key: "done",
    kind: "done",
    title: "That is the AI tour.",
    body: "Replay either tour from the account menu.",
    route: "queue",
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
