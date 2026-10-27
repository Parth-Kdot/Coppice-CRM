# Direction 4: Ring Count

Branch `design/ring-count`, worktree `/home/user/wt/ring-count`, port **3104**, visual code under `app/demo/_ring/`.

## Idea
Dark mode first, warm like a cut log under lamplight. A tree's growth rings record every year it has lived; Coppice records every board. Rings carry history (one ring per board year on the company page), claim expiry (a ring that depletes), and the landing story. Real statistics always stay as plain bars and numbers so data never becomes a puzzle. Bold display type, amber light, bark browns.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| bg | #12100E | page |
| surface | #1B1815 | cards, panels |
| surface-2 | #24201C | hover, inputs, nested panels |
| border | #3A332C | dividers |
| ring | #4A3F35 | ring lines, decorative strokes |
| text | #F3EBDD | primary text (16:1) |
| text-2 | #B9AC98 | secondary text (8.5:1 on bg, 7.9:1 on surface) |
| amber | #F2A541 | primary accent, current ring, primary button fill with bg-colored text (9.3:1) |
| sap | #8FBF73 | success, committed (8.3:1 on surface) |
| ember | #F0766B | overdue and errors (6.8:1 on bg, 6.3:1 on surface), always with text |
| bark | #8B5E3C | decorative only (illustration, ring fills) |
Stages: label plus a small ring glyph with as many inner rings as the stage number (1 to 4), committed as a solid sap disc, declined as a ring with a crack line.

## Type
Display: **Bricolage Grotesque** (700 to 800, condensed widths where available) for page titles, big numbers and landing headlines. UI: **Hanken Grotesk** (400 to 600) with tabular numerals for tables and counts. No monospace in this direction.

## Layout and navigation
Top bar (64 px) on bg: logo and workspace switcher on the left; a **centered segmented pill nav** (Queue, Board, Import, Facts, Settings) where the active segment is an amber-outlined pill that glides between items; search and the user menu (role switcher, Reset demo, "Prototype" tag) on the right.
Content is a wide canvas with generous margins (max 1280 px). The **Queue** is a list of wide cards (64 px) on surface: left a **claim ring** (24 px; full amber when held by you, text-2 outline when held by someone else, depleting clockwise toward expiry, hollow when unclaimed), company name in Hanken 600, due status ("12 days overdue" in ember, "Due Thursday" in text-2), holder, stage glyph, and actions. Above the list, a summary band with three big Bricolage numbers (Overdue, Due this week, Held by you).
**Company page**: left column holds the **ring timeline**: concentric rings, one per board year that touched this company (innermost is the oldest), each ring with small tick marks around it for every outreach logged that year, the current year's ring in amber; hovering a tick shows the entry. Right column: header, claim panel with the expiry ring at 48 px and "Held by Maya, 9 days left", contacts, the outreach log list, draft panel.
Board: six columns on surface with Bricolage headers and counts; cards show the claim ring.
Phone: the pill nav becomes a bottom pill bar; the ring timeline shrinks to a horizontal band of arcs above the log.

## Icons
Thick 2 px rounded strokes built around circles and arcs (rings with notches, arcs with arrowheads). Claim (ring closing with a notch), release (ring opening), log (arc with arrow), queue (three nested arcs), board (columns inside a circle), import (arrow into a ring), facts (document with a ring stamp), settings (ring with teeth), AI draft (ring with a spark).

## Logo
**Concentric growth arcs forming a C**: three or four nested arcs, all open on the right side so together they read as a C, slightly irregular like real growth rings, with one small amber notch on the outermost arc. Wordmark "Coppice" in Bricolage 800.

## Landing page: signature move is **growth rings spreading across a cross-section, one per board year**
Inspirations (viewed as frame sequences): 60F-18 Antimetal hero (dots appear in a ring, collapse into a dense halftone cluster, then settle into a small shape while the headline blurs in), 60F-09 Circle (a number rolls and the card gets a soft glow), 60F-12 Revolut coachmark (a bright arc runs once around a target), LF-10 calendar to clock (a clock face emerges and its hands sweep, then become a check), 60F-03 Cobot (an error state does a 3D flip of the mark). Plus React Bits count-up and Motion Primitives sliding number (see notes).
1. **Hero** (canvas 2D or `ogl`, devicePixelRatio aware, paused when off-screen): starts with a ring of amber dots (60F-18) that collapses inward into a dense warm cluster, then **growth rings draw outward** from the center one by one (each ring a slightly wobbly closed path from simplex-like noise, 180 ms per ring, about 18 rings, older rings in bark, the outermost in amber), with a fine radial crack. The headline "New board, same roots." blurs in after the rings settle (blur 10 px to 0, 600 ms). On mouse move the rings shift a few pixels in parallax (desktop only).
2. **Years** (pinned section, about 250 vh, ScrollTrigger `scrub`): the cross-section from the hero scales up and sits left; as the user scrolls, rings highlight one at a time from the inside out, each labeled with a board year ("2022-23 board, 31 companies, 6 committed", "2023-24 board…", up to "2026-27, you are here"). The numbers in each label **roll** (odometer style) as the ring lights. The message: every board adds a ring; the core stays.
3. **The problem**: five cards, each with a **crack** drawn across a small ring (stroke draw, 400 ms) as it enters view, and the Coppice fix below in text-2.
4. **How it works**: a **radial loop** of five stations around a circle (import, claim, contact and log, the queue brings it back, the next board inherits). As you scroll, a clock hand sweeps around the circle (LF-10 idea), lighting each station and swapping the explanation in the center.
5. **Maya and Dev**: two claim rings side by side. Maya taps first: her ring **closes and fills amber** clockwise in 500 ms with a soft glow (60F-09). Dev's ring, a beat later, does a quick 3D Y-axis flip and settles in ember with "Held by Maya until Nov 11" (60F-03 error flip).
6. **Features**: cards on surface with amber icons; on hover, a thin arc runs once around the icon (60F-12, 600 ms).
7. **Name story**: a large cut-stump cross-section illustration with shoots implied at the rim, explaining coppicing.
8. **Get started, FAQ**: FAQ answers expand with height animation; the open item's ring glyph rotates 90 degrees.
9. **Final CTA**: an amber button; on hover a single ring ripples outward from it once (500 ms).

## In-app motion
Claim success: the claim ring **fills clockwise** (SVG `stroke-dashoffset`, 400 ms ease-out) and glows amber once (box-shadow fade 600 ms). Claim refused: the ring does a single Y-axis flip (300 ms) and turns ember outline while a toast explains. Expiry rings are static between interactions (no ticking). Log outreach: the row's due text crossfades to the new date and the row fades out of the due list after 400 ms with FLIP close-up of the gap (220 ms). Queue card hover: the row's quick actions (Log, Open, Release) fade and rise 8 px into place while the card's border warms to amber at 40% (UV-15 card hover reveal, 200 ms). Pill nav: the amber outline glides to the new segment (220 ms). Page change: fade plus scale .99 to 1 (180 ms). Ring timeline on the company page: rings draw outward once on first view (100 ms per ring, max 600 ms total). **Toasts**: bottom-left card with a thin amber ring around its icon that depletes as the auto-dismiss timer (3 s) runs. Big numbers roll when they change (300 ms). AI draft loading: three concentric rings pulse outward slowly while waiting.

## Screen notes
Sign-in: full-bleed dark with the hero rings dimmed behind a centered card. Workspaces: each workspace as a large ring badge with its ring count (board years) and counts. Import: steps along an arc at the top; duplicate groups shown as overlapping rings (Venn) with skip or import. Facts: list with page and quote, verified ones get a sap ring. Settings: members with role badges; the claim window control is a ring dial (with a plain number input beside it).

## Don'ts
No radial charts for real statistics, no glow on body text, no pure black, no cool grays, no ticking or spinning rings while idle.

## Additional references (component libraries, viewed)
Big numbers **count up** from zero on first view with a fast start and long ease-out (RB-12 count up, 900 ms on the landing, 400 ms in-app; on later changes count from the old value). Do not use an odometer roll (another direction owns it). Queue card click opens a **quick look** that morphs out of the card into a centered dialog with the page behind blurred (MP-05 morphing dialog, 280 ms open, 200 ms close) showing the claim ring, last note and Log/Open buttons; "Open full page" goes to the company route. Moving a company to Committed releases a small burst of eight short sap-green lines from the stage control (RB-18 click spark, 400 ms; only for Committed). Landing section 2 background: very faint flowing wood-grain lines (RB-16 threads idea, bark color at 15% opacity, slow), landing only, canvas, paused off-screen.
