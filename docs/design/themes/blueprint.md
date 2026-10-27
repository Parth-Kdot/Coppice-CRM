# Direction 5: Blueprint

Branch `design/blueprint`, worktree `/home/user/wt/blueprint`, port **3105**, visual code under `app/demo/_blueprint/`.

## Idea
The pipeline as a technical drawing set. A cobalt drafting desk with a faint grid; every screen is a white **drawing sheet** with a frame, zone coordinates along its border and an engineering **title block** in the corner. Navigation is a **floating draftsman's tool dock**, not a sidebar or top bar. Red pencil marks what needs attention. Precise, clever, and very different in layout from the other seven. The grid stays faint behind white sheets so contrast never suffers.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| desk | #1B3B8F | cobalt background behind sheets |
| desk-deep | #12296A | dock, overlays on the desk |
| desk-grid | white at 8% | grid lines on the desk |
| desk-text | #FFFFFF | text on desk (10.2:1); #C9D6FF for secondary on desk (7.0:1) |
| sheet | #FDFDFB | drawing sheet |
| sheet-grid | #E6EBF4 | faint grid on sheets (decorative only) |
| ink | #0F1B3D | text on sheets (16.6:1) |
| ink-2 | #4A5677 | secondary text (7.1:1) |
| construction | #3BA7D9 | decorative construction lines and dimension lines; as text use #0E6F99 (5.5:1) |
| pencil | #D93A2B | red pencil marks (circles, underlines); for red text use #B3261E (6.4:1) |
| highlighter | #FFE066 | selection and search highlights behind ink text (12.9:1) |
Stages are labeled with drawing codes in mono: NC, CT, RP, IC, CM, DC, each in a small rectangular tag with a distinct border pattern (solid, dashed, dotted, double, thick, struck), so they never rely on color.

## Type
**IBM Plex Sans Condensed** (500 to 700) for headings and labels, uppercase with letter-spacing for sheet titles. **IBM Plex Mono** (400 to 600) for data, numbers, codes, title block fields and dimension values. Body text in Plex Sans Condensed 400.

## Layout and navigation
The **desk** fills the viewport (cobalt with the faint grid). A **floating tool dock** sits at the left middle: a vertical rounded panel (desk-deep, 64 px wide, 12 px from the edge) holding tools: Queue (Q), Board (B), Import (I), Facts (F), Settings (S), a divider, Search, and the user (role switcher, Reset demo, "Prototype" tag). Each tool is a 40 px button with a hairline icon; hover slides out a label tag with the shortcut. The active tool has a white outline and a small cyan tick.
The content sits on a **drawing sheet** (white, max 1240 px wide, centered with room for the dock, 24 px margin from the desk edge, subtle drop shadow). The sheet has a 1 px ink frame inset 16 px with **zone markers** (A B C D across the top and bottom, 1 2 3 4 down the sides, in mono 10 px). A **title block** sits bottom-right of every sheet (a small ruled table): sheet title, workspace, "Drawn by" (current user), date (DEMO_NOW), sheet number (for example "S-01 of 09"), and for company pages, revision (number of outreach entries) and status (stage code). The title block is real information, not decoration.
Queue sheet ("S-01 Follow-up schedule"): a ruled schedule table (Plex Mono numbers), overdue rows marked with a **red pencil underline** under the due cell and a pencil tick in the margin; the count of overdue items at the top gets a hand-drawn red pencil circle.
Company sheet: the company as a "part drawing": header, claim block as a detail callout bubble ("DETAIL A: CLAIM") with a leader line to the title block status, contacts as a parts list, the outreach log as a revision history table (Rev, Date, By, Channel, Note), draft panel as "General notes".
Board sheet: six columns drawn as a section view, column titles as section labels "SECTION NC-NC".
Phone: the dock becomes a bottom bar, sheets go edge to edge with a smaller frame, the title block moves to the top as a compact strip.

## Icons
**Hairline technical icons**: 1 px strokes at 20 px, with tiny construction ticks (2 px crosshair marks at key corners) and occasional dimension arrows. Drawn as inline SVG, ink on sheets and white on the desk.

## Logo
A **section-cut marker forming a C**: a circle with a quarter gap on the right side, two short perpendicular arrows at the gap's ends (like a section indicator "A-A"), and a small letter C in the circle's center in Plex Mono. White on desk, ink on sheets. Wordmark "COPPICE" in Plex Sans Condensed 700 with wide letter-spacing.

## Landing page: signature move is **an exploded drawing of the product that assembles as you scroll**
Inspirations (viewed as frame sequences): LF-17 "Grow your forest" (an isometric tile where elements pop up in a scattered order until the plane is full), 60F-13 Revolut pocket (a card scales up out of black into a full page; on delete it shrinks to a card and dissolves into grain), LF-08 upload (a dashed frame draws in, an arrow rises, a ring completes, then a check), LF-06 empty box (a magnifier sweeps over a box before a status badge pops), 60F-12 coachmark (an arc runs once around the highlighted control).
1. **Hero**: the cobalt desk. A **dimension line** draws across the top of the headline (two arrowheads extend outward from the center over 600 ms, then the value "14 DAYS" types in mono above it), then the headline "New board, same roots." appears letter by letter as if lettered with a stencil (opacity and a 2 px y-shift, 25 ms stagger). On the right, an **isometric exploded view** of a Coppice screen: four thin layers floating apart along the z-axis (the queue sheet, a claim lock detail, the outreach log, the contacts list), each with **leader lines and callout labels** ("1. CLAIM LOCK, one holder, database enforced"). Build it with CSS 3D transforms on DOM layers (rotateX 55deg rotateZ -45deg on a container).
2. **Assembly** (pinned, about 300 vh, ScrollTrigger `scrub: 0.6`): as the user scrolls, the exploded layers **slide together** one by one into a single assembled stack, each callout ticking off as its layer seats ("FIG. 2 ASSEMBLED"), while numbered assembly steps on the left explain the loop (import, claim, contact and log, queue returns it, next board inherits). At the end the assembled stack rotates flat (rotateX to 0) into a straight-on view of the real queue sheet.
3. **Failure analysis** (the problem section): a white sheet titled "FAILURE ANALYSIS: SHARED SPREADSHEET"; five failure modes listed; as each enters view a **red pencil circle** is drawn around it (SVG path with a slightly imperfect hand-drawn loop, stroke draw 500 ms) and a correction note in ink appears beside it with the Coppice fix.
4. **Maya and Dev** as a **sequence diagram**: two vertical lifelines (Maya, Dev) and a third (Coppice database). Arrows draw left to right in sequence as the user scrolls: Maya "claim(Kestrel)" arrives first and gets "OK, held until Nov 11"; Dev's "claim(Kestrel)" arrives 2 s later and gets a red "REFUSED: held by Maya" return arrow. Message labels type in.
5. **Features** as a **parts list** table with item numbers, part names, and a one-line spec, each row with a tiny hairline icon; hovering a row highlights the matching layer of a small assembled drawing beside it.
6. **Name story**: an orthographic drawing (top view and side view) of a coppiced stump with shoots, with dimension lines and a note "CUT ON CYCLE, REGROWS FROM SAME ROOTS".
7. **Get started** as **assembly instructions**: four numbered steps with hairline illustrations (sign in, create workspace, invite by link, import sheet).
8. **FAQ** as "General notes" numbered 1 to 8.
9. **Final CTA**: a title block styled as a sign-off ("APPROVED FOR USE BY: your team") with the "Start a workspace" button.

## In-app motion
Selection or focus on a row: a **hairline underline draws** left to right under it (160 ms). Overdue count: the red pencil circle draws once on first view (400 ms), never loops. Claim success: a **dimension bracket** snaps around the row: two short brackets extend from the row's ends (200 ms) with a mono label "HELD BY YOU / 14 D". Claim refused: a red **revision cloud** (a scalloped outline, the drafting convention for "changed here") draws around the claim block (300 ms) with the note "HELD BY MAYA UNTIL 11 NOV". Updates anywhere: a small cyan revision triangle with the new revision number pops beside the changed item (scale 0 to 1, 160 ms). Sheet change between pages: the new sheet slides up 24 px and fades in (220 ms) while the old one dims slightly, like laying a fresh sheet on the desk. Dock tooltips slide out 120 ms. **Toasts**: a small "NOTE" tag pinned to the top-right of the sheet with a leader line (slides in 180 ms, holds 3 s). AI draft loading: a thin cyan **scan line** sweeps down the draft area with crosshair ticks until the text arrives.

## Screen notes
Sign-in: the desk with a single small sheet "S-00 ACCESS" and the Google button. Workspaces: a drawing register (table of sheet sets: workspace, role, counts, last revision). Import: "S-05 IMPORT" with the steps as numbered views (VIEW 1 UPLOAD, VIEW 2 MAP, VIEW 3 DUPLICATES, VIEW 4 RESULT); duplicate groups marked with a pencil bracket and a note. Facts: a "Specification" table with clause numbers, page refs and quotes; verify adds an ink check in a box. Settings: "S-09 PROJECT SETTINGS" with members as the drawing's approval list.

## Don'ts
No text on the cobalt grid except nav and headings, no grid lines behind body text that compete with it, no blueprint-blue text on white below 4.5:1, no loops in the app.

## Additional references (component libraries, viewed)
On the landing, each callout label in the exploded drawing **resolves from scrambled drafting characters** into its text left to right when its layer seats (RB-14 decrypted text, 700 ms, using only characters like 0-9, A-Z, slashes and dashes so it reads as technical lettering). Not used in the app.
