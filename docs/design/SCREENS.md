# Screen inventory

This is the functional contract for the design exploration. It lists every screen of the real app, what each one shows, every control, every state, and every link between screens. A design may change how anything looks, moves or is arranged. It may not drop anything listed here, because each item is something an officer needs or something the app enforces.

The app is being renamed from BoilerPitch to **Coppice**. The real screens still say BoilerPitch in a few places (the sign-in heading, the page title). Prototypes should say Coppice.

How to read this file:

- **Real route** is where the screen lives in the working app. **Prototype route** is where the clickable prototype lives. Both are listed for every screen. The prototype routes are built with `demoRoutes` in `demo/routes.ts`.
- **Source** names the files that were read to write each section, so a claim here can be checked.
- Text in quotation marks is the exact wording the real app uses. Keep the meaning of every message. Rewording for tone is fine; losing the information is not (for example, a lost claim must still name who holds the company and until when).
- **Prototype wiring** lines name the hooks and actions in `demo/store.tsx` that supply the data and behavior for the screen.
- Anything the prototypes add that the real app does not have is marked **Prototype addition**.

Contents:

1. Shared rules that apply on every screen
2. Sign-in
3. Workspace list
4. Queue (workspace home)
5. Board
6. Company page
7. New company
8. Import
9. Fact sheet
10. Settings
11. Navigation map
12. Message catalog
13. Prototype additions and demo tools
14. Future screens to leave room for

---

## 1. Shared rules that apply on every screen

### Who the user is

- Sign-in is Google only. There is no password and no sign-up form.
- A signed-in person belongs to zero or more **workspaces** (one per student org). In each workspace they are either an **Owner** or an **Officer**. The screens show the role as "Owner" or "Officer". Internally the officer role is called "member".
- Workspaces are private. They are never listed or searchable except through the person's own memberships and the invitations addressed to their own verified email.
- A person who is not a member of a workspace sees a plain 404 page for any of its URLs. The 404 is identical for a workspace that does not exist, so ids cannot be probed. A company id from another workspace also gives a 404.

### Roles at a glance

| Capability | Officer | Owner |
| --- | --- | --- |
| See the queue, board, company pages, verified facts | yes | yes |
| Claim, release their own claim, log outreach, move stage, edit companies and contacts, archive, import CSV, draft emails | yes | yes |
| Force-release someone else's claim, and move or archive a company someone else holds | no | yes |
| See member emails, change roles, remove members, invite, cancel invitations | no | yes |
| Change the claim window, the AI switch and the AI limit | no | yes |
| See the "Waiting for your check" list, verify or unverify, edit, add and delete facts, upload and delete packets | no | yes |
| Leave a workspace | yes | yes, unless they are the last owner |

### Claims

A **claim** says "I am pitching this company". It is the central idea of the product, so every design must make it legible.

- Four claim states exist for a company, from the point of view of the signed-in person:
  - **Free**: nobody holds it. Shown as "Not claimed." on the company page and as a Claim button elsewhere.
  - **Mine**: the person holds it and the claim has not expired. Shown as "Yours until Oct 30" (compact) or "You hold this until Oct 30, 2026, 3:00 PM." (full).
  - **Theirs**: someone else holds it and the claim has not expired. Shown as "Held by Sam Lee until Oct 30" (compact) or "Held by Sam Lee until Oct 30, 2026, 3:00 PM." (full).
  - **Expired**: a claim exists but its time ran out. Anyone may take the company. Shown as "Sam Lee's claim expired Oct 20, 2026, 3:00 PM." on the company page, and as a Claim button elsewhere.
- A claim lasts the workspace's **claim window** (default 14 days, set by an owner, 1 to 60 days). Claiming again while you hold it renews it. Logging outreach renews it.
- While someone else holds a live claim, an officer cannot log outreach on the company, move its stage, archive it, or draft an email for it. An owner can force-release the claim.
- Moving a company to Committed or Declined clears the claim. Committed and Declined companies cannot be claimed.
- Drafting an email claims the company for the person first, and the claim stays even if the AI then fails.
- Losing a race to claim shows: "Sam Lee claimed this first. They hold it until Nov 1, 2026, 3:00 PM." Blocking messages for other actions end with "Ask them, or an owner."

### Stages

Six stages, in this order, with these labels: Not contacted, Contacted, Replied, In conversation, Committed, Declined. Committed and Declined are the **outcomes**: they close the pitch, clear the claim, and keep companies out of the queue. Moving to an outcome always asks first: "Move to Committed? This closes the pitch and releases any claim." (the same text with Declined). Cancelling puts the stage control back to the company's real stage.

Logging the first outreach on a Not contacted company moves it to Contacted automatically and records the move in the stage history.

### Dates and time

- Every date is shown in West Lafayette time (Purdue's time zone), whatever the viewer's time zone is.
- Compact date: "Oct 30". Full: "Oct 30, 2026, 3:00 PM".
- Follow-up dates are calendar days, not moments. A follow-up for Nov 1 is "Due today" all of Nov 1 and "1 day overdue" on Nov 2.
- Queue wording: "Due today", "1 day overdue", "N days overdue". Board wording: "Follow up Oct 30" with a red "(overdue)" when it is past, or "No follow-up set".
- The prototypes fix "now" at Wednesday Oct 28, 2026, 3:00 PM so every viewer sees the same text. See `demo/dates.ts` and never use `toLocaleString` or the real clock in a prototype.

### Feedback conventions

- Every action that changes data runs from a button. While it runs the button is disabled and its label changes: "Working...", "Moving...", "Saving...", "Drafting... (up to a minute)", "Checking...".
- Failures appear directly under the control that caused them, in red, announced to screen readers (`role="alert"`). The message is a full sentence naming the cause. It is never a generic "Something went wrong".
- Successes that need a word say it next to the control: "Saved.", "Logged.", "Invitation created.", "Added and verified.", "Done. Check the facts below.", "Copied the subject." Others just update the page.
- Actions that remove or close something ask first with a confirmation: leaving a workspace, removing a member, releasing a claim, force-releasing a claim, archiving a company, archiving a duplicate, removing a contact, deleting a fact, deleting an uploaded file, moving to Committed or Declined. The exact texts are in the message catalog.
- Where a view can be filtered, expanded or collapsed, the choice lives in the URL (`?mine=1`, `?never=1`, `?all=due`, `?q=acme`, `?show=COMMITTED`), so a view can be bookmarked and the Back button works. Changing a filter does not jump the page to the top. Malformed values in the URL are ignored, never an error.
- Lists have caps. The queue shows 50 rows per section, the board 50 cards per column, with a "Show all N" link that raises the cap to 2,000. The duplicates box stops at 50 pairs and then shows "50+".

### Accessibility details the real screens already have

Keep these, or do better:

- Toggles that are links carry `aria-pressed` (Only mine) or `aria-expanded` (Never contacted, Committed, Declined, Possible duplicates, Archived).
- Every input has a label or an `aria-label` ("Workspace name", "Search companies", "Industry", "Stage", "Channel", "Note", "Contact name", "Contact title", "Contact email", "Send to", "Note for the AI", "Claim window in days", "AI on for this workspace", "Fact", "New fact", "Sponsorship packet PDF", "Email", "Role").
- Draft fields are labelled "Draft 1 subject", "Draft 1 body", and so on.
- The claim check box is a live region (`aria-live="polite"`). The import result is `role="status"`. Errors are `role="alert"`.
- The duplicate radio buttons are labelled "Import row 3" and "Skip row 3" and sit in a fieldset whose legend is "Row 3".
- Expand and collapse controls, the "Waiting" counts and the claim badges all work without color: text always says the state.

### Limits to show or respect

| Item | Limit |
| --- | --- |
| Workspace name | 2 to 80 characters |
| Company name, industry, website, notes | 120, 80, 300, 5,000 characters |
| Contact name, email, title | 120, 254, 120 characters |
| Outreach note | 2,000 characters |
| Draft note to the AI | 300 characters |
| Fact | 300 characters |
| Follow-up date | today up to one year out |
| Claim window | 1 to 60 days |
| AI limit | 0 to 5,000 calls per 30 days (0 pauses AI without switching it off) |
| AI drafts per person | 40 per 24 hours |
| CSV file | .csv, 3 MB, 2,000 rows, 200 columns |
| PDF packet | 3.5 MB, 40 pages, text PDF (not a scan) |
| Invitation | valid 7 days |

---

## 2. Sign-in

- **Real route:** `/signin`. **Prototype route:** `/demo/signin`.
- **Source:** `app/(auth)/signin/page.tsx`, `components/auth-buttons.tsx`, `lib/auth-client.ts`, `app/page.tsx`.
- **Purpose:** the only way in. Starts Google sign-in.

### Data shown

- The app name (Coppice) as the page heading.
- One sentence: "Your org's shared sponsorship pipeline. Sign in to continue."

### Controls

- **Sign in with Google**: sends the person to Google, then to the workspace list.
- There is no email field, no password, no "create account" and no "forgot password".

### States

- Already signed in: the page is skipped and the person lands on the workspace list.
- Signed out and visiting any other page, including `/`: sent here. (`/` redirects to the workspace list, which redirects signed-out visitors here.)
- The real page has no loading, error or empty states of its own. Google and the auth service show their own screens if sign-in fails. Sign-in attempts are rate limited per network address (3 per 10 seconds). A design may add a "Redirecting to Google..." state.
- After sign out (a button on the workspace list and on the queue), the person returns here.

### Links

- Out: the workspace list, after sign-in.
- In: sign out, any page while signed out, the landing page's sign-in button.

### Prototype wiring

The button calls `signIn()` and goes to `demoRoutes.workspaces()`. Nothing enforces sign-in in the prototype; `state.signedIn` exists so a design can show a signed-out header. The landing page at `/` belongs to each design branch.

---

## 3. Workspace list

- **Real route:** `/workspaces`. **Prototype route:** `/demo/workspaces`.
- **Source:** `app/(app)/workspaces/page.tsx`, `app/(app)/workspaces/actions.ts`, `lib/auth.ts` (who may create a workspace).
- **Purpose:** choose which org to work in, accept an invitation, or create a workspace.

### Data shown

- Heading: "Your workspaces".
- For each membership, in the order the person joined: the workspace name (a link) and their role, "(Owner)" or "(Officer)".
- An **Invitations** section, only when there are any: "Boilermaker Formula Racing as Officer" with a Join button. Only invitations addressed to the person's own verified email, still pending and not expired, are shown. If the email is not verified, none are.
- A **Create a workspace** section, only for people on the allowed-creators list.
- The no-workspace message, only when there is nothing else to show (see states).

### Controls

- **Sign out** (header). Ends the session and returns to sign-in.
- **Workspace name link**: opens that workspace's queue.
- **Join** (per invitation): accepts the invitation and opens the workspace. A second press, after already joining, just opens the workspace. If the invitation is gone or the email does not match, the reason shows next to the button.
- **Create** with a name box (placeholder "Org name", label "Workspace name"): creates the workspace, makes the person its Owner, and opens its queue.

### States

- **Normal:** one or more workspaces.
- **Invitations waiting:** the Invitations section appears above or below the list.
- **Nothing here and cannot create:** "No workspace is linked to **jordan@purdue.edu**. Ask your sponsorship chair to invite this email, or sign in with a different Google account." and a "Use a different account" button that signs out.
- **Can create:** the Create a workspace form is always shown to allowed people, even when they already have workspaces. A person on the list with no workspaces sees only the form.
- **Errors:** "Name must be at least 2 characters." (the real app uses its validation library's wording for a name over 80 characters; the prototype says "Name can be at most 80 characters."). A person not on the list who forces the action gets "You are not allowed to create a new workspace".
- **Working:** the Join and Create buttons show "Working...".

### Links

- Out: any workspace's queue; sign-in (after sign out).
- In: sign-in success; "Switch workspace" on the queue; leaving a workspace in Settings.

### Prototype wiring

`useWorkspaceList()` gives the cards (workspace, role, member count, company count, due count, my live claims), the invitations, `canCreate` and `nothingHere`. Actions: `acceptInvitation(id)`, `createWorkspace(name)`, `signOut()`. The seed gives three workspaces and one pending invitation to a fourth. Use `setFlags({ canCreateWorkspace: false })` and a fresh `leaveWorkspace` to reach the empty state.

---

## 4. Queue (workspace home)

- **Real route:** `/[workspaceId]`. **Prototype route:** `/demo/w/[ws]`.
- **Source:** `app/(app)/[workspaceId]/page.tsx`, `lib/queue.ts`, `lib/claims.ts`, `lib/dates.ts`.
- **Purpose:** the daily screen. It answers "who should I follow up with today?" and lets the officer claim a company and log what they did, with one click each.

### Data shown

- Workspace name (heading) and "You are Owner" or "You are Officer".
- **Due (N)**: every open company whose follow-up date is today or earlier. N counts all of them, even when only the first 50 rows are listed. "Open" means not archived and not Committed or Declined.
- For each due company, one row with:
  - the company name, linking to its page;
  - the timing: "Due today", "1 day overdue" or "N days overdue";
  - the claim badge: "Yours until Oct 30" (mine) or "Held by Sam Lee until Oct 30" (theirs); nothing for free or expired;
  - the latest outreach note for that company, quoted on its own line and cut to one line;
  - the one button that fits the claim state (see controls).
- Rows are sorted most overdue first, then by name.
- **Never contacted (N)**: fresh leads. A company is a fresh lead when it is Not contacted, has no follow-up date, and nobody else holds it. N counts them all. With "Only mine" on, it counts only the ones the person holds.
- Each fresh lead is a row like a due row, with the timing "No outreach yet", sorted newest first.

### Controls

- **Only mine** toggle (`?mine=1`): limits Due to companies the person holds a live claim on, and Never contacted to the ones they hold. Clears any "Show all".
- **Never contacted** heading, a toggle (`?never=1`): expands or collapses the fresh-lead list. It starts collapsed. Shows a right-pointing marker when closed, a down-pointing one when open.
- **Show all N** (`?all=due`, `?all=never`): appears when more than 50 rows exist in a section; lists up to 2,000.
- **Claim** (free or expired companies): claims it in place. On success the row changes to "Yours until ..." with a Log outreach button.
- **Log outreach** (companies the person holds): jumps to the log form on the company page (`#log-outreach`).
- Header buttons: **Board**, **Add company**, **Import**, **Settings**, **Switch workspace** (to the workspace list), **Sign out**. There is no Fact sheet button here; the fact sheet is reached from Settings. A design may promote it.
- Company name links open the company page.

### States

- **Empty due, all companies:** "Nothing is due. Log outreach with a follow-up date and it comes back here when it's due."
- **Empty due, Only mine on:** "Nothing of yours is due."
- **Never contacted, collapsed:** only the heading and the count.
- **Never contacted, open but zero:** no rows. The count reads 0.
- **Lost claim:** pressing Claim on a company someone claimed in the meantime shows under the button: "Sam Lee claimed this first. They hold it until Nov 1, 2026, 3:00 PM." The name and the expiry must stay in the message.
- **Claim of a company that just closed or was archived:** "This company is Committed, so it can't be claimed." or "Company not found."
- **Working:** the Claim button shows "Working...".
- **Row of a company held by someone else:** shows the badge and no button (the person can open the page to read it).
- Committed, Declined and archived companies never appear.

### Links

- Out: company page (name, Log outreach), board, new company, import, settings, workspace list.
- In: workspace list, sign-in success (via the workspace list), every screen's Back button, the import result's "Go to the queue" (opens with Never contacted expanded), creating a workspace.

### Prototype wiring

`useQueueFilters()` reads the URL; `useQueue(ws, filters)` returns `due`, `dueCount`, `never` (null while collapsed), `neverCount`, `hasMoreDue`, `hasMoreNever`. Each row has `company`, `claim`, `timing`, `daysOverdue`, `contact`, `lastNote` and `action` ("claim", "log-outreach" or "none"). Actions: `claimCompany(ws, id)`. Links: `demoRoutes.queue(ws, { mine: true })`, `demoRoutes.company(ws, id, { anchor: "logOutreach" })`.

---

## 5. Board

- **Real route:** `/[workspaceId]/board`. **Prototype route:** `/demo/w/[ws]/board`.
- **Source:** `app/(app)/[workspaceId]/board/page.tsx`, `components/board-search.tsx`, `components/stage-form.tsx`, `lib/board.ts`, `lib/companies.ts`.
- **Purpose:** see the whole pipeline by stage, move companies between stages, and clean up look-alike companies.

### Data shown

- Heading "Board".
- **Six columns**, one per stage, each headed "Stage label (count)". The count is the number of matching active companies in that stage, even when the column is collapsed.
- Not contacted, Contacted, Replied and In conversation are always open. **Committed** and **Declined** start collapsed.
- Each **card**:
  - company name, a link to its page;
  - industry, when set;
  - follow-up: "Follow up Oct 30", plus a red "(overdue)" when the date has passed, or "No follow-up set";
  - claim line: "Yours until Oct 30", "Held by Sam Lee until Oct 30", or a Claim button; closed companies (Committed, Declined) show no claim line;
  - a stage control: a dropdown of all six stages and a Move button.
- Cards are sorted by soonest follow-up (companies without one last), then by name.
- **Possible duplicates (N)** section, collapsed by default ("50+" when capped).
- **Archived (N)** section, collapsed by default.

### Controls

- **Search companies** box (type search, up to 100 characters, 300 ms after the last keystroke it updates `?q=`). Shows "Loading..." while the board refreshes. Matches name, case-insensitive, literal text (typing `100%` searches for `100%`).
- **Industry** dropdown ("All industries" plus every industry used in the workspace, `?industry=`).
- A new search or industry choice resets any "Show all".
- **Committed** and **Declined** column headings toggle open and closed (`?show=COMMITTED,DECLINED`).
- **Show all N** under a column with more than 50 cards (`?all=CONTACTED`): lists up to 2,000.
- **Claim** on a card whose company is free or expired. Same behavior and same lost-claim message as the queue.
- **Stage dropdown and Move** on each card. The Move button is disabled until a different stage is chosen, and reads "Moving..." while it works. Moving to Committed or Declined asks first. Moving a company someone else holds fails (see states).
- **Possible duplicates** toggle (`?dupes=1`). Open, it explains: "Companies that look alike (same name ignoring case and Inc/LLC/Corp, or same website). Archive the copy, or keep both as separate entries so they stop being flagged." Each pair shows both names (links) with their websites and why they match: "same name", "same website" or "same name and website". Three buttons per pair:
  - "Same company: archive {name of the first}" and "Same company: archive {name of the second}", each asking "Archive {archived one} and keep {kept one}? You can unarchive it later.";
  - "Separate entries": remembers the pair as separate so it stops being flagged.
- **Archived** toggle (`?archived=1`). Open, it lists archived companies (name link, industry) each with an **Unarchive** button. Unarchiving here keeps the person on the board.
- Header buttons: **Add company** and **Back** (to the queue).

### States

- **No companies at all:** "No companies yet. Add your first one."
- **Filters match nothing:** "No companies match."
- **Empty column:** the heading shows a count of 0 and no cards.
- **Collapsed outcome columns:** only the heading with its count.
- **Stage move refused:** shows under the card's control, for example "Sam Lee holds this company until Nov 1, 2026, 3:00 PM. Ask them, or an owner." Owners are not blocked.
- **Archive refused:** the same "holds this company" message for an officer when the company to archive is held by someone else.
- **No duplicate pairs:** the section shows a count of 0 and an empty list.
- **Working:** every form button shows "Working..." or "Moving...".

### Links

- Out: company pages (card names, duplicate names, archived names), new company, queue.
- In: queue header, the import result's "See the board", company page after archiving (via the queue).

### Prototype wiring

`useBoardFilters()` reads the URL; `useBoard(ws, filters)` returns `columns` (each with `cards`, `count`, `open`, `hasMore`), `total`, `industries`, `archivedCount`, `archived`, `duplicatePairs`. Actions: `claimCompany`, `moveStage`, `archiveDuplicate(ws, keepId, archiveId)`, `keepSeparate(ws, a, b)`, `unarchiveCompany`. The seed has two look-alike pairs: Eli Lilly and Lilly (same website), Rolls-Royce and Rolls Royce Corporation (same name).

When moving to Replied or later, the prototype asks which outreach got the reply; see section 6 and section 13.

---

## 6. Company page

- **Real route:** `/[workspaceId]/companies/[companyId]`. **Prototype route:** `/demo/w/[ws]/companies/[companyId]`.
- **Source:** `app/(app)/[workspaceId]/companies/[companyId]/page.tsx`, `components/claim-panel.tsx`, `components/company-form.tsx`, `components/draft-panel.tsx`, `components/stage-form.tsx`, `companies/actions.ts`, `companies/draft-actions.ts`, `lib/claims.ts`, `lib/companies.ts`, `lib/drafts.ts`, `lib/claim-check.ts`, `lib/claim-rules.ts`, `lib/compose-links.ts`.
- **Purpose:** everything about one company, and the place where an officer claims it, logs outreach, drafts an email, changes its stage, and keeps its details and contacts.

The page has up to ten blocks, in this order. A design may rearrange them, but every block and every control must still be reachable.

### 6.1 Header

- Company name (heading).
- A line: stage label, then industry (if any), then the website (if any) as a link that opens in a new tab with `noopener noreferrer nofollow`. A website that is not a valid web address is left out of this line (it still appears under Details).
- A line: "Last contacted Oct 30" or "Never contacted", then "Follow up Nov 4" when a follow-up is set.
- **Back** (to the queue).

### 6.2 Archived banner (archived companies only)

"This company is archived. It is hidden from the board and queue, and its history is kept." with an **Unarchive** button (opens the page again as active). While archived, the Claim, Draft, Stage and Archive blocks are hidden, details are read-only ("Industry", "Website", "Notes", each "None" when empty), and contacts have no edit, remove or add controls. Outreach and stage history stay visible.

### 6.3 Claim block (heading "Claim")

Exactly one of these, by claim state:

| State | Text | Buttons |
| --- | --- | --- |
| Free | "Not claimed." | **Claim** |
| Expired | "Sam Lee's claim expired Oct 20, 2026, 3:00 PM." | **Claim** |
| Theirs | "Held by Sam Lee until Oct 30, 2026, 3:00 PM." | Owners only: **Force release**, asking "Release Sam Lee's claim on Acme?" |
| Mine | "You hold this until Oct 30, 2026, 3:00 PM." | **Release**, asking "Release your claim on Acme?" |
| Committed or Declined | "This company is Committed, so it can't be claimed." (or Declined) | none |

When the person holds the claim, the **Log outreach** box appears (it is the target of the queue's Log outreach link):

- Heading "Log outreach" and the help line "After you reach out from your own inbox or in person. Saving renews your claim."
- **Channel**: Email (default), LinkedIn, In person, Other.
- **Follow up on**: a required date, earliest today, latest one year out, default seven days from today.
- **Note**: up to 2,000 characters, placeholder "What you sent or talked about".
- **Log outreach** button. On success: "Logged." The outreach appears in the log, the follow-up and last-contacted dates update, the claim is renewed, and a Not contacted company becomes Contacted.
- Errors: "Pick a follow-up date from today to a year from now.", "Pick how you reached out.", and the claim errors listed in the message catalog. Nothing is saved when any error appears.

### 6.4 Draft an email block (heading "Draft an email")

Shown when the company is not archived, not Committed or Declined, and not held by someone else.

- **AI off:** if the server has no AI key or the workspace switch is off, the block is only the sentence "AI drafting is off for this workspace. An owner can turn it on in Settings."
- **AI on:** the draft form, then any saved drafts.

Draft form:

- **Kind** radio: "First email" or "Follow-up". Follow-up is preselected when any outreach is logged.
- **Send to** dropdown: "No contact yet (greets "Hi there")" plus each contact as "Name, Title", with "(no email)" appended for contacts without one.
- **Note for the AI**: optional, up to 300 characters, placeholder "Optional: what to emphasize. No names or emails; this goes to Google's AI."
- Help text: "Drafting claims this company for you. The AI only uses facts verified on the fact sheet (4)." When none exist: "... and there are none yet, so drafts won't say anything specific about your org."
- **Draft two emails** button, reading "Drafting... (up to a minute)" while it works (the prototype waits 1.5 to 3 seconds).
- Errors: the AI gates and failures in the message catalog, and the claim errors (for example "Sam Lee claimed this first. They hold it until Nov 1, 2026, 3:00 PM.").

Each draft is a card titled "Draft 1: Lead with competition results" (the angle):

- "To: elaine@acme.com" or "To: no email on file; add it in the mail app".
- **Subject** field and **Body** field (about 10 rows), both editable.
- The hint "Read it through and fix anything before you send it."
- **Copy subject**, **Copy body** (then "Copied the subject." or "Copied the body."), and three links that open the draft in the officer's own mail: **Open in Outlook**, **Open in Gmail**, **Open in mail app**. The app never sends email. When the body is too long to fit in a link: "This email is too long to fit in a link. Copy the body and paste it in."
- **Claim check box** (live region). Headline "Claim check: 2 things to look at", or "Claim check: nothing unsupported found" (the AI checked and found nothing), or "Claim check: the rules found nothing" (no AI result for this exact text). Findings are listed as "Number: $1,200 No verified fact has this number." with the quoted text marked. Finding kinds: **Number** (a figure no verified fact contains), **Link** ("Links aren't checked. Make sure it goes where you mean."), **History** ("Check this company really has a history with you."), **Not in the facts** (the AI's findings). The number, link and history rules rerun on every keystroke in the subject or body. The AI findings count only while the text is exactly what the AI checked.
  - After an edit: "You've edited this since the AI checked it." (or "The AI hasn't checked this yet." before any check) and a **Check again with AI** button ("Checking...").
  - If the AI check could not run: "The AI check didn't run: The AI is busy right now. Try again in a minute."
- **I sent it: log the outreach** (collapsed): a follow-up date (default seven days out), a note (default "Sent: {subject}"), and a **Log outreach** button. Success: "Logged." The outreach records which draft it came from, shown in the log as "from an AI draft".

Drafts survive a reload: the person's latest pair for the company is shown when the page opens.

### 6.5 Stage block (heading "Stage")

The stage dropdown (all six stages) and **Move**. Same behavior as on the board: Move is disabled until a different stage is chosen; Committed and Declined ask first; a company held by someone else cannot be moved by an officer ("Sam Lee holds this company until Nov 1, 2026, 3:00 PM. Ask them, or an owner.").

**Prototype addition:** moving to Replied, In conversation, Committed or Declined asks which outreach got the reply when no outreach is flagged yet (see section 13).

### 6.6 Details block (heading "Details")

The company form in edit mode, for active companies:

- **Name** (required), **Industry** (free text with suggestions from the workspace's existing industries), **Website** (placeholder "acme.com"), **Notes** (4 rows).
- **Save changes** ("Saving..."). Success: "Saved." Only the fields that changed are saved.
- Errors, in the order of the boxes: "Enter a company name.", "Name can be at most 120 characters.", "Industry can be at most 80 characters.", "Website can be at most 300 characters.", "Enter a website like acme.com or https://acme.com.", "Notes can be at most 5000 characters."
- **Look-alike warning** when the new name or website matches another company: an amber box, "This looks like a company already in the workspace:", each match with its name (link), website, "(same name)", "(same website)" or "(same name and website)", an "archived" badge when it is archived, and a **Same company: archive this one** button (not for archived matches). Below, **Separate entries: save anyway**. Nothing typed is lost.
- **Conflict warning** when someone else changed the same field since the page loaded: "Someone else changed this company while you were editing. Nothing was saved." with, per field, "Name is now "Acme Corp". Your version is still in the box." and a **Use theirs** button, then "Save again to replace theirs with yours."

### 6.7 Contacts block (heading "Contacts")

- "No contacts yet." when empty.
- Each contact: "Name, Title (email)". For active companies, an **Edit or remove** disclosure containing the contact's name, title and email boxes, **Save contact**, and **Remove contact** (asking "Remove Dana Reyes?").
- An **Add contact** form below: name (required), title, email, and the **Add contact** button.
- Errors: "Enter the contact's name.", "Name can be at most 120 characters.", "Enter a valid email address.", "Title can be at most 120 characters." Removing a contact really deletes it.
- A company can have any number of contacts.

### 6.8 Outreach block (heading "Outreach")

"No outreach logged yet." or a list, newest first (latest 100), each entry: date and time in full, then "Sender name, Channel", then ", from an AI draft" when it came from a draft, with the note underneath (line breaks kept).

**Prototype addition:** each entry can show the template it used and a "Got a reply" marker (the data exists in the real database and feeds reply rates).

### 6.9 Stage history block (heading "Stage history")

"No stage moves yet." or a list, newest first (latest 50): "Oct 30, 2026, 10:12 AM: Sam Lee moved it from Not contacted to Contacted". People who have left the workspace appear as "a former member".

### 6.10 Archive block (heading "Archive"; active companies only)

"Hides the company from the board and queue. Its history is kept and you can unarchive it." and an **Archive company** button asking "Archive Acme?". Archiving clears any claim. An officer cannot archive a company someone else holds: "Sam Lee holds this company until Nov 1, 2026, 3:00 PM. Ask them, or an owner."

### Links

- Out: queue (Back), the company's website (external), mail apps (external), another company (duplicate matches), fact sheet is not linked from here.
- In: queue, board, new company (after saving, and the "Same company: open it" link), import result and import duplicate groups, duplicate pairs, "unarchive it instead".

### Prototype wiring

`useCompany(ws, id)` returns the company, `claim`, `contacts`, `outreach`, `stageChanges`, which actions apply (`canClaim`, `canRelease`, `canForceRelease`, `canLogOutreach`, `canDraft`), `ai` availability, `drafts`, `ruleContext` for `checkRules`, the date bounds for the follow-up box, and `headline`. It returns null for a missing company; show the 404. Actions: `claimCompany`, `releaseClaim`, `forceRelease`, `logOutreach`, `moveStage`, `updateCompany`, `archiveCompany`, `unarchiveCompany`, `addContact`, `updateContact`, `removeContact`, `draftEmail`, `checkDraft`. Use `checkRules` and `composeLinks` from `demo/rules.ts` (the real app's own code) for the claim check and the mail links. The seed has drafts already waiting on NVIDIA and Microsoft.

---

## 7. New company

- **Real route:** `/[workspaceId]/companies/new`. **Prototype route:** `/demo/w/[ws]/companies/new`.
- **Source:** `app/(app)/[workspaceId]/companies/new/page.tsx`, `components/company-form.tsx`, `lib/companies.ts`, `lib/duplicates.ts`.
- **Purpose:** add one company by hand, and warn when it looks like one already there.

### Data shown

Heading "Add a company". The form: **Name** (required), **Industry** (suggestions from the workspace), **Website** (placeholder "acme.com"), **Notes** (4 rows). Limits are in section 1.

### Controls

- **Add company** ("Saving..."). On success the new company's page opens.
- **Back** (to the queue).

### States

- **Validation errors**, shown next to the button: "Enter a company name.", "Name can be at most 120 characters.", "Enter a website like acme.com or https://acme.com.", and the length messages in section 6.6. A website with another scheme such as `javascript:` is refused.
- **Duplicate warning.** Before saving, the workspace is searched, archived companies included, for a company with the same name (ignoring case, accents, punctuation, "The" and endings like Inc, LLC, Corp, Co, Ltd) or the same website domain (ignoring `www`, the path and the scheme). If any exist, nothing is saved and an amber box appears: "This looks like a company already in the workspace:". Each match shows its name (a link), website, the reason in parentheses ("same name", "same website", "same name and website") and an "archived" badge when archived. Per match:
  - not archived: **Same company: open it** (a link to the existing company);
  - archived: **Same company: unarchive it instead** (brings it back with its history and opens it).
  - Below the list: **Separate entries: save anyway**, which saves the new company and remembers each pair as separate, so it never flags again.
  - A failure of "unarchive it instead" (for example someone already did) shows its reason inside the box.
- The text in the boxes is kept through every warning.
- Nothing is merged or blocked automatically; a person always decides.

### Links

- Out: the new company's page; an existing company's page; queue.
- In: queue header, board header.

### Prototype wiring

`createCompany(ws, input, separateFrom?)` returns `{ status: "saved", companyId }` or `{ status: "possible-duplicates", matches }`. Pass the match ids as `separateFrom` for "save anyway". `unarchiveCompany(ws, id)` handles "unarchive it instead". `useIndustries(ws)` feeds the suggestions. Try "Lilly" (website lilly.com), "Cummins" or "Rolls-Royce" to see a warning, and "Anthem" for an archived match.

---

## 8. Import

- **Real route:** `/[workspaceId]/import`. **Prototype route:** `/demo/w/[ws]/import`.
- **Source:** `app/(app)/[workspaceId]/import/page.tsx`, `import/actions.ts`, `components/csv-importer.tsx`, `lib/csv.ts`.
- **Purpose:** add many companies at once from a spreadsheet, without silently skipping, merging or losing anything.

### Data shown

- Heading "Import companies" and **Back**.
- Help text: "Upload a .csv file with a header row: up to 2,000 rows and 3 MB. In Google Sheets: File, Download, Comma-separated values. Companies are added as Not contacted, with at most one contact each."
- The flow has four numbered steps shown as the file is processed:
  1. **Choose a .csv file.** A file picker (`.csv`). Choosing a file starts the preview immediately.
  2. **Check the columns.** "N rows found. Guessed from your headers; change any that are wrong." Six dropdowns, one per field: **Company name (required)**, **Industry**, **Website**, **Notes**, **Contact name**, **Contact email**. Each lists the file's headers; every field except the company name also offers "Not in this file". Changing a dropdown re-runs the preview. A column can fill only one field. The guess reads the headers ("Company Name", "Website", "Contact Email" and so on) and falls back to the first column for the name.
  3. **Review.** "The first 10 rows, as they'll be imported:" as a table with columns Row, Name, Industry, Website, Contact, Notes, Problems. Rows with problems are red and the problems are written in the last column. Row numbers match the spreadsheet (the header is row 1).
     - **Problems list**, open by default: "4 rows won't be imported. Fix them in the sheet and upload it again to include them." then one line per row, such as "Row 10: Enter a company name." Contact problems are prefixed: "Row 12: Contact: Enter a valid email address."
     - **Possible duplicates**, when any: "Choose Import or Skip for each row. Importing a look-alike keeps both as separate companies." One amber box per group, headed "Same name", "Same website" or "Same name and website", listing any companies already in the workspace ("Already in the workspace: Cummins Inc. (cummins.com)", a link, with an "archived" badge when relevant) and then each file row in the group as "Row 3: Duke Energy (duke-energy.com)" with an **Import** and a **Skip** radio. Groups are linked transitively: if row 3 matches row 5 by name and row 5 matches an existing company by website, all three are one group. The suggested choices skip any row that matches an existing company, and in a group inside the file import the first row and skip the rest.
  4. **Import.** "11 companies will be added as Not contacted. Nothing is imported until you press the button." and the **Import 11 companies** button, disabled when the count is 0.
- The count of companies to import is the rows found, minus rows with problems, minus rows skipped.

### States

- **No file yet:** only step 1.
- **Working:** "Working..." while the file is read or the preview is recomputed; the Import button is disabled.
- **Error** (red, with a **Review again** button when a preview is showing): the file checks "Choose a .csv file." and "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values." and "The file is over 3 MB. Split it into smaller files."; the parse errors "Row 7 has a quote that never closes. Fix it in the sheet and export again.", "The file needs a header row with column names.", "The file has more than 200 columns.", "The file has no rows under its header.", "The file has 2500 rows; the limit is 2000. Split it into smaller files."; the mapping errors "Each column can only fill one field." and "Choose a column for each field."; and the stale-review errors "The import choices don't match this file. Review it again." and "A company that looks like rows in this file was added since your preview. Review the duplicates again."
- **Done:** a status line "Imported 11 · Skipped 2 · Errors 4" with **Go to the queue** (opens with Never contacted expanded), **See the board**, and **Import another file**.
- The file parser handles a byte-order mark, Windows line endings, quoted commas, quoted line breaks, blank lines, stray spaces around values, repeated and blank headers.
- All or nothing: either every chosen row goes in or none does.

### Links

- Out: queue (with Never contacted open), board, existing companies in duplicate groups, Back to the queue.
- In: queue header.

### Prototype wiring

`useCsvImport(ws)` in `demo/use-csv-import.ts` runs the whole flow (choose a file or load the sample, remap, choose skips, import, reset) and returns everything the screen draws. `SAMPLE_CSV` in `demo/sample-csv.ts` is a deliberately messy sheet: 17 rows, 4 with problems (rows 10, 11, 12, 17), 2 duplicate groups (row 2 matches the existing Cummins Inc., rows 3 and 4 are the same company twice), and 11 companies imported with the suggested choices. Offer a "Use the sample file" control, because reviewers will not have a CSV at hand. The lower-level actions are `checkImportFile`, `previewImport`, `runImport`.

---

## 9. Fact sheet

- **Real route:** `/[workspaceId]/facts`. **Prototype route:** `/demo/w/[ws]/facts`.
- **Source:** `app/(app)/[workspaceId]/facts/page.tsx`, `facts/actions.ts`, `lib/facts.ts`, `lib/ai/pdf.ts`.
- **Purpose:** the list of statements about the org that the AI drafter is allowed to make. An owner uploads the sponsorship packet, the AI lists the facts in it with the sentence and page each came from, and **nothing is used until an owner verifies it**. This is what stops the drafter from inventing prices, dates or awards.

### Data shown

- Heading "Fact sheet" and **Back** (to Settings, not the queue).
- Intro: "The AI drafter may only state facts on this page, and only once an owner has verified them. Upload your sponsorship packet and the AI lists its facts with the sentence and page each came from; check each one against your packet before verifying it."
- **Officers see only the Verified list.** Owners also see the upload block, the waiting list and the add-a-fact form.
- Each **fact** shows:
  - the fact text (one sentence, up to 300 characters);
  - its source: for a PDF fact, "Page 6 of BRC-Sponsorship-Packet-2026-27.pdf" followed by the quote, ": "Gold ($5,000): logo on the rover..."" ("Page unknown of ..." when the page was not found, "a deleted file" if the file is gone); for a hand-typed fact, "Added by hand";
  - the **quote check** for PDF facts: "quote found on that page" with a check mark, or a warning "quote not found on that page, or it doesn't match the fact. Check the PDF." The second happens when the quote is missing from the page or when a number in the fact is not in the quote (for example the fact says $1,000 and the quote says $1,200);
  - when verified: "Verified by Priya Raghunathan on Oct 1" (or "a former member"), and a **Stale: over a year old** badge when it was last verified (or created) more than a year ago.
- **Uploaded files** (owners): "BRC-Sponsorship-Packet-2026-27.pdf: 12 pages, uploaded Sep 14 by Priya Raghunathan".
- Facts are listed unverified first, then by creation order.

### Controls (owners only)

- **Upload the sponsorship packet**: a PDF picker and **Upload and read** ("Working..."). Help text: "A text PDF (not a scan), up to 3.5 MB and 40 pages. Reading it takes up to a minute. Its text goes to Google's free Gemini tier with emails and phone numbers masked, so don't upload anything you wouldn't hand a sponsor." Success: "Done. Check the facts below." The new facts arrive unverified.
- **Delete file** next to each uploaded file, asking "Delete BRC-Sponsorship-Packet-2026-27.pdf and every fact read from it? Facts added by hand stay."
- **Waiting for your check (N)** list. Per fact:
  - **Verify** (becomes **Unverify** on a verified fact);
  - **Delete**, asking "Delete this fact?";
  - **Edit (saving also verifies it)**: a disclosure with one text box (up to 300 characters, label "Fact") and **Save fact**. Editing a PDF fact re-checks its quote, so changing "$2,500" to "$3,000" shows the quote warning.
- **Verified (N)** list: the same per-fact controls for owners; read only for officers.
- **Add a fact by hand**: one text box (placeholder "Our hackathon draws 600 students.", label "New fact") and **Add fact**. Success: "Added and verified." Hand-typed facts are verified at once.

### States

- **AI off or no AI key** (owners): in place of the upload form, "Turn AI on in Settings to read a packet. You can still add facts by hand below." with a link to Settings.
- **Nothing waiting:** "Nothing to check."
- **No verified facts:** "No verified facts yet, so the drafter has nothing to say about your org."
- **Upload errors:** "Choose a PDF file.", "The PDF is over 3.5 MB. Export a smaller copy.", "That PDF has 52 pages; the limit is 40.", "That PDF took too long to read. Try a smaller file.", "This PDF has little or no text to read. Export it as a text PDF (not a scan), or run OCR first.", "That PDF is password-protected. Upload a copy without a password.", "That file couldn't be read as a PDF.", plus the AI errors in the message catalog.
- **Owner-only errors** if forced: "Only the workspace owner can do that."; "Fact not found."; "File not found."
- **Working:** "Working..." on each button; reading a packet is the slow one.

### Links

- Out: Settings (Back, and the "Settings" link in the AI-off message).
- In: Settings ("Manage the fact sheet" for owners, "See the fact sheet" for officers).

### Prototype wiring

`useFactSheet(ws)` returns `sheets`, `unverified`, `verified` (each fact with `verifiedByName`, `stale`, `sourceLabel`, `quoteFound`), `staleCount`, `mismatchCount`, `isOwner`, `ai`, `uploading`. Actions: `setFactVerified`, `updateFact`, `addFact`, `deleteFact`, `deleteFactSheet`, `uploadFactSheet(ws, file)` (waits 2 to 3.5 seconds, then adds four unverified facts, the last with a mismatching quote). The main workspace has verified, unverified and stale facts, and one with a quote mismatch. Use the role switch to see the officer view.

---

## 10. Settings

- **Real route:** `/[workspaceId]/settings`. **Prototype route:** `/demo/w/[ws]/settings`.
- **Source:** `app/(app)/[workspaceId]/settings/page.tsx`, `settings/actions.ts`, `lib/workspaces.ts`, `lib/authz.ts`, `lib/ai/run.ts`.
- **Purpose:** people, invitations, the claim window and the AI switch. Officers can read most of it; owners can change it.

### Data shown

- Heading "{Workspace name}: settings" and **Back** (to the queue).
- **Members**, in the order they joined. Each: name, the email (owners only; officers never receive emails), ": Owner" or ": Officer", and "(you)" on the person themself.
- **Invitations** (owners only): the pending, unexpired invitations as "taylor@purdue.edu: Officer, pending".
- **Claim window:** the number of days.
- **AI:** the explanation "Drafts pitch emails from facts your workspace has verified. AI runs on Google's free Gemini tier, which may use what it's sent to improve Google's products, so names and email addresses are never sent to it."; the usage line "87 AI calls in the last 30 days, out of 300." ("1 AI call" when one); and the switch state.
- The server-level notice when no AI key exists: "AI isn't set up on this server yet: it needs a GEMINI_API_KEY."

### Controls

Members (owners):

- **Make Officer** or **Make Owner** on every member, including themself.
- **Remove** on every member except themself, asking "Remove Sam Lee from Boilermaker Robotics Club?". Removing also releases that person's claims, so their companies do not stay locked.
- A hint under the list: "To hand the workspace to someone else, make them Owner, then make yourself Officer or leave."

Members (everyone):

- **Leave workspace** on the person's own row, asking "Leave Boilermaker Robotics Club?". Their claims are released first. They return to the workspace list.

Invitations (owners):

- A note: "No email is sent. Tell them to sign in with this Google email and click Join."
- **Email** (placeholder "name@purdue.edu"), **Role** dropdown (Officer, the default, or Owner), **Invite**. Success: "Invitation created." Inviting an email that has a pending invitation replaces it.
- **Cancel** beside each pending invitation.

Claim window:

- Owners: a number box (1 to 60, label "Claim window in days"), "days", **Save**. Success: "Saved." Claims already taken keep the expiry they were given.
- Officers: the plain sentence "Claims last 14 days."

AI:

- A link: **Manage the fact sheet** (owners) or **See the fact sheet** (officers).
- Owners: the checkbox **AI on for this workspace**, a **Limit** number (0 to 5,000, "calls per 30 days") and **Save** ("Saved.").
- Officers: "AI is on for this workspace." or "AI is off for this workspace."

### States

- **Last owner:** making the last owner an Officer, or leaving as the last owner, fails with "A workspace must keep at least one owner."
- **Officer view:** no emails, no role or remove buttons, no invitations section, read-only claim window and AI, but Leave workspace stays.
- **AI limit reached** (in drafts, not here): the usage line shows the used count at the limit.
- **Validation:** "Enter a valid email address.", "Use whole days.", "Use 1 to 60 days.", "Use a whole number.", "Use 0 to 5000."
- **Not allowed** if forced: "Only the workspace owner can do that."
- **Working:** "Working..." on each button.

### Links

- Out: fact sheet, queue (Back), workspace list (after leaving).
- In: queue header.

### Prototype wiring

`useSettings(ws)` returns `members` (each with `email` only for owners, `canChangeRole`, `canRemove`, `nextRoleLabel`, `heldCompanies`), `invitations` (with the copyable `link`), `ownerCount`, `claimWindowDays`, `ai` and `iAmLastOwner`. Actions: `inviteMember`, `cancelInvitation`, `copyInviteLink` (**Prototype addition**: invitations carry a link that can be copied), `changeMemberRole`, `removeMember`, `leaveWorkspace`, `transferOwnership` (**Prototype addition**: one step instead of two), `updateClaimWindow`, `updateAiSettings`. The workspace "Tartan Build Weekend" has AI switched off; "Boilermaker Robotics Club" has an owner and five officers and the signed-in person is an officer.

---

## 11. Navigation map

| From | Can go to |
| --- | --- |
| Sign-in | Workspace list |
| Workspace list | Queue of any workspace; sign-in (sign out) |
| Queue | Company page, Log outreach on the company page, Board, New company, Import, Settings, Workspace list, sign-in (sign out) |
| Board | Company page, New company, Queue |
| Company page | Queue (Back), external website, external mail apps, another company page |
| New company | Company page (new or existing), Queue |
| Import | Queue (open on Never contacted), Board, existing company pages, Queue (Back) |
| Fact sheet | Settings |
| Settings | Fact sheet, Queue, Workspace list (after leaving) |

Gaps in the real navigation that a design may close: the fact sheet is only reachable from Settings; the board and the company page have no link to Import or Settings; there is no global search; there is no workspace switcher outside the queue's "Switch workspace" button; there is no header that is the same on every screen.

---

## 12. Message catalog

These are the real messages. Placeholders like {holder} stand for real names and dates. The prototype engine returns these exact strings, so a design can display `result.error` as is.

### Claims and outreach

| When | Message |
| --- | --- |
| Company missing or archived | "Company not found." |
| Claim on Committed or Declined | "This company is Committed, so it can't be claimed." |
| Claim lost to someone else | "{holder} claimed this first. They hold it until {full date}." |
| Release when it is not yours | "You don't hold this company." |
| Force release by an officer | "Only an owner can force-release a claim." |
| Force release when nobody holds it | "Nobody holds this company." |
| Move or archive on a company someone else holds | "{holder} holds this company until {full date}. Ask them, or an owner." |
| Log outreach on Committed or Declined | "This company is Committed. Nothing was saved." |
| Log outreach while someone else holds it | "{holder} holds this company now, until {full date}. Nothing was saved." |
| Log outreach after your own claim ran out | "Your claim on this company has expired. Claim it again, then log your outreach. Nothing was saved." |
| Log outreach with no claim | "Claim this company before logging outreach. Nothing was saved." |
| Follow-up out of range | "Pick a follow-up date from today to a year from now." |
| Follow-up not a date | "Pick a follow-up date." |
| Channel missing | "Pick how you reached out." |
| Note too long | "Note can be at most 2000 characters." |
| Draft not yours or not found | "That draft wasn't found. Nothing was saved." |
| Stage missing | "Pick a stage." |

### Companies and contacts

| When | Message |
| --- | --- |
| Name empty | "Enter a company name." |
| Name, industry, website, notes too long | "Name can be at most 120 characters." (likewise Industry 80, Website 300, Notes 5000) |
| Website invalid | "Enter a website like acme.com or https://acme.com." |
| Same two companies | "Pick two different companies." |
| Contact name empty | "Enter the contact's name." |
| Contact email invalid | "Enter a valid email address." |
| Contact missing | "Contact not found." |
| Stale form on edit | "Reload the page and try again." |

### AI

| When | Message |
| --- | --- |
| No key on the server | "AI isn't set up on this server yet." |
| Workspace switch off | "AI is turned off for this workspace. An owner can turn it on in Settings." |
| Workspace limit reached | "This workspace has used its 300 AI calls for the last 30 days. An owner can raise the limit in Settings." |
| Personal daily limit | "You've made 40 drafts in the last 24 hours. Try again tomorrow." |
| Busy | "The AI is busy right now. Try again in a minute." |
| Slow | "The AI took too long to answer. Try again." |
| Declined | "The AI declined to answer that. Try rewording your note." |
| Cut off | "The AI's answer was cut off. Try again." |
| Unusable reply | "The AI sent back something unusable. Try again." |
| Down | "The AI service isn't responding. Try again in a few minutes." |
| Key rejected | "The AI service rejected this server's key. Tell the app admin." |
| Request refused | "The AI service refused this request. Tell the app admin." |
| Drafts broke the rules | "The AI's drafts broke the drafting rules. Try again." |
| Contact missing | "Contact not found." |
| Nothing to check | "Write the email first." |
| Too long to check | "The subject is too long to check." and "The email is too long to check." |
| Draft missing | "Draft not found." |

### Confirmations

| Action | Text |
| --- | --- |
| Move to Committed or Declined | "Move to Committed? This closes the pitch and releases any claim." |
| Release | "Release your claim on {company}?" |
| Force release | "Release {holder}'s claim on {company}?" |
| Archive | "Archive {company}?" |
| Archive a duplicate | "Archive {archived} and keep {kept}? You can unarchive it later." |
| Remove a contact | "Remove {contact}?" |
| Delete a fact | "Delete this fact?" |
| Delete an uploaded file | "Delete {file} and every fact read from it? Facts added by hand stay." |
| Remove a member | "Remove {member} from {workspace}?" |
| Leave | "Leave {workspace}?" |

### Workspaces and settings

| When | Message |
| --- | --- |
| Not a member | "You are not a member of this workspace." |
| Owner-only action | "Only the workspace owner can do that." |
| Last owner | "A workspace must keep at least one owner." |
| Workspace name | "Name must be at least 2 characters." |
| Not allowed to create | "You are not allowed to create a new workspace" |
| Invitation missing | "Invitation not found." |
| Already a member | "User is already a member of this workspace" |
| Member missing | "Member not found." |
| Claim window | "Use whole days." and "Use 1 to 60 days." |
| AI limit | "Use a whole number." and "Use 0 to 5000." |
| Fact | "Write the fact.", "A fact can be at most 300 characters.", "Fact not found." |
| Fact file | "File not found." |

---

## 13. Prototype additions and demo tools

These do not exist in the real app. They exist so a reviewer can reach every state in a prototype without a database.

- **Role switch.** `setRole("owner" | "member", ws?)` switches the signed-in person between Owner and Officer in one workspace or in all of them. The seed keeps a second owner wherever the person could switch out of Owner, so no workspace is left without one. Every prototype should include a small, unobtrusive "View as" control.
- **Reset.** `resetDemo()` restores all mock data (it keeps the person signed in unless `{ signOut: true }`). State also resets on a full page reload.
- **Clock.** `advanceClock(days)` moves the demo clock forward so claims expire and follow-ups come due. The seed has a claim that runs out tomorrow (Cummins, held by Aaliyah Brooks, 3:00 PM) and one that already expired (Allison Transmission, Wei Chen).
- **Flags.** `setFlags({ serverAiConfigured, canCreateWorkspace, aiFailNext })` reaches the AI-not-set-up notice, the no-workspace state and the "AI is busy" error. `aiFailNext` fails the next AI call once.
- **Teammate edit.** `simulateTeammateEdit(ws, companyId, field, value)` changes a company as a teammate would, so the edit conflict can be shown.
- **Reply question.** Moving a company to Replied, In conversation, Committed or Declined asks "Which outreach got the reply?" with the company's outreach as options, plus "None of these" (the reply was a phone call, for example). The answer is stored on the outreach and feeds reply rates per template. `useReplyChoice(ws, companyId, stage)` says whether to ask. Pass the choice as `moveStage(ws, id, stage, { replyOutreachId })`.
- **Template on outreach.** `logOutreach` accepts a `templateId`, so stats per template can exist.
- **Invitation link.** Invitations carry a link and `copyInviteLink` puts it on the clipboard.
- **Transfer ownership.** `transferOwnership` makes someone Owner and the person an Officer in one step.
- **Simulated AI.** Drafts, claim checks and packet reading wait 1.5 to 3 seconds, 1 to 2 seconds and 2 to 3.5 seconds, then return canned content built only from the workspace's verified facts. The second draft always includes one unsupported sentence so the Claim Checker has something to flag, and a follow-up also quotes a figure no fact contains, which the rules flag as a Number.

---

## 14. Future screens to leave room for

None of these exist yet, and prototypes must not build them as functional screens. Each design should still make sure the shell can take them later: a spot in the main navigation or a command menu for a new destination, a panel region that can open beside any screen, and company and queue layouts that do not assume a fixed number of columns or tabs. Where a design wants to hint at one (a disabled nav item, a teaser card), keep it visibly labelled "Coming soon".

### Template stats with reply rates

- **What it answers:** which message works. "Cold intro with packet: sent 14 times, 5 replies, 36 percent."
- **Data that already exists:** every outreach has an optional template and a "got a reply" flag; templates have a name, a body and an archived date (used templates are archived, never deleted, so history stays). Outreach from AI drafts is recorded as such, so drafted and hand-written emails can be compared. `useTemplateStats(ws)` returns, per template, `sent`, `replies`, `replyRate`, `companies` and `lastUsedAt`, plus rows for hand-written and AI-drafted outreach.
- **Shape to expect:** a table or cards per template with the rate, the counts behind it, and a drill-down to the companies. Small samples are common (a few sends per template), so always show the counts beside the rate and never rank on a rate alone.
- **Needs from the shell:** a workspace-level destination (for example under the board or a new "Insights" group), and in the company page's outreach log a place for the template name and the reply marker.
- **Not in scope:** editing templates, A/B tests, scheduling.

### Pipeline Copilot chat panel

- **What it answers:** questions and small tasks about the pipeline in plain language. "Who is most overdue that nobody holds?" "What did we send Cummins?" "Draft a follow-up for everyone in Replied."
- **Placement:** a panel that slides in beside any workspace screen and stays open while the person navigates. On the company page it carries that company as context. A keyboard shortcut and a visible button open it.
- **Data it may read:** the same views the screens use (queue, board, company detail, outreach, stage history, verified facts). It may propose actions (claim, log outreach, move stage, open a draft), and each proposal is a button the person presses; nothing changes on its own.
- **Rules it must keep:** the app's existing AI rules apply. The AI only states verified facts about the org. No person's name or contact details are sent to the model. The app never sends email. Every call goes through the workspace's AI switch, monthly limit and per-person limit, so the panel needs the same off, not-configured, limit-reached and busy states the draft box has, with the same messages.
- **States to design for:** empty (suggested questions), thinking (a wait of several seconds, not streaming), answer with links to companies, an answer with proposed actions, an error, AI off, and a limit reached with who can raise it (owners, in Settings).
- **Not in scope:** voice, file uploads, acting for other officers.

### Turnover Time Capsule

- **What it is:** an end-of-term report in the style of a year-in-review, made so a departing chair can hand the pipeline to the next one. It tells the story of the term and says what to do next.
- **What it shows:** totals (companies reached, outreach sent, replies, commitments), the funnel by stage, the timeline of the term (stage moves and outreach by week), the officers who carried the work (by outreach logged, with former members shown as "a former member"), the longest conversations, the fastest replies, the companies that committed, and a hand-off list: open conversations with who holds them, their last contact and their next follow-up. The last part is the useful one, so it must not be buried under the celebration.
- **Data that already exists:** every outreach with sender and channel, every stage change with who made it and when, claims, facts with who verified them, and the members' join dates. `useActivity(ws, limit)` and `useWorkspaceStats(ws)` give a head start.
- **Shape to expect:** a sequence of full-width cards or slides that a person steps through, finishing on the hand-off list, plus a way to print or save it. Reading takes a couple of minutes.
- **Rules it must keep:** it lives inside the workspace and is for its members. There are no public pages in this product, so no public share link. It contains member names and company contacts, so it is not sent to the AI. If a written summary is ever generated by AI, it gets the same inputs the other AI features get: counts and verified facts, never names or contact details.
- **Needs from the shell:** an owner-level entry point (for example in Settings or the workspace menu) and a presentation mode that hides the usual navigation.
