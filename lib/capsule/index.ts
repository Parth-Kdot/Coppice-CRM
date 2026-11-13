// The Time Capsule (lib/capsule/): the board's year in Coppice, the handoff to next year's board,
// and Ask the Archive. The recap, the playbook and the calendar's proposals are code only; the
// relationship cards and the archive answers are read by Groq and checked by code.
//
//   recap.ts      "Your year in Coppice": pure math over flat queries (Part 1)
//   members.ts    who is leaving, and releasing their claims (2a)
//   select.ts     which companies get cards, in what order (2b)
//   notes.ts      the notes the model is shown, masked and labelled as data (2b)
//   check.ts      what the model's bullets and sentences must pass (2b, 3)
//   facts.ts      the code-read facts every card carries (2b)
//   report.ts     starting a handoff and reading its cards a chunk at a time (2b)
//   redact.ts     approve, hide, show (2c)
//   view.ts       what an owner sees, and what officers see once it is published (2c, 2f)
//   playbook.ts   the playbook page (2d)
//   calendar.ts   proposed re-contact dates and the owner's saved ones (2e)
//   publish.ts    publish and unpublish (2f)
//   archive.ts    Ask the Archive (3)

export { askArchive, archiveTerms, type ArchiveAnswer, type Footnote } from "./archive";
export { fillBlankDates, loadCalendar, proposeRecontact, saveRecontactDates, type CalendarRow, type SavedDates } from "./calendar";
export * from "./limits";
export { listMembers, releaseDepartingClaims, setDeparting, type HandoffMember, type ReleasedClaims } from "./members";
export { loadPlaybook, type Playbook } from "./playbook";
export { publishReport, unpublishReport } from "./publish";
export { loadRecap, type Recap } from "./recap";
export { approveCard, approveRest, setHidden } from "./redact";
export { buildCodeCards, readCardChunk, startReport, type ChunkRead, type ChunkResult, type ReportStart } from "./report";
export { listYears, memberView, ownerView, type CardView, type MemberCard, type MemberView, type OwnerView, type YearRow } from "./view";
export { currentBoardYear, PAST_YEARS, yearWindow } from "./year";
