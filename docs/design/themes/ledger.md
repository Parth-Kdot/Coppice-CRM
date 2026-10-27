# Direction 1: Ledger

Branch `design/ledger`, worktree `/home/user/wt/ledger`, dev and start port **3101**, visual code under `app/demo/_ledger/`.

## Idea
Coppice as the team's book of record. A bound account ledger, warm paper, moss ink, ruled lines, a thumb-indexed spine. The coppice story lives inside the data: every table carries a narrow board-year margin ("25-26" in small caps) and a double rule where one board's entries end and the next board's begin, so "new board, same roots" shows up in an ordinary screen-share. Calm, warm, trustworthy, a little literary. It must still read as fast software, so serif type stays in headings and the work surfaces use a clean sans.

## Palette (CSS variables in `app/globals.css`)
| Token | Hex | Use |
| --- | --- | --- |
| paper | #F6F1E6 | page background |
| paper-2 | #EFE7D6 | panels, alternate rows, spine |
| rule | #D9CDB4 | ruled lines, borders |
| ink | #1F1B14 | body text (15.2:1 on paper) |
| ink-2 | #5A5142 | secondary text (6.9:1) |
| moss | #2F5233 | primary actions, links, active tab (7.9:1; paper text on moss 7.9:1) |
| moss-2 | #456B47 | hover, focus rings |
| rust | #A3380A | overdue and errors only (6.0:1 on paper, 5.5:1 on paper-2), always with text like "3 days overdue" and a glyph |
| gilt | #9C7A2B | decorative only: tab edges, the ribbon bookmark, rules on the landing. Never for body text (3.6:1) |
Stages: ink-on-paper labels with a small engraved-style glyph each, no color coding beyond moss for Committed and rust-free gray for Declined.

## Type
Display: **Newsreader** (next/font/google, variable, use optical size and weights 500 to 700; set no soft or wonky axes). Use for page titles, the workspace "volume" title, landing headlines, large numbers.
UI and data: **Instrument Sans** (400, 500, 600) with `font-variant-numeric: tabular-nums` in tables. Small caps (via `font-variant-caps: all-small-caps`) for the board-year margin and column headers.

## Layout and navigation
A left **spine** (about 76 px) styled as the bound edge of a ledger with **thumb-index tabs** stacked down it: Queue, Board, Companies (opens the board's search), Import, Facts, Settings. Each tab is a small paper tab with a letter or icon that sticks out of the spine edge; the active tab slides 6 px further out and turns moss. At the top of the spine sits the logo; at the bottom, the user menu (with the Owner/Officer role switcher, Reset demo, and the discreet "Prototype" label).
The content area is a **page**: a header line with the workspace as a book title ("Purdue Robotics Club, Volume 2026-27") in Newsreader, the page name in small caps, and a thin double rule beneath. Tables are ruled (1 px rule lines, 40 px rows for the queue, 36 px elsewhere) with the board-year margin column on the far left. Where history crosses a turnover, draw the double rule with a tiny small-caps label "Board of 2025-26 ends".
Company page: two-page spread feel. Left page: company name in Newsreader, stage, claim panel, contacts. Right page: the outreach log as dated ledger entries, each with a board-year margin. Draft panel below as "Draft letter".
Board: six columns as ruled ledger columns with Newsreader column titles and counts; cards are paper slips with a thin rule border.
Phone: the spine becomes a bottom tab strip of the same thumb-index tabs.
Keyboard: j/k move the row highlight in the queue, c claim, l log, enter opens the company. Show the shortcuts in a small "Key" footnote at the foot of the queue page.

## Icons
Your own set, drawn as inline SVG components: 1.5 px strokes with round caps, slightly calligraphic (vary stroke width where two lines meet by drawing a second, thinner path), 20 px grid. No hatching under 32 px. At 48 px and up (landing, empty states) use an engraved variant with fine parallel hatching. Needed at least: queue, board, companies, import, facts, settings, claim (bookmark), release, log (quill), calendar, overdue (small hourglass), duplicate (two overlapping slips), check, copy link, AI draft (quill with a small spark), search, user, warning.

## Logo
The **coppice stool**: a low, wide cut stump seen slightly from above (two or three growth rings visible on the cut face) with three slender shoots rising from its rim, each with one or two leaves. Moss ink, engraved line style. Wordmark "Coppice" in Newsreader 600, slightly tracked. Draw it as an SVG component; provide a small version (stump plus shoots only) for the spine.

## Landing page (`/`): signature move is **stems growing back from the stump across a board's seasons**
Inspirations you are adapting (all were viewed by the design lead as frame sequences): LF-14 "Growing plant" (stem rises, leaves unfurl alternating left and right, settles in about 1.2 s), LF-16 "Sapling lifecycle" (a line-art sapling grows, branches split, buds form, then it browns and withdraws into the soil), 60F-18 Antimetal hero (headline blurs into focus after the visual settles), 60F-01 Clear (an item is struck through, flashes, and sinks out of the list), 60F-11 Remy checklist (check marks land one row at a time).
1. **Hero** (on load, about 2.2 s total, then still): paper background with faint ruled lines. The engraved stool draws itself: the stump outline strokes in over 500 ms (SVG `stroke-dashoffset`), then three shoots grow upward with staggered starts (120 ms apart, 900 ms each, ease-out `cubic-bezier(.2,.7,.2,1)`), leaves unfurl alternating left and right as each shoot passes them (scale from the leaf base 0 to 1 over 300 ms with a slight overshoot). The headline "New board, same roots." then **ink-bleeds** in word by word: each word goes from `filter: blur(6px)` and opacity 0 to sharp over 500 ms, 70 ms stagger. Subhead and the two CTAs fade up 8 px after. A small gilt ribbon bookmark hangs from the top edge of the page and sways once.
2. **The problem** ("Five ways a shared spreadsheet lets your team down"): render a mock spreadsheet page. As each of the five problems scrolls into view, the matching row is **struck through in rust ink** (a line drawn left to right over 350 ms), a handwritten-feeling margin note appears beside it (fade and 4 px slide), and the Coppice fix appears on the facing page in moss. Use ScrollTrigger with `scrub: false` triggers, one per row.
3. **Four seasons of a board** (the centerpiece; pinned section about 300 vh tall, GSAP ScrollTrigger with `scrub: 0.6`): the stool sits center stage while the season changes around it (background tint shifts subtly: autumn paper with ochre, winter cooler paper, spring fresher green tint, summer warm). Autumn: a new board takes over, and the shoots grow (Import last year's sheet). Winter: the stems are cut back to the stump with a clean cut line, and the leaves fall as small slips that each become a ledger row stacking on the right page (history kept). Spring: five new shoots regrow from the same roots, more than before (Claim before you contact; the queue brings follow-ups back). Summer: full growth with labels hanging from stems as company names (Committed sponsors). Each season has a caption block on the left page that cross-fades. This is the LF-16 lifecycle turned into coppicing: grow, cut, regrow more stems.
4. **How it works**: a ledger page where the five steps write themselves as entries: ruling lines draw first (200 ms each), then each entry fades in left to right with a 90 ms stagger, and a moss check mark lands in the margin of each entry one after another (60F-11 rhythm, 400 ms apart).
5. **Features**: eight entries in a two-column "index" with engraved 48 px icons; on hover each icon's hatching slides 2 px (subtle).
6. **Live example, Maya and Dev**: two ledger columns side by side headed with each officer's name. Beats appear as the user scrolls. When Maya claims Kestrel Aerospace, a **gilt ribbon bookmark drops** into her column's row (translateY from -100% to 0 over 260 ms with a small overshoot). Dev's row in the same moment gets a rust margin note "Held by Maya until Nov 11" that writes in. Later the follow-up row returns to the top of the queue with a soft slide.
7. **Who it's for, the name story, trust and boundaries**: the name story uses the large engraved stool with a short explainer and the pronunciation "KOP-iss"; trust items are set as a ruled list with small-caps headers.
8. **Get started and FAQ**: four numbered entries; FAQ items open like folded pages (height animates 220 ms, the rule under the question draws across).
9. **Final CTA**: the stool now carries many stems and sways a few degrees in a slow loop (landing only, stops when off-screen, disabled with reduced motion). "Coppice. Capisce?" as the sign-off line in Newsreader italic.
Smooth scrolling with lenis on the landing only.

## In-app motion (all short, none blocking)
Claim success: a **gilt ribbon bookmark drops** onto the row or card from its top edge (translateY -100% to 0, 220 ms, `cubic-bezier(.3,1.4,.5,1)`), and the holder text updates. Claim refused: the claim button does one 4 px horizontal shake (180 ms) and a rust margin note appears beside the row with the holder and expiry. Log outreach on a queue row: a moss check draws, the company name gets a thin strikethrough drawn left to right (200 ms), then after 400 ms the row slides down out of the due list while the rows below close the gap (FLIP, 240 ms), adapted from 60F-01. Updated rows anywhere: an **ink settle**, background paper-2 fading to transparent over 600 ms while text goes from 60% to 100% opacity in 200 ms. Toasts are **margin notes**: they slide in 12 px from the right edge of the page with a short underline drawing under the text, hold 3 s, then fade. Spine tab change: the active tab slides out 6 px (150 ms). Page change: content fades and rises 6 px (160 ms). Empty states: a small sprout grows once (LF-14 rhythm, 1.2 s, only on first view). AI draft loading: a quill line writes a wavy rule across the draft area on a loop until the draft arrives (this is the only loop allowed in-app, and only while waiting). Numbers: crossfade with tabular figures.

## Screen notes
Queue: the page title "Follow-ups due" with the count in Newsreader; the only-mine filter as a small-caps toggle; the never-contacted list collapsed under a rule titled "Never contacted". Workspace list: each workspace is a bound volume spine on a shelf (vertical spines with titles), click to open. Sign-in: a single page of the ledger with the stool, "Sign in with Google" as a moss button. Import: steps as ledger pages (Upload, Map columns, Review duplicates, Done); duplicate groups shown as slips paper-clipped together. Facts: each fact as an entry with page number and quote in Newsreader italic; verify toggles a moss tick in the margin. Settings: members as a register (name, role, joined), invite link in a ruled box with copy button.

## Don'ts
No soft/wonky Fraunces-style display, no cream-on-cream low contrast, no hatching at small sizes, no looping decoration in the app, no rust except overdue and errors.

## Additional references (component libraries, viewed)
Name story paragraph: tie a word-by-word **scroll reveal** to scroll position (RB-22): each word goes from 2 px blur and 30% opacity to sharp ink in reading order as the paragraph scrolls through the middle of the viewport, reversing when scrolling back. Queue rows: pressing the small chevron at the end of a row **discloses** the last outreach note under it (MP-07 disclosure: the row grows to fit in 200 ms, the note fades in, rows below are pushed down; collapses in 220 ms).
