# Direction 2: Graphite

Branch `design/graphite`, worktree `/home/user/wt/graphite`, port **3102**, visual code under `app/demo/_graphite/`.

## Idea
The neutral power tool. Dense, quiet, keyboard-first, built for the officer who works the queue for an hour straight. Three panes (icon rail, list, inspector), a command palette at the center of everything, and a single new-shoot chartreuse accent that marks "yours" and "now". It sets the bar for speed and density. Personality comes from precision: mono details, a status bar, crisp 120 to 180 ms motion, and a pie-glyph system for stages.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| bg | #FBFBFA | app background |
| surface | #FFFFFF | list and inspector panes |
| panel | #F3F3F1 | rail, hover rows, inputs |
| border | #E4E4E0 | 1 px dividers |
| text | #18181B | primary text (17:1) |
| text-2 | #5B5B63 | secondary (6.5:1 on bg, 6.1:1 on panel) |
| accent | #C6F24E | chartreuse fills only (selected row marker, your-claim chip, primary button) with text #18181B on it (13.7:1) |
| accent-ink | #3F6212 | accent as text or icon on light backgrounds (6.8:1) |
| danger | #B42318 | overdue and errors (6.4:1), always with text |
Stages use **pie glyphs** that fill as a company moves along: Not contacted (empty circle), Contacted (quarter), Replied (half), In conversation (three quarters), Committed (full circle in accent-ink), Declined (circle with a diagonal slash in text-2). Glyph plus label, never color alone.

## Type
**Geist** for everything, **Geist Mono** for IDs, dates, counts, keyboard shortcuts and the status bar. Sizes are small and dense: 13 px base in lists, 14 px in the inspector, 12 px mono.

## Layout and navigation
Left **icon rail** (56 px): logo at top, then Queue, Board, Import, Facts, Settings as 20 px icons with tooltips showing name and shortcut (g q, g b, g i, g f, g s); user menu at the bottom with role switcher, Reset demo and the small mono "PROTOTYPE" tag.
Top bar inside the content: breadcrumb (Workspace / Queue) on the left and a wide **command field** "Search or run a command" with a ⌘K keycap on the right.
**List pane** (about 440 px): dense 34 px rows (pie glyph, company, due in mono like "3d late", holder initials chip, stage label). Keyboard: j/k move, enter opens in inspector, c claim, l log, s stage, / search, ⌘K palette.
**Inspector pane** (rest of width): selected company with a header (name, website, pie glyph, claim chip), tabs Activity, Contacts, Draft, and the claim and log actions pinned at the top. On narrow desktop widths the inspector becomes an overlay sheet.
**Status bar** (24 px, bottom, mono): "42 companies · 7 overdue · claim window 14d · Owner view".
The board page uses the same rail and replaces the list plus inspector with six dense columns and the inspector as a right overlay. Company page route (`/companies/[id]`) shows the inspector full width with the list collapsed into a back link, so deep links work.
Phone: rail becomes a bottom bar, the list is full screen, the inspector pushes in as a full screen sheet.
The command palette (⌘K or the field) lists actions and companies: "Claim Eli Lilly", "Log outreach on Cummins", "Go to Board", "Import CSV", "Switch to Owner view". It is the fastest path to everything.

## Icons
Geometric, 16 px grid, 1.5 px stroke, square caps and mitered joins, drawn as inline SVG. Shapes are built from circles, squares and straight lines only. Include the pie glyph set.

## Logo
A **"C" drawn from a 3 by 3 dot matrix**: eight dots lit in graphite, the right-middle dot missing (the opening of the C), and one dot (top-right) in chartreuse. Wordmark "coppice" in Geist 600 lowercase. Simple enough to read at 16 px.

## Landing page: signature move is **the product demonstrating itself with a scripted cursor**
Inspirations (viewed as frame sequences): 60F-20 ui.sh (headline ending types and deletes with a block cursor, cycling phrases), 60F-17 Dub slide-to-compare (a draggable vertical edge reveals the competitor version), 60F-19 Evervault scan (a card passes through a glowing beam and the part past the beam turns into a dot pattern), 60F-03 Cobot toast (pill toast holds, then narrows to its icon and fades), 60F-09 Circle claim (button greys to a loading state, a number rolls, the result settles with a soft glow), 60F-11 Remy checklist (checks land one row at a time). Plus Motion Primitives and NumberFlow references noted at the end of this file.
1. **Hero**: white page, oversized Geist headline with a **typing ending**: "Claim it before you" followed by a cycling phrase typed and deleted with a chartreuse block cursor ("email them.", "call them.", "walk up to their booth.", "pitch them."), 45 ms per character typing, 25 ms deleting, 1.6 s hold. Below it, a **live mini app window** (real HTML built from your components, not a video) where a **scripted cursor** (a GSAP timeline, about 9 s, loops with a 2 s pause, pauses when off-screen) moves to the command field, the palette opens, the cursor types "claim lilly", presses enter, the row's chip turns chartreuse ("Claimed by you · until Nov 11"), the queue re-sorts with a FLIP animation, and keycaps under the window light up in sync (⌘K, C, L, J, K). Respect reduced motion: show the final state statically.
2. **Problem**: five compact cards; each shows a tiny spreadsheet fragment that "breaks" when it enters view (two rows collide, a date cell goes stale and grays out, and for duplicates a translucent copy of the "Acme Corp" row lifts up and to the right out of the original and lands as "acme corp" (UV-02 file-duplicate press)), then the Coppice fix fades in beside it.
3. **Your sheet vs Coppice**: a **slide-to-compare** panel (adapted from 60F-17): left the messy sheet, right the Coppice queue, with a draggable vertical divider and a "Drag" pill; keyboard arrows move the divider too.
4. **How it works**: five steps as a horizontal sequence of small looping demos that only run when in view (motion `inView`): Import (CSV rows slide **through a chartreuse scan line** and come out tagged, two of them flagged "Possible duplicate", adapted from 60F-19), Claim (the 60F-09 rhythm: button greys "Claiming…", then "Held by you · Nov 11" settles with a chartreuse glow), Log (a log form fills and the row leaves the due list), Follow-up returns (a date ticks forward and the row slides back to the top), Turnover (the workspace owner chip swaps names while the history list stays put).
5. **Features**: a dense 4 by 2 grid of cards with mono labels and one small motif each.
6. **Live example**: two side-by-side mini windows, Maya and Dev, two cursors race to the same row; Maya's click lands first (her chip turns chartreuse), Dev's window shows the refusal **toast that expands, holds and shrinks to its icon** (60F-03): "Held by Maya until Nov 11".
7. **AI drafts**: the claim checker as a mono checklist (60F-11 rhythm): "Reading fact sheet", "Matching numbers", "Checking claims", each line gets a check 400 ms apart, then a draft paragraph appears with one phrase underlined in danger red and a tooltip "Not in your verified facts".
8. **Numbers strip**: counts roll digit by digit when they enter view, using your own small digit-roll component (each digit is a vertical strip of 0 to 9 moved with a CSS transform via WAAPI or a class), not @number-flow/react.
9. **Get started, FAQ, footer**: FAQ as a keyboard-navigable list; final CTA with the dot-matrix logo where dots light up one by one on hover.

## In-app motion (fast)
Everything 100 to 180 ms with `cubic-bezier(.2,.8,.2,1)`. Command palette: opacity plus scale .98 to 1 in 140 ms, no stagger on results. List re-sorting: FLIP, 180 ms. A single **row highlight** element glides between rows as j/k move (transform, 90 ms). Inspector content swap: crossfade plus 4 px slide, 120 ms. Claim: the button morphs, "Claim" to a spinner (min 120 ms) to the chartreuse chip "Held by you · Nov 11", width animating via FLIP (60F-09 rhythm compressed). Refusal: the button shakes once (120 ms) and a toast shows. **Toasts**: bottom-center pill that expands from a 32 px icon to full width (180 ms), holds 2.5 s, shrinks back to the icon (180 ms) and fades (60F-03). Counts in the status bar and badges roll digits (Motion Primitives sliding number idea). AI draft loading: the mono checklist from the landing, compressed (each check 300 ms). Initial data loads use a faint skeleton shimmer band (UV-19 skeleton, one sweep per second) only if something takes longer than 300 ms. No hover animations beyond background color changes.

## Screen notes
Sign-in: centered card with the dot logo, "Continue with Google", and a mono footnote. Workspaces: a palette-like list with role and counts per workspace, arrow keys work. Board: six dense columns with pie glyph headers and counts in mono; drag between columns with a ghost card and a highlighted drop column. Import: a stepper in the inspector style (Upload, Map, Duplicates, Done) with a mono log of rows. Facts: table with page, quote, status; verify toggles with space. Settings: sections in the inspector style.

## Don'ts
No gradients, no shadows beyond a 1 px border and one subtle shadow on overlays, no decorative motion in the app, no chartreuse text on white (use accent-ink).

## Additional references (component libraries, viewed)
Counts in the status bar, stage badges and the landing numbers strip use an **odometer digit roll** (MP-03 sliding number: each digit column rolls vertically to its new value, 300 ms in-app, 900 ms on the landing). The j/k row highlight glide follows RB-19 (a single highlight element that slides between rows, 90 ms). Inspector tab changes use the MP-04 transition panel idea (outgoing content blurs 4 px and fades while sliding up 8 px, incoming does the reverse, 160 ms total). Landing hero background: a faint **dot grid** (RB-21) behind the mini app window where dots within about 120 px of the pointer grow slightly and light in chartreuse, echoing the dot-matrix logo; desktop only, canvas, paused off-screen, off with reduced motion.
