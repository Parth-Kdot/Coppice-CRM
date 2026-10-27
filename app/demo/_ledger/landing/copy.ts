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
  headline: "Four seasons of a board",
  subhead: "Coppicing is an old woodland practice: cut a tree to its stump and it regrows many stems from the same roots. A student board has the same rhythm.",
  seasons: [
    {
      name: "Autumn",
      line: "A new board takes over",
      body: "Import last year's sheet. The columns map, look-alike companies are shown together, and the pipeline starts with a full list instead of a blank page.",
    },
    {
      name: "Winter",
      line: "The stems are cut back",
      body: "The old officers graduate and their claims are released. Every outreach entry, note and stage change stays on its company, kept as ledger rows.",
    },
    {
      name: "Spring",
      line: "More shoots from the same roots",
      body: "Claim before you contact, so each new officer works a company alone. The queue brings every follow-up back on the date it was due.",
    },
    {
      name: "Summer",
      line: "Full growth",
      body: "Committed sponsors hang from the stems, each with the story of how it got there still on file for next year's chair.",
    },
  ],
  labels: ["Kestrel Aerospace", "Birchwood Foods", "Ridgeline Energy", "Tern Optics", "Northfield Bank"],
  rows: [
    { who: "Maya", what: "Email to Kestrel Aerospace", when: "Mar 3" },
    { who: "Dev", what: "LinkedIn to Birchwood Foods", when: "Mar 11" },
    { who: "Sam", what: "Call with Ridgeline Energy", when: "Apr 2" },
    { who: "Maya", what: "Follow-up to Kestrel Aerospace", when: "Apr 14" },
    { who: "Priya", what: "Packet sent to Tern Optics", when: "Apr 28" },
  ],
};

export const HOW = {
  headline: "From last year's sheet to a pipeline the whole team can work from",
  subhead: "The first step is done once when the workspace is set up, and the other four become part of an officer's week.",
  steps: [
    {
      title: "Import last year's sheet",
      who: "Owner or Officer",
      body: "Export your spreadsheet as a CSV and upload it, up to 2,000 rows. Point each column at the right field, then look over any groups of look-alike companies and choose, group by group, whether to skip them or import them. You can also add companies one at a time.",
    },
    {
      title: "Claim a company before you contact it",
      who: "Officer",
      body: "Press Claim on any company nobody else holds. It is yours for your team's claim window, which is 14 days unless your chair changed it. Everyone else sees your name and the date the claim ends.",
    },
    {
      title: "Contact from your own inbox, then log it",
      who: "Officer",
      body: "Write the email yourself, or open a draft in Gmail or Outlook from Coppice, and send it from your own account. Back in Coppice, record the channel (email, LinkedIn, in person or other), add a note, and choose a follow-up date. The date starts at 7 days from today. Saving the entry renews your claim.",
    },
    {
      title: "The queue brings it back",
      who: "Officer",
      body: "On the follow-up date the company appears on your home screen, with the most overdue ones first and your last note beside each name. As things happen, move it along the board: Replied, In conversation, Committed or Declined.",
    },
    {
      title: "The next board inherits the story",
      who: "Owner and Officer",
      body: "When officers graduate, the workspace stays. The incoming chair opens any company, reads every outreach entry, note and stage change in order, claims it, and picks up from there.",
    },
  ],
  numbers: [
    { n: "14", unit: "days", what: "default claim window, owners can set 1 to 60" },
    { n: "7", unit: "days", what: "default time to the next follow-up" },
    { n: "6", unit: "stages", what: "Not contacted to Declined" },
    { n: "2,000", unit: "rows", what: "per CSV import" },
  ],
};

export const FEATURES = {
  headline: "What is in the workspace today",
  subhead: "Each of these exists in the app now, except the block labeled Coming next.",
  items: [
    {
      icon: "claim",
      title: "Claim before you contact",
      short: "One officer holds a company at a time, and the database enforces it.",
      long: "When two officers press Claim in the same second, one claim goes through and the other officer is told who got there first and until when. While a claim is live, nobody else can log outreach on that company, change its stage or archive it. The claim ends after your team's claim window and renews each time you log outreach. Owners can force-release a claim from an officer who went quiet, and a claim is released automatically when its holder leaves the workspace. Expiry is judged by the database's clock, so a laptop with the wrong time cannot hold a company longer than it should.",
    },
    {
      icon: "queue",
      title: "A follow-up queue as the home screen",
      short: "Every company that is due, most overdue first.",
      long: "The first thing you see after signing in is the list of open companies whose follow-up date has arrived, with how many days overdue each one is and your last note beside it. An \"Only mine\" filter narrows the list to companies you currently hold. A second list shows companies nobody has contacted yet, leaving out the ones another officer has claimed. Companies marked Committed or Declined leave the queue.",
    },
    {
      icon: "board",
      title: "A stage board",
      short: "Six stages from first contact to a decision.",
      long: "Not contacted, Contacted, Replied, In conversation, Committed and Declined. A company moves from Not contacted to Contacted on its own when you log the first outreach, and every later move is recorded with who made it. Moving a company to Committed or Declined closes the pitch and clears its claim, and Coppice asks you to confirm first.",
    },
    {
      icon: "log",
      title: "An outreach log on every company",
      short: "Emails, LinkedIn messages, conversations and notes, all on the company.",
      long: "Each entry shows the date, who logged it, the channel (Email, LinkedIn, In person or Other) and what was said, plus the next follow-up date. The company page also keeps a stage history. When the person who knew the contact has graduated, the record is still there to read.",
    },
    {
      icon: "duplicate",
      title: "Duplicates are flagged, never merged",
      short: "Coppice points at look-alikes. A person decides.",
      long: "Names are compared with capital letters, punctuation, a leading \"the\" and endings like Inc, LLC and Corp ignored, so \"Acme, Inc.\", \"ACME Corp\" and \"acme corporation\" count as the same name. Websites are compared without \"www\" or the path, so acme.com and www.acme.com match. Matching companies are grouped and shown together. Nothing is merged, blocked or removed on its own.",
    },
    {
      icon: "import",
      title: "CSV import",
      short: "Bring last year's sheet in, up to 2,000 rows.",
      long: "Upload a CSV, map your columns to Coppice's fields, and review the result before anything is saved. Groups of look-alike companies are listed together, and for each group you choose whether to skip it or import it. Files can be up to 3 MB.",
    },
    {
      icon: "draft",
      title: "Pitch drafts that stick to verified facts",
      short: "Drafts built only from facts your owner has checked.",
      tag: "AI, optional",
      long: "The owner uploads the sponsorship packet and Coppice lists the facts in it, each with the page number and the quote it came from. A fact can be used in a draft only after the owner verifies it. Each request produces two variants. Numbers that no verified fact supports, links, and lines like \"thanks for sponsoring us before\" are underlined so you can check them before sending. When a draft is ready, it opens in your own Gmail or Outlook compose window and you press Send from your own address. Owners can switch AI off for the whole workspace.",
    },
    {
      icon: "history",
      title: "History that survives turnover",
      short: "The workspace outlives the board.",
      long: "Companies, outreach entries, notes and stage changes belong to the workspace, whoever typed them. When an officer leaves, their claims are released and everything they logged stays. Archiving a company hides it from the board and queue and keeps its history.",
    },
  ],
  coming: [
    { tag: "Next", title: "Reply rate per pitch template", body: "See which version of your pitch gets answers, so the next board starts from what worked." },
    { tag: "Later", title: "Pipeline Copilot", body: "A chat that answers questions about your pipeline. Anything it proposes changing waits for a person to confirm." },
    { tag: "Later", title: "Research briefs", body: "A short background read on a company before you reach out." },
    { tag: "Later", title: "Turnover Time Capsule", body: "At the end of the term, a \"wrapped\"-style history of the year handed to the incoming board." },
  ],
  roles: [
    { title: "Owner", body: "Usually the chair. Creates the workspace, invites officers, sets the claim window, verifies the facts AI drafts may use, turns AI on or off, and can force-release a claim." },
    { title: "Officer", body: "Adds or imports companies, claims them, logs outreach and works the queue." },
    { title: "Company contacts", body: "They never log in. They are records in your pipeline." },
  ],
  pricing: "Free for student teams, with unlimited officers.",
};

export const EXAMPLE = {
  headline: "Maya and Dev, same company, same second",
  subhead:
    "A made-up club, a real race. Here is what each officer sees when they both go for the same lead on Monday morning, and what brings it back two weeks later.",
  setting: "Alder State Rocketry Club is a fictional student org with a 14-day claim window. The company is Kestrel Aerospace, imported from last year's sheet and never contacted.",
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
  lines: ["New board, same roots.", "Many stems, one root.", "Coppice. Capisce?"],
  glossary: [
    { term: "Stems", def: "the officers and boards that come and go on a cycle." },
    { term: "Roots", def: "the companies, contacts, notes and history that stay." },
    { term: "One base", def: "a single workspace that everyone on the team works from." },
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
    { title: "Create a workspace, or open your chair's invite link", body: "The chair creates the workspace and becomes its Owner. Everyone else joins by opening the invite link they were sent." },
    { title: "Invite your officers and set your claim window", body: "Owners invite officers with a copyable invite link and choose how long a claim lasts, from 1 to 60 days. The default is 14." },
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
  { q: "Can two people claim the same company at once?", a: "No. If two officers press Claim in the same moment, the database lets one through. The other sees who got there first and the date their claim ends." },
  {
    q: "What about Microsoft or Outlook accounts?",
    a: "Sign-in is with Google today. Your outreach can still come from any inbox: drafts open in Gmail, in Outlook on the web with a work or school Microsoft 365 account, or in your computer's default mail app.",
  },
  { q: "Can we bring last year's sheet?", a: "Yes. Export it as a CSV and upload it, up to 2,000 rows and 3 MB. You map the columns, and any groups of look-alike companies are shown so you can skip or import each group." },
  {
    q: "What happens at board turnover?",
    a: "The workspace and everything in it stays. The outgoing chair makes the incoming chair an Owner in Settings, then steps down to Officer or leaves, and the new board can open any company to read its outreach entries, notes and stage changes. Claims held by someone who leaves the workspace are released.",
  },
  { q: "Does it work on phones in a browser?", a: "Yes. Coppice is a website, so there is nothing to install, and you can check the queue, claim a company and log outreach from your phone's browser." },
  { q: "Who can do what?", a: "Owners create the workspace, invite officers, set the claim window, verify the facts AI drafts may use, and can force-release claims. Officers add or import companies, claim them, log outreach and work the queue." },
  { q: "Do the companies we contact need accounts?", a: "No. Company contacts never log in, and Coppice never emails them." },
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
