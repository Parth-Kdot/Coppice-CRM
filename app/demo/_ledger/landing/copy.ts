// Landing copy for Coppice, from docs/design/LANDING_COPY.md. Items that are announced and not yet
// built are labeled "Coming next" or "Later" wherever they appear.

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#example", label: "Live example" },
  { href: "#faq", label: "FAQ" },
];

export const HERO = {
  headline: ["New", "board,", "same", "roots."],
  subhead:
    "Coppice is a shared outreach pipeline for teams that turn over every year. One officer claims each company, a follow-up queue brings it back on the date you chose, and the full history stays in the workspace after the board graduates.",
  micro: "Sign in with Google. Free for student teams, with unlimited officers.",
  strip: [
    { title: "One officer per company", body: "The database decides who holds a company, so two people clicking at the same moment still produce one holder." },
    { title: "A queue that remembers for you", body: "Every company that is due, most overdue first, is waiting on the home screen." },
    { title: "History that stays", body: "The workspace belongs to the team, so next year's chair can open any company and read its whole story." },
  ],
};

export const PROBLEM = {
  headline: "Five ways a shared spreadsheet lets your team down",
  subhead:
    "A sheet with an owner column and a few cell colors holds up for the first weeks of outreach. Somewhere around the time the third officer starts adding rows, these five things begin to happen.",
  closing: "You can import last year's sheet as it is, columns and all, and sort out the rest as you go.",
  items: [
    {
      title: "Two officers pitch the same company",
      body: "The owner cell was empty, or out of date, or filled in a minute after the other officer pressed Send. The sponsor receives two introductions from one club, sometimes with different asks.",
      fix: "You claim a company before you can log outreach on it. The database lets exactly one officer hold it, and everyone else sees that officer's name and the date the claim ends.",
      note: "two owners, one lead",
      sheet: { row: 12, cells: ["Kestrel Aerospace", "Maya", "Dev", "sent?"] },
    },
    {
      title: "Follow-ups slip",
      body: "Nothing in a sheet says which rows are due today. The reply that needed an answer on the 9th is still sitting in row 84 on the 20th, and the only reminder is whoever happens to scroll past it.",
      fix: "Each outreach entry carries a follow-up date, set to 7 days out unless you change it. The home screen lists every company that is due, most overdue first.",
      note: "row 84, still waiting on the 20th",
      sheet: { row: 84, cells: ["Birchwood Foods", "Replied", "Oct 9", "answer?"] },
    },
    {
      title: "Nobody knows which pitch works",
      body: "Three versions of the intro email went out this semester. Replies came back to six different inboxes, and the one \"Replied?\" column was last updated in October.",
      fix: "Every outreach entry already records its channel, its date and who sent it, and when you send one of Coppice's drafts the entry can record which draft it was. Reply rate per pitch template is the next feature being built, so that comparison will sit in one place.",
      note: "which email worked?",
      sheet: { row: 31, cells: ["Intro v1, v2, v3", "Replied?", "", "last edit Oct"] },
    },
    {
      title: "Duplicate rows",
      body: "\"Acme Corp\" is in row 12 and \"acme corp\" is in row 140. Two more rows list acme.com and www.acme.com. Each one has a different officer's name next to it.",
      fix: "It flags look-alike names and websites and shows them together. It never merges or deletes anything. A person looks and decides.",
      note: "same company, four times",
      sheet: { row: 140, cells: ["acme corp", "acme.com", "www.acme.com", "Sofia"] },
    },
    {
      title: "History leaves with the graduating board",
      body: "The context lived in a senior's head and in a Drive folder that gets cleaned out in May. In August the new chair inherits a list of company names and has to guess who was contacted, who said no, and why.",
      fix: "Notes, channels, dates and stage changes sit on each company, inside a workspace that outlives its officers.",
      note: "ask Jake (Jake graduated)",
      sheet: { row: 57, cells: ["Hollis Machine", "Owner: Jake", "ask Jake", "?"] },
    },
  ],
};

export const SEASONS = {
  headline: "From last year's sheet to a pipeline the whole team can work from",
  subhead: "A board's year has four seasons. Importing happens once, claiming and logging become part of an officer's week, and turnover comes around every spring.",
  steps: [
    {
      season: "Autumn",
      tab: "Import",
      title: "Import last year's sheet",
      who: "Owner or Officer",
      body: "Export your spreadsheet as a CSV and upload it, up to 2,000 rows. Point each column at the right field, then choose, group by group, whether to skip or import look-alike companies.",
    },
    {
      season: "Winter",
      tab: "Claim",
      title: "Claim a company before you contact it",
      who: "Officer",
      body: "Press Claim on any company nobody else holds. It is yours for 14 days unless your chair changed that, and everyone else sees your name and the date the claim ends.",
    },
    {
      season: "Spring",
      tab: "Log and follow up",
      title: "Send from your inbox, then log it",
      who: "Officer",
      body: "Record the channel, a note and a follow-up date, which starts at 7 days out. Saving the entry renews your claim. On the follow-up date the company is back in your queue, most overdue first.",
    },
    {
      season: "Summer",
      tab: "Turnover",
      title: "The next board inherits the story",
      who: "Owner and Officer",
      body: "When officers graduate, the workspace stays. The incoming chair opens any company, reads every entry, note and stage change in order, claims it, and picks up from there.",
    },
  ],
  queue: {
    title: "Next fall, this is the first page the new chair opens",
    body: "The companies that are due, most overdue first, with the last note beside each name.",
  },
  imported: { title: "Imported from the sheet", body: "42 companies read. 2 groups of look-alike names are waiting for a person to decide." },
  rows: [
    { who: "Maya", what: "Email to Kestrel Aerospace", when: "Oct 28" },
    { who: "Maya", what: "Follow-up to Kestrel Aerospace", when: "Nov 4" },
    { who: "Dev", what: "LinkedIn to Birchwood Foods", when: "Nov 11" },
    { who: "Sam", what: "Call with Ridgeline Energy", when: "Feb 2" },
    { who: "Priya", what: "Packet sent to Tern Optics", when: "Apr 28" },
  ],
  claimTags: [
    { name: "Kestrel Aerospace", note: "Yours until Nov 11", mine: true },
    { name: "Birchwood Foods", note: "Priya R. until Oct 31", mine: false },
    { name: "Ridgeline Energy", note: "", mine: false },
  ],
  labels: ["Kestrel Aerospace", "Birchwood Foods", "Ridgeline Energy", "Tern Optics", "Northfield Bank"],
};

export const FEATURES = {
  headline: "What is in the workspace today",
  subhead: "Each of these exists in the app now. Importing a sheet and keeping history across boards are covered above.",
  items: [
    {
      icon: "claim",
      page: "p. 1",
      title: "Claim before you contact",
      short: "One officer holds a company at a time, and the database enforces it.",
      detail: "While a claim is live, nobody else can log outreach, change the stage or archive that company. Owners can force-release a claim from an officer who went quiet.",
    },
    {
      icon: "queue",
      page: "p. 2",
      title: "A follow-up queue as the home screen",
      short: "Every company that is due, most overdue first.",
      detail: "Each row shows how many days overdue it is and your last note. Mine narrows the list to companies you hold. Companies nobody has contacted yet sit in their own list.",
    },
    {
      icon: "board",
      page: "p. 3",
      title: "A stage board",
      short: "Six stages from first contact to a decision.",
      detail: "Not contacted, Contacted, Replied, In conversation, Committed and Declined. Logging the first outreach moves a company to Contacted, and every later move records who made it.",
    },
    {
      icon: "log",
      page: "p. 4",
      title: "An outreach log on every company",
      short: "Emails, LinkedIn messages, conversations and notes, all on the company.",
      detail: "Each entry shows the date, who logged it, the channel and what was said, plus the next follow-up date. The record is still there when the person who knew the contact has graduated.",
    },
    {
      icon: "duplicate",
      page: "p. 5",
      title: "Duplicates are flagged, never merged",
      short: "Coppice points at look-alikes. A person decides.",
      detail: "Names are compared without capitals, punctuation or endings like Inc and LLC, and websites without www or the path. Matches are shown together, and nothing is merged or removed on its own.",
    },
    {
      icon: "draft",
      page: "p. 6",
      title: "Drafts that stick to verified facts",
      short: "Drafts built only from facts your owner has checked.",
      tag: "AI, optional",
      detail: "Numbers that no verified fact supports, links, and lines like \"thanks for sponsoring us before\" are underlined for you to check. The draft opens in your own Gmail or Outlook, and you press Send there.",
    },
  ],
};

export const EXAMPLE = {
  headline: "Maya and Dev, same company, same second",
  subhead: "A made-up club, a real race. Both officers go for the same lead on a Wednesday morning, and the database lets one of them through.",
  setting: "Alder State Rocketry Club is a fictional student org with a 14-day claim window. Kestrel Aerospace came in from last year's sheet and has never been contacted.",
  when: "Wed, Oct 28, 9:02 AM",
  company: "Kestrel Aerospace",
  until: "Nov 11",
  refusal: "Held by Maya until Nov 11",
  mayaNote: "Yours until Nov 11. Logging outreach renews it for another 14 days.",
  devNote: "Held by Maya until Nov 11",
  devNext: "Dev moves on to Birchwood Foods, the next company down.",
  after: [
    { when: "Oct 28", title: "Maya sends and logs", body: "She writes from her own Gmail, logs the email and picks a follow-up on Nov 4, the 7 day default. Kestrel moves to Contacted and her claim renews." },
    { when: "Nov 4", title: "The queue brings it back", body: "Kestrel shows as due today on Maya's queue with her note under the name. On Dev's it reads Held by Maya, with no Claim button." },
    { when: "Nov 6", title: "A reply, and a record", body: "Maya logs Priya's reply and moves Kestrel to Replied. Next September the new chair reads the whole page, top to bottom." },
  ],
};

export const AUDIENCE = {
  headline: "Teams that change hands every year",
  subhead: "Coppice started at Purdue for sponsorship outreach and works for any school or organization where the people doing the asking rotate out.",
  items: [
    { title: "Student organizations", body: "Sponsorship chairs and officer teams who pass a spreadsheet to a new board every spring, and want the new board to know who was already asked." },
    { title: "Hackathons", body: "Organizing teams that approach dozens of companies for sponsorship before one weekend, then hand the whole list to next year's crew." },
    { title: "Nonprofits", body: "Volunteer boards that ask local businesses and corporate partners for support, where whoever has an hour that week sends the email." },
    { title: "Alumni boards", body: "Chapter officers who reach out to employers for speakers, mentors and event support, with officers rotating on a term or two." },
  ],
};

export const NAME = {
  headline: "Many stems, one root",
  subhead: "Coppice is said KOP-iss. The first syllable sounds like \"cop.\"",
  pronunciation: "KOP-iss",
  lead:
    "Coppicing is an old woodland practice. A woodcutter fells a tree down to its stump on a regular cycle, and the stump answers by sending up a crop of new stems from the same roots. Some coppiced stumps have been cut and regrown for centuries.",
  paragraphs: [
    "A student board works on a similar rhythm. Every spring the officers graduate, and what remains is the set of relationships with companies: who was asked, who said yes, who said to try again in the fall. Coppice keeps those in the workspace so the next board grows back from them.",
    "The name has a second reading in its first syllables, co-piece: working alongside someone, each of you holding a piece of the same list.",
  ],
};

export const TRUST = {
  headline: "What Coppice will never do",
  subhead: "These are limits built into how the app works, and each one has a specific mechanism behind it.",
  items: [
    { title: "Send email for you", body: "Coppice has no send button. A draft opens in your own Gmail or Outlook compose window, and you press Send from your own address. Coppice never connects to your inbox." },
    { title: "Merge your data silently", body: "Look-alike companies are flagged and shown together. Nothing is merged, blocked or deleted until a person decides what to do with the group." },
    { title: "Let AI write to your pipeline without a person confirming", body: "AI drafts text and lists facts from a packet. A fact cannot be used in a draft until the owner verifies it, a draft stays on the screen until you choose to send it from your own inbox, and a stage, a claim or a log entry changes only when an officer presses the button." },
    { title: "Share one team's data with another", body: "Every workspace is separated inside the database, using row-level security in Postgres, so one team's companies, notes and members are not visible to another team's accounts." },
  ],
  alsoOut: "Also out of scope: payments, and public pages for companies to visit.",
  comingTitle: "Coming next",
  comingNote: "These are announced and not built yet. Nothing here exists in the app today.",
  coming: [
    { tag: "Next", title: "Reply rate per pitch template", body: "See which version of your pitch gets answers, so the next board starts from what worked." },
    { tag: "Later", title: "Pipeline Copilot", body: "A chat that answers questions about your pipeline. Anything it proposes changing waits for a person to confirm." },
    { tag: "Later", title: "Research briefs", body: "A short background read on a company before you reach out." },
    { tag: "Later", title: "Turnover Time Capsule", body: "At the end of the term, a \"wrapped\"-style history of the year handed to the incoming board." },
  ],
  privacy: [
    { title: "AI is optional", body: "The owner turns it on or off for the whole workspace and sets how many AI calls the workspace may make in a 30-day period. With AI off, none of the text below is sent anywhere." },
    { title: "Names and emails stay home", body: "People's names and email addresses never go to the AI provider. The provider's free tier may use what it receives to improve its products, so a draft is written with placeholders for first name, sender name and organization name, and Coppice fills in the real names after the draft comes back." },
    { title: "What does go to the provider", body: "While AI is on: the text of the packet you uploaded, your verified facts, the company's name, industry and website, the contact's job title, and any note you add to a draft request. Keep anything private out of the packet." },
    { title: "Emails stay with owners", body: "Officers do not see other members' email addresses. Only owners can view them." },
    { title: "Contacts never log in", body: "Company contacts never log in and never receive anything from Coppice." },
    { title: "Archiving keeps the history", body: "An archived company leaves the board and queue, and it can be unarchived later." },
  ],
};

export const START = {
  headline: "Set up a workspace in four steps",
  subhead: "You need a Google account and last year's sheet, if you have one.",
  steps: [
    { title: "Sign in with Google", body: "One click, with no new password to remember." },
    { title: "Create a workspace, or join your chair's", body: "The chair creates the workspace and becomes its Owner. Everyone else signs in with the email address the chair invited and presses Join." },
    { title: "Invite your officers and set your claim window", body: "Owners invite officers by email address and choose how long a claim lasts, from 1 to 60 days. The default is 14. Coppice does not send the invite, so tell them to sign in." },
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
  subhead: "Setting up takes a Google sign-in and a CSV. Free for student teams, with unlimited officers.",
};

export const FOOTER = {
  tagline: "Coppice. Capisce?",
  pronunciation: "KOP-iss",
  links: [
    { href: "#how", label: "How it works" },
    { href: "#features", label: "Features" },
    { href: "#example", label: "Live example" },
    { href: "#faq", label: "FAQ" },
  ],
  handle: "@coppiceteam",
  origin: "Built by a student at Purdue, for teams that change hands every year.",
  disclaimer: "Coppice is an independent student project and is not an official Purdue University product.",
  copyright: "© 2026 Coppice",
};
