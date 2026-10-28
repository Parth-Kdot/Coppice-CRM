# Direction 9: Coppice (Ledger, revised)

Branch `design/coppice`, worktree `/home/user/wt/coppice`, started from `design/ledger` (head 9730f4a). Visual code stays under `app/demo/_ledger/` (keep the folder name; renaming churns every import for no gain). This brief was approved by the owner. It changes layout, components and motion. It does not change the theme.

## 1. The theme is locked
Everything in `docs/design/themes/ledger.md` about palette, type, icons, logo and voice stays exactly as built: paper #F6F1E6, paper-2 #EFE7D6, rule #D9CDB4, ink #1F1B14, ink-2 #5A5142, moss #2F5233, moss-2 #456B47, rust #A3380A, gilt #9C7A2B; Newsreader display (no soft or wonky axes), Instrument Sans UI with tabular numbers, small caps column headers; 1.5 px calligraphic icons; the engraved coppice stool logo; ruled tables, the board-year margin column and the double rule at board turnover; feedback written as margin notes. Light theme only, no dark variant. Do not introduce new colors. New icons must be drawn in the same calligraphic style in `icons.tsx`.

Two usage rules change:
- **Gilt** is used only for the claim ribbon (and the stool engraving). Remove it from spine ornaments and anywhere it competes with labels.
- **Overdue levels** (rust stays for overdue and errors only, always with text):

| Level | Condition | Treatment |
| --- | --- | --- |
| Upcoming | due in the future | ink-2 text "Due in 4 days" or "Due Nov 2", empty hourglass |
| Due today | 0 days | ink text "Due today", hourglass half |
| Late | 1 to 2 days overdue | ink text "2 days overdue", hourglass half, no rust |
| Overdue | 3 to 6 days overdue | rust text "4 days overdue", rust hourglass |
| Long overdue | 7 or more days | the extreme version: rust semibold text "12 days overdue", a solid 3 px rust rule down the row's left edge (in the margin column), the hourglass drawn emptied, and on the company page a small caps rust margin note "Long overdue". Never a filled red background. |

Put the thresholds in one helper (for example `overdueLevel(days)` in `screens/shared.tsx`) and use it everywhere: queue, board slips, company page, palette results, focus mode, landing mini app.

The seeded data makes almost every row overdue, which defeats the levels. You may change follow-up offsets in `demo/seed-main.ts` (only the day offsets, nothing structural) so the main workspace's due list reads roughly: 3 or 4 upcoming or due this week, 2 due today or late, 4 or 5 overdue, 3 long overdue. Keep every SCREENS.md state reachable. Say so in your report.

## 2. App shell
- **Spine** stays 76 px with thumb-index tabs, fixed to the full viewport height (it must never stop mid-page). Tab labels are horizontal 12 px small caps under each icon, legible at a glance. Remove the vertical club name from the spine. Tabs: Queue, Board, Companies, Import, Facts, Settings. Logo at the top, user menu at the bottom.
- **Companies** becomes a real screen at `/demo/w/[ws]/companies` (new route file `app/demo/w/[ws]/companies/page.tsx`): the whole workspace as a ruled ledger table (company, stage glyph and label, holder chip, next follow-up with its overdue level, last outreach date), with a search field, a stage filter and a sort control. Board-year margin and turnover rule apply. A "New company" button links to companies/new. Add the route helper to `demo/routes.ts`.
- **Page header** keeps the book title ("Boilermaker Robotics Club, Volume 2026-27") over the double rule. On its right sits an always-visible search bar (from Graphite's top bar): a field reading "Search companies, people or actions" with `/` and `⌘K` keycaps. Clicking it or pressing `/` or `⌘K` (Ctrl K on other systems) opens the command palette.
- **Command palette** (adapted from Graphite `palette.tsx` and Blueprint's search in `dock.tsx`), drawn as an index card on paper with ruled lines: results grouped under small caps headers Companies, People, Actions. Each company or person result shows a "matched on" hint (for example "matched on contact: dana@kestrel.com", or "matched on note"). Actions include Claim <company>, Log outreach on <company>, Move <company> to <stage>, Go to Queue, Board, Companies, Import, Facts, Settings, Switch to Owner view or Officer view, Reset demo. Arrow keys, enter, escape; focus is trapped and restored; it has role="dialog" with a labeled listbox. Opening: opacity and scale .98 to 1 in 140 ms.
- **Footer status line** (Graphite's status bar, ledger style): a 28 px line under the content in small caps tabular figures, "42 companies · 7 overdue · claim window 14 days · Owner view", values live from the store.
- **Demo controls**: the PROTOTYPE badge leaves the header and every screen. Reset demo, the role switcher and any reviewer tools ("a teammate claims first" and similar) live in a "Demo" section of the user menu. The word "prototype" appears only there.
- **Toasts become anchored margin notes**: one system for all feedback, positioned at the bottom left of the content column (never over the table rows, max width 360 px, text wraps inside its box, nothing overflows), or inside a row's own margin for row-level refusals. aria-live polite. Hold 3 s, then fade.
- **Phone (390 px)**: bottom tab bar with labels (Blueprint's pattern): Queue, Board, Search, Companies, More. Search opens the palette full screen. More opens a sheet with Import, Facts, Settings and the user menu.

## 3. Queue (the workspace home)
- **Totals line** under the header (Ring Count's summary tiles, compressed into one ruled ledger line): "Overdue 7  Due this week 5  Held by you 3  Never contacted 12". Each total is a toggle button that filters the table (aria-pressed), and counts update live.
- **Toolbar**: view tabs All due, Mine, This week, Never contacted; a sort control (Most overdue, Due date, Company, Stage) built as a ledger-style menu, not a native select; the existing only-mine behavior folds into Mine; a "One at a time" toggle for focus mode.
- **Rows** keep Ledger's anatomy on one 44 px line: board-year margin, overdue level marker and text, company name, stage glyph with label, last note in italic truncated with ellipsis, claim column, chevron disclosure. Nothing wraps on desktop.
- **Claim column** uses Blueprint's three states that do not rely on color, drawn in ink:
  - free: an outlined "Claim" button;
  - yours: a solid ink chip with paper text, "Yours until Nov 11";
  - held by someone else: a dashed border chip, "Priya R. until Oct 31" (first name and last initial; full name in the tooltip and the side panel).
- **Side panel** (Graphite's list plus inspector): selecting a row (click, or enter) opens a facing page about 420 px wide on the right at 1280 px and wider: company summary, contact, stage, the last three log entries, Claim or Release, Log outreach (opens the fast log form inline), and an "Open full spread" link to the company page. Below 1280 px it is an overlay sheet from the right; on phones a bottom sheet. Escape closes it and returns focus to the row.
- **Keyboard**: keep j, k, c, l, enter; add `/` and `⌘K`. Graphite's glide: one moss margin bar that slides between rows as the selection moves (transform, 90 ms).
- **Claim motion**: Ledger's gilt ribbon drop (220 ms) stays, and Graphite's FLIP width morph turns the outlined button into the chip (about 180 ms). **Refusal**: Ledger's shake (120 ms) and a rust margin note inside the row's margin naming holder and expiry. **Logging**: moss pen-stroke check, strike-through, then the row exits with FLIP and the rest close the gap.
- **Focus mode** ("One at a time", Dusk's idea from `/home/user/wt/dusk/app/demo/_dusk/screens/queue/FocusMode.tsx`, redrawn as paper): a centered ledger card (max 680 px) for the most overdue company showing its name in Newsreader, the overdue text, the last note quoted, contact, holder and stage, with actions Claim, Log outreach, Open company, Skip for now. Up to three paper slips peek out beneath it (offset 8 px each, slightly dimmer). When the officer finishes a card (claim plus log, or skip) it slides out left (x -24 px, opacity 0, rotate -1.5 degrees, 220 ms) and the next rises (scale .97 to 1, 240 ms). Ends with the empty-state sprout and "All caught up". The toggle state can be remembered in localStorage wrapped in try/catch.
- Never-contacted section and empty states stay.

## 4. Board
The board must fit the viewport: the page itself does not grow to thousands of pixels.
- Six ruled columns. The header row borrows Transit's station strip (`/home/user/wt/transit/app/demo/_transit/stations.tsx`): each stage name in small caps with its count and the stage glyph; clicking a header filters the board to that stage (click again to clear).
- Each column scrolls on its own (max height is the viewport minus header and footer). Slips are compact, about 64 px: name, holder initials, overdue level marker, at most two lines.
- Committed and Declined share one split column at a readable width (stacked halves, each with its own header and count), so neither is a sliver.
- **Moving**: drag and drop with pointer events (the slip lifts with a slightly larger shadow and 1 degree tilt; the target column shows a ruled drop line), plus a small stage glyph button on each slip that opens a one-click "Move to" menu, plus the `m` key on a focused slip. Remove every select plus Move pair. A move to Replied or later still triggers the "which outreach got the reply" prompt from SCREENS.md.
- A search filter field on the board, wired to the same query as the header search.
- At 390 px the board is an intentionally horizontally scrollable strip of columns with scroll snap.

## 5. Company page
Keep the two-page spread.
- **Left page**: name, website, stage, contacts, relevant facts, and under the title a slim Transit-style route map (see `/home/user/wt/transit/app/demo/_transit/company.tsx`): a ruled line through the six stages with a dot per stage, the passed ones filled in ink, the current one ringed in moss, declined drawn as a branch.
- **Right page**: the claim ticket at the top (claim, release, force release for owners, refusal note), the fast log form directly under it, then the outreach history as ledger entries, then the AI draft panel with unsupported claims underlined in rust.
- **Fast log form**: no native date or select controls. Channel is a chip group (Email, Call, In person, LinkedIn, Other); date is chips Today, Yesterday, Pick, where Pick opens a small ruled calendar popover that is keyboard operable (arrow keys, enter, escape, labeled day buttons); follow-up is chips 3, 7 and 14 days plus Pick, with 7 preselected (SCREENS.md 7-day default). Chips are real radio buttons with visible focus. Logging is about three clicks plus a note. Reuse this one form in the queue side panel and focus mode.
- New company form: same chip approach where it has selects; keep duplicate warnings.

## 6. Import, Facts, Settings, Sign-in, Workspaces
Small changes only. Import steps shown as ruled ledger entries; duplicate groups side by side under "Same company?" with Skip or Import (Dusk's framing). Settings: the claim window becomes a stepper (minus, number of days, plus) in place of any select. Remove leftover native selects where a chip group or ledger menu fits. Everything must still satisfy SCREENS.md.

## 7. Landing page
Keep **Lenis smooth scroll** (the owner likes it): keep `landing/smooth.tsx`, keep it synced with GSAP ScrollTrigger, make sure it is disabled under prefers-reduced-motion, leaves touch devices on native scrolling, and that in-page anchor links and keyboard scrolling (space, page down, arrows) still work. Body text is at least 16 px in ink or ink-2; no small grey italic body copy. Target length about 8 to 9 screen heights at 1440x900. Sections, in order:
1. **Hero**: left column, the stool self-draws and "New board, same roots." does Ledger's ink bleed once; subhead, "Start a workspace" and "Sign in" (both to `/demo/signin`). Right column: a **live mini Ledger queue** built from real markup in the theme (adapt Graphite's `landing/mini-app.tsx`, `hero-script.ts`, `mini-data.ts` at `/home/user/wt/graphite/app/demo/_graphite/landing/`). A scripted cursor (GSAP timeline, about 9 s) moves to the search bar, the palette opens, it types "lilly", presses enter, presses c, the gilt ribbon drops and the chip reads "Yours until Nov 11", the rows re-sort with FLIP, and keycaps under the window (/, ⌘K, C, L, J, K) light in step. It plays **once** after the headline settles, then rests on the final state with a "Replay" button. It pauses when off-screen. With reduced motion it shows the final state statically. The mini app is aria-hidden with a text alternative.
2. **Problem**: Ledger's rust strike-through spreadsheet with the fixes in the margin (keep `problem.tsx`, raise its text size).
3. **How it works**: Four Seasons pinned scene, shortened from 300vh to about 150vh. Seasons map to Import, Claim, Log and follow up, Turnover. The final beat settles into a framed render of the real queue page (Blueprint's "ends on the product" idea from `/home/user/wt/blueprint/app/demo/_blueprint/landing/assembly.tsx`). Fold the separate how-it-works entries into this section's captions; remove `how.tsx` from the page if it becomes redundant.
4. **Maya and Dev**: Graphite's two-window race (`/home/user/wt/graphite/app/demo/_graphite/landing/live-example.tsx`) drawn as two facing ledger pages. Two cursors head for the same row; Maya's click lands first and her ribbon drops; Dev's page shakes and shows the rust margin note "Held by Maya until Nov 11". Plays once when scrolled into view, with Replay.
5. **Features index**: Ledger's book index with page numbers, cut to 6 entries.
6. **Who it's for and the name**: four org types as ledger entries, then the coppicing story as plain text beside the stool engraving. Remove the word-by-word blur scrub.
7. **Trust**: "Coming next" and "What Coppice will never do", unchanged in substance.
8. **Get started, FAQ, closing**: four steps, five FAQ questions as accordions, final call to action where the stool's shoots draw once, then "Coppice. Capisce?". No endless sway or looping decoration anywhere on the landing.

## 8. Motion rules
In-app: interaction feedback 100 to 250 ms, panels 150 to 350 ms, no loops on work screens, nothing blocks input. Everything respects reduced motion. CSP: no `style={{}}`, no `motion/react` components, no injected style or script tags; GSAP, WAAPI, CSS keyframes, vanilla `motion`, Lenis and CSSOM `el.style.setProperty` in effects are fine. Fix the comment in `landing/motion.ts` that claims only transform and opacity are animated (pen strokes animate stroke-dashoffset).

## 9. Cut
Confetti, click sparks, aurora, mouse parallax, endless sway loops, typed cycling headlines, scroll-hint loops, select plus Move on cards, the vertical club name, visible demo chips and the PROTOTYPE tag, metaphor names for screens.
