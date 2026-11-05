// Landing copy for Coppice. Items that are announced and not yet built are labeled "Coming next"
// or "Later" wherever they appear. Company and people names in the examples are made up.

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#example", label: "Live example" },
  { href: "#ai", label: "Facts and drafts" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

export const HERO = {
  headline: "New board, same roots.",
  subhead:
    "Coppice is a shared outreach pipeline for teams that turn over every year. One officer claims each company, a queue brings it back on the date you chose, and the history stays in the workspace after the board graduates.",
  micro: "Free for student teams, with unlimited officers.",
  exampleLabel: "Example workspace, made-up companies",
};

export const PROBLEM = {
  headline: "Five ways a shared spreadsheet lets your team down",
  subhead: "A sheet with an owner column holds up for the first few weeks. Once a third officer starts adding rows, these five things begin to happen.",
  closing: "You can import last year's sheet as it is, columns and all, and sort out the rest as you go.",
  fileName: "Sponsors 2025-26 (FINAL v3).xlsx",
  items: [
    {
      title: "Two officers pitch the same company",
      body: "The owner cell was empty, or a minute out of date.",
      fix: "You claim a company before you can log outreach on it. Everyone else sees who holds it and until when.",
      note: "two owners, one lead",
      sheet: { row: 12, cells: ["Dunmore Engineering", "Maya", "Dev", "sent?"] },
    },
    {
      title: "Follow-ups slip",
      body: "Nothing in a sheet says which rows are due today.",
      fix: "Each outreach entry carries a follow-up date, 7 days out unless you change it, and the home screen lists what has come due.",
      note: "row 84, still waiting on the 20th",
      sheet: { row: 84, cells: ["Calloway Foods", "Replied", "Oct 9", "answer?"] },
    },
    {
      title: "Nobody knows which pitch works",
      body: "Replies came back to six inboxes, and the sheet was not updated.",
      fix: "Every entry records its channel, its date and who sent it. Reply rate per pitch template is the next feature being built.",
      note: "which email worked?",
      sheet: { row: 31, cells: ["Intro v1, v2, v3", "Replied?", "", "last edit Oct"] },
    },
    {
      title: "Duplicate rows",
      body: "\"Midland Tool and Die\" is in row 12 and \"midland tool & die\" is in row 140.",
      fix: "Look-alike names and websites are flagged and shown together, so you see both before anything is imported.",
      note: "same company, four times",
      sheet: { row: 140, cells: ["midland tool & die", "midlandtool.com", "www.midlandtool.com", "Sofia"] },
    },
    {
      title: "History leaves with the board",
      body: "The context lived in a senior's head and a Drive folder.",
      fix: "Notes, channels, dates and stage changes sit on each company, in a workspace that outlives its officers.",
      note: "ask Jake (Jake graduated)",
      sheet: { row: 57, cells: ["Hollis Machine", "Owner: Jake", "ask Jake", "?"] },
    },
  ],
};

export const SEASONS = {
  headline: "From last year's sheet to a pipeline the whole team can work from",
  subhead: "A board's year has four seasons. Importing happens once, claiming and logging become part of an officer's week, and turnover comes around every summer.",
  steps: [
    {
      season: "Autumn",
      tab: "Import",
      title: "Import last year's sheet",
      who: "Owner or Officer",
      body: "Export your spreadsheet as a CSV and upload it, up to 2,000 rows. Point each column at the right field, then choose, group by group, whether to skip or import look-alike companies.",
      beats: ["Read 42 rows", "Map the columns", "Decide on look-alikes"],
    },
    {
      season: "Winter",
      tab: "Claim",
      title: "Claim a company before you contact it",
      who: "Officer",
      body: "Press Claim on any company nobody else holds. It is yours for 14 days unless your chair changed that, and everyone else sees your name and the date the claim ends.",
      beats: ["Find a company nobody holds", "Press Claim", "A second officer is held off"],
    },
    {
      season: "Spring",
      tab: "Log and follow up",
      title: "Send from your inbox, then log it",
      who: "Officer",
      body: "Record the channel, a note and a follow-up date, which starts at 7 days out. Saving the entry renews your claim. On the follow-up date the company is back in your queue.",
      beats: ["Fill in the entry", "Save it to the ledger", "Follow up when it is due"],
    },
    {
      season: "Summer",
      tab: "Turnover",
      title: "The next board inherits the story",
      who: "Owner and Officer",
      body: "When officers graduate, the workspace stays. The incoming chair opens any company, reads every entry, note and stage change in order, claims it, and picks up from there.",
      beats: ["Close the board year", "Pass the chair on", "Leave the history in place"],
    },
  ],
  queue: {
    title: "This is the first page every officer opens",
    body: "The companies that are due, most overdue first. Made-up example companies.",
  },
  // The right page of the book, one pane per step. Autumn: the old sheet, its columns and a look-alike pair.
  sheet: {
    title: "Last year's sheet",
    headers: ["Company", "Contact", "Follow-up"],
    // What each header fills in the app, read out for screen readers beside the tick.
    mapped: ["Company name", "Contact name", "Notes"],
    rows: [
      ["Dunmore Engineering", "Dana", "Oct 9"],
      ["Calloway Foods", "Marcus", "Oct 12"],
      ["Harlan Credit Union", "Ines", "Nov 2"],
    ],
    more: "39 more rows",
  },
  lookalike: {
    title: "Same company?",
    rows: [
      { row: "Row 12", name: "Midland Tool and Die", pick: "Import" },
      { row: "Row 31", name: "midland tool & die", pick: "Skip" },
    ],
    choices: ["Import", "Skip"],
  },
  imported: { title: "Imported from the sheet", body: "Imported 41 of 42 rows. 1 look-alike skipped, nothing merged." },
  // Winter: the claim ticket for Dunmore Engineering, then the second officer's attempt.
  claim: {
    title: "Claim ticket",
    company: "Dunmore Engineering",
    free: "Not claimed.",
    mine: "You hold this until Nov 11.",
    button: "Claim",
    chip: "Yours until Nov 11",
    attempt: "Dev pressed Claim at 9:02",
    refusal: "Dev sees: Held by Maya until Nov 11",
  },
  // Spring: a fast log entry, the ledger row it becomes, and the company coming back on its date.
  log: {
    title: "New entry",
    channels: ["Email", "LinkedIn", "In person", "Other"],
    channelPicked: 0,
    note: "Sent the intro deck. Asked for a call.",
    followLabel: "Follow up on",
    follows: ["Nov 4, 7 days out"],
    followPicked: 0,
    save: "Log outreach",
    saved: "Logged.",
  },
  due: {
    title: "Back in the queue",
    company: "Dunmore Engineering",
    before: "Due Nov 4",
    after: "Due today",
    stageBefore: "Contacted",
    stageAfter: "Moved to Replied",
  },
  kept: "Kept on file",
  // Summer: the chair changes, and every entry above the double rule stays.
  chair: { old: "Chair 2026-27: Maya", next: "Chair 2027-28: Sam" },
  rows: [
    { who: "Maya", what: "Email, Dunmore Engineering", when: "Oct 28" },
    { who: "Maya", what: "Follow-up, Dunmore Engineering", when: "Nov 4" },
    { who: "Dev", what: "LinkedIn, Calloway Foods", when: "Nov 11" },
    { who: "Sam", what: "Call, Harlan Credit Union", when: "Feb 2" },
    { who: "Priya", what: "Email, Summit Freight, declined", when: "Apr 28" },
  ],
  claimTags: [
    { name: "Dunmore Engineering", note: "Yours until Nov 11", mine: true },
    { name: "Calloway Foods", note: "Priya R. until Oct 31", mine: false },
    { name: "Harlan Credit Union", note: "", mine: false },
  ],
  labels: ["Dunmore Engineering", "Calloway Foods", "Harlan Credit Union", "Lakeshore Printing", "Westgate Dental"],
  freeChip: "Claim",
};

export const EXAMPLE = {
  headline: "Maya and Dev, same company, same second",
  setting: "The Westfield Rocketry Club is a made-up student org with a 14-day claim window. Dunmore Engineering has never been contacted.",
  when: "Wed, Oct 28, 9:02 AM",
  company: "Dunmore Engineering",
  until: "Nov 11",
  refusal: "Held by Maya until Nov 11",
  mayaNote: "Yours until Nov 11. Logging outreach renews it for another 14 days.",
  devNote: "Held by Maya until Nov 11",
  devNext: "Dev moves on to Calloway Foods, the next company down.",
  after: [
    { when: "Oct 28", title: "Maya sends and logs", body: "She writes from her own Gmail, logs the email and picks a follow-up on Nov 4, the 7 day default. The company moves to Contacted and her claim renews." },
    { when: "Nov 4", title: "The queue brings it back", body: "It shows as due today on Maya's queue with her note under the name. On Dev's it reads Held by Maya, with no Claim button." },
    { when: "Nov 6", title: "A reply, and a record", body: "Maya logs Priya's reply and moves the company to Replied. Next September the new chair reads the whole page, top to bottom." },
  ],
};

// The AI section: what an owner and an officer do with a packet, and what the claim check marks.
export const AI = {
  headline: "Facts you checked, drafts that stay inside them",
  body: "An owner uploads the sponsorship packet as a PDF. Coppice lists the facts in it, each with the sentence and page it came from. Only facts an owner has verified can be used in a draft, and every draft is checked against them before it leaves your inbox.",
  steps: [
    { title: "Read the packet", body: "A text PDF up to 3.5 MB and 40 pages. Each fact shows the quote it was read from, and whether that quote was found on the page." },
    { title: "Verify each fact", body: "An owner verifies, edits or deletes every fact. Edits count as verified, and a fact older than a year is marked stale." },
    { title: "Draft two emails", body: "An officer picks first email or follow-up. The AI writes two versions from verified facts only, with placeholders for names that Coppice fills in afterwards." },
    { title: "Check the claims", body: "Numbers no fact supports, links and lines like thanks for sponsoring us before are underlined as you type. An AI pass looks at the rest." },
  ],
  optional: "AI is optional. An owner switches it on for the workspace and sets how many calls it may make in 30 days.",
  mock: {
    label: "Example, made-up packet and company",
    fact: {
      text: "The club has built and competed with 14 rovers since 2019.",
      source: "Page 3 of Westfield-sponsor-packet.pdf",
      quote: "Since 2019 our members have built and raced 14 rovers at regional competitions.",
      found: "Quote found on that page",
      verified: "Verified by Maya Chen on Oct 21",
    },
    draftTitle: "Draft for Dunmore Engineering",
    draftParts: [
      { text: "Hi Dana, I am writing for the Westfield Rocketry Club. Our members have built 14 rovers since 2019, and last spring about " },
      { text: "1,200", mark: true },
      { text: " people came to our showcase. We would value a 10-minute call about sponsoring this year's build." },
    ],
    finding: { quote: "1,200", reason: "No verified fact has this number." },
    checkLine: "Checked live as you type. Check again with AI looks at the rest.",
    compose: ["Open in Gmail", "Open in Outlook", "Copy"],
  },
};

export const FEATURES = {
  headline: "What is in the workspace today",
  items: [
    {
      icon: "claim",
      title: "Claim before you contact",
      short: "One officer holds a company at a time, and the database enforces it.",
      detail: "While a claim is live, nobody else can log outreach, change the stage or archive that company. Two clicks in the same second still produce one holder, and owners can release a claim from an officer who went quiet.",
    },
    {
      icon: "queue",
      title: "A follow-up queue as the home screen",
      short: "Every company whose follow-up date has arrived.",
      detail: "Each row shows how many days overdue it is and your last note. Mine narrows the list to companies you hold, and companies nobody has contacted yet sit in their own list.",
    },
    {
      icon: "board",
      title: "A stage board",
      short: "Six stages from first contact to a decision.",
      detail: "Not contacted, Contacted, Replied, In conversation, Committed and Declined. Logging the first outreach moves a company to Contacted, and every later move records who made it.",
    },
    {
      icon: "log",
      title: "An outreach log on every company",
      short: "Emails, LinkedIn messages and conversations, all on the company.",
      detail: "Each entry shows the date, who logged it, the channel and what was said, plus the next follow-up date. The record is still there when the person who knew the contact has graduated.",
    },
    {
      icon: "import",
      title: "Import, with look-alikes shown together",
      short: "Bring in last year's CSV and decide group by group.",
      detail: "Upload up to 2,000 rows and point each column at a field. Names are compared without capitals, punctuation or endings like Inc and LLC, and websites without www, so near-duplicates appear side by side.",
    },
    {
      icon: "facts",
      title: "A fact sheet read from your packet",
      short: "Every fact keeps its quote and page number.",
      tag: "AI, optional",
      detail: "Upload the sponsorship packet and the facts in it are listed for an owner to verify, edit or delete. A fact that was not verified cannot appear in a draft.",
    },
    {
      icon: "draft",
      title: "Drafts with a claim check",
      short: "Two drafts from verified facts, checked before you send.",
      tag: "AI, optional",
      detail: "The draft opens in your own Gmail or Outlook, or you can copy it. Under each draft the claim check marks numbers, links and history lines that no fact supports.",
    },
  ],
};

export const AUDIENCE = {
  headline: "Teams that change hands every year",
  items: [
    { title: "Student organizations", body: "Officer teams that hand a spreadsheet to a new board each spring." },
    { title: "Hackathons", body: "Organizers who ask dozens of companies, then pass the list on." },
    { title: "Nonprofits", body: "Volunteer boards that ask local businesses for support." },
    { title: "Alumni boards", body: "Chapter officers who ask employers for speakers and mentors." },
  ],
};

export const NAME = {
  headline: "Many stems, one root",
  subhead: "Coppice is said KOP-iss. The first syllable sounds like \"cop.\"",
  pronunciation: "KOP-iss",
  paragraph: "Coppicing is an old woodland practice. A woodcutter fells a tree down to its stump, and the stump answers by sending up new stems from the same roots.",
};

export const TRUST = {
  headline: "Four things I decided Coppice would never do",
  items: [
    { title: "I left out a send button on purpose.", body: "A draft opens in your own Gmail or Outlook compose window, and you press Send from your own address. Coppice never connects to your inbox." },
    { title: "Nothing is merged for you.", body: "Look-alike companies are flagged and shown together. Nothing is merged, blocked or deleted until a person decides what to do with the group." },
    { title: "AI does not change your pipeline by itself.", body: "AI drafts text and lists facts from a packet. A fact cannot be used in a draft until the owner verifies it, a draft stays on the screen until you send it from your own inbox, and a stage, a claim or a log entry changes only when an officer presses the button." },
    { title: "One team cannot see another.", body: "Every workspace is separated inside the database, using row-level security in Postgres, so one team's companies, notes and members are not visible to another team's accounts." },
  ],
  alsoOut: "Also out of scope: payments, and public pages for companies to visit.",
  comingTitle: "Coming next",
  comingNote: "Announced, not built yet. Nothing here exists in the app today.",
  coming: [
    { tag: "Next", title: "Reply rate per pitch template", body: "See which version of your pitch gets answers, so the next board starts from what worked." },
    { tag: "Later", title: "Pipeline Copilot", body: "A chat that answers questions about your pipeline. Anything it proposes changing waits for a person to confirm." },
    { tag: "Later", title: "Research briefs", body: "A short background read on a company before you reach out." },
    { tag: "Later", title: "Turnover Time Capsule", body: "At the end of the term, a \"wrapped\"-style history of the year handed to the incoming board." },
  ],
  privacyTitle: "Privacy notes",
  privacy: [
    { title: "AI is optional", body: "The owner turns it on or off for the whole workspace and sets how many AI calls the workspace may make in a 30-day period. With AI off, none of the text below is sent anywhere." },
    { title: "What is kept from the AI", body: "The provider's free tier may use what it receives to improve its products. So a draft is written with placeholders for first name, sender name and organization name, and Coppice fills in the real names after it comes back. Email addresses and phone numbers are masked in everything sent. Other names can't be caught that way: a name in your packet, in a note, or typed into a draft you check again does reach the provider, so leave those out. A research brief sends Gemini only the public text and addresses of pages an owner approved, with email addresses and phone numbers masked (numbers of 7 or more digits written in groups with spaces, dashes, dots, slashes or brackets, as in most countries, and numbers of 10 or more digits written in one run, in any script's digits, fullwidth ones included; a date, or a run of dates and years, standing on its own is left alone), plus the company's name and website, never your notes or contacts." },
    { title: "What does go to the provider", body: "While AI is on: the text of the packet you uploaded, your verified facts, the company's name, industry and website, the contact's job title, any note you add to a draft request, the dates and subjects of earlier outreach on a follow-up, the text of each draft for the claim check, and for a research brief, the public text and addresses of the pages an owner approved. Keep anything private out of the packet and your notes." },
    { title: "Emails stay with owners", body: "Officers do not see other members' email addresses. Only owners can view them." },
    { title: "Contacts never log in", body: "Company contacts never log in and never receive anything from Coppice." },
    { title: "Archiving keeps the history", body: "An archived company leaves the board and queue, and it can be unarchived later." },
  ],
};

export const START = {
  headline: "Get started in four steps",
  note: "You need a Google account and last year's sheet, if you have one.",
  steps: [
    { title: "Sign in with Google", body: "One click, with no new password to remember." },
    { title: "Join your chair's workspace", body: "Workspaces are opened by request during the pilot. Once yours exists, officers sign in with the invited email address and press Join." },
    { title: "Invite your officers and set your claim window", body: "Owners invite officers by email address and set the claim window, 1 to 60 days, 14 by default. Coppice does not send the invite, so tell them to sign in." },
    { title: "Import your sheet and start claiming", body: "Upload last year's CSV, review any duplicate groups, then press Claim on the first company you plan to contact." },
  ],
};

export const FAQ = [
  { q: "Is Coppice free?", a: "Yes for student teams, with no limit on how many officers you add." },
  { q: "Does Coppice send email?", a: "No. Drafts open in your own Gmail or Outlook, and you send them from your own address. Coppice only records that you reached out, when you tell it." },
  {
    q: "What happens when a claim expires?",
    a: "At the end of your team's claim window, the company shows who held it and that the claim expired, and any officer can claim it. Logging outreach before then renews the claim for another full window. An owner can also force-release a claim earlier, and a claim is released if its holder leaves the workspace.",
  },
  {
    q: "What about Microsoft or Outlook accounts?",
    a: "Sign-in is with Google today. Your outreach can still come from any inbox: drafts open in Gmail, in Outlook on the web with a work or school Microsoft 365 account, or in your computer's default mail app.",
  },
  {
    q: "What happens at board turnover?",
    a: "The workspace and everything in it stays. The outgoing chair makes the incoming chair an Owner in Settings, then steps down to Officer or leaves, and the new board can open any company to read its outreach entries, notes and stage changes. Claims held by someone who leaves the workspace are released.",
  },
];

export const FINAL = {
  headline: "Put your sheet in, claim a company, and leave the next board something to read.",
  subhead: "Setting up takes a Google sign-in and a CSV.",
};

export const FOOTER = {
  tagline: "Coppice. Capisce?",
  pronunciation: "KOP-iss",
  links: [
    { href: "#how", label: "How it works" },
    { href: "#example", label: "Live example" },
    { href: "#ai", label: "Facts and drafts" },
    { href: "#features", label: "Features" },
    { href: "#faq", label: "FAQ" },
  ],
  builder: "Built by Parth Kaushik, a Purdue student who ran sponsorship outreach out of a shared sheet.",
  disclaimer: "Coppice is an independent student project and is not an official Purdue University product.",
  copyright: "© 2026 Coppice",
};
