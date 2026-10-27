# Direction 3: Transit

Branch `design/transit`, worktree `/home/user/wt/transit`, port **3103**, visual code under `app/demo/_transit/`.

## Idea
The pipeline is a transit line and the queue is a departures board. Swiss signage clarity: big confident type, a strict grid, one color per station, numbers everywhere. The only direction where the six stages themselves are the navigation: a **line strip** of six numbered stations runs across the top of every screen with live counts. Turnover becomes a "service change": "This line is now operated by the 2026-27 board." Bold but extremely legible.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| bg | #FFFFFF | page |
| panel | #F2F2F0 | secondary surfaces |
| ink | #111111 | text |
| ink-2 | #4B4B4B | secondary text |
| board | #111111 | departures board background |
| board-text | #FFFFFF | board text (18.9:1) |
| board-amber | #FFD100 | board highlights: times, "NOW" (12.9:1 on board) |
| signal-red | #DC2626 | overdue ("DELAYED") and errors only (4.8:1 on white, use bold and at least 14 px) |
Station colors, chosen to avoid red and orange and checked at 4.5:1 or better on white, each always paired with a number and a code: **1 NEW** Not contacted #6B7280, **2 SENT** Contacted #1D4ED8, **3 REPLY** Replied #0F766E, **4 TALK** In conversation #7C3AED, **5 WON** Committed #15803D, **6 OUT** Declined #374151 with a diagonal hatch fill. Verify with a color-blindness simulation that 3 and 5 are distinguishable by their badge shape too: stations 1 to 4 use circles, 5 uses a filled square, 6 a hatched square.

## Type
**Overpass** (derived from US highway signage) for everything, weights 400 to 900; **Overpass Mono** for times, codes and counts. Big numerals are a signature: station counts at 28 to 40 px bold.

## Layout and navigation
Top bar (56 px): logo, workspace name, global search, user menu (role switcher, Reset demo, "Prototype" tag).
Under it, the persistent **line strip** (72 px): a thick 6 px line with six station markers in their colors, each with number, code, name and live count; the current page or filter is highlighted with a thicker ring. Clicking a station opens the board scrolled to that column. Turnover banner ("Service change") can slot above the strip.
Main content uses a 12-column grid. The **Queue** is a **departures board**: a black panel with white and amber text and columns DUE (for example "3 DAYS LATE" in signal red bold, "TODAY", "TUE 03 NOV"), COMPANY (the "destination", large), OPERATOR (the claim holder or "Unclaimed"), PLATFORM (station badge), and ACTION (Claim or Log button in white outline). Rows 52 px. The only-mine filter is a toggle "My services only". Never-contacted companies are listed below the board as "Not yet in service".
Right **information desk** drawer (closed by default, 360 px, opens from an "i" button): recent activity as station announcements, keyboard shortcuts, and a placeholder slot for the future Copilot ("Ask the information desk").
Company page: a vertical **route map** on the left (six stops, visited stops filled, current stop ringed, future stops hollow) and on the right the company header, claim block styled as a ticket, contacts, the outreach log as a timetable, and the draft panel.
Board: six columns headed by station badges and counts, cards white with a 4 px left stripe in the station color plus the station code.
Phone: the line strip becomes a horizontally scrollable strip; the departures board turns into stacked two-line rows.

## Icons
**Pictograms** in the spirit of transit signage: solid fills, simple geometry, centered in a rounded square or circle with 2 px padding. Claim (a ticket with a punched hole), release, log (envelope), call, in person (person), queue (clock), board (line with stops), import (arrow into tray), facts (document with tick), settings (gear), AI draft (document with a spark), duplicate (two overlapping tickets), warning (triangle).

## Logo
The **six-stop line bending into a C**: a thick line with six station dots that curves around into a C shape, with the last stop almost touching the first, implying the yearly loop. Black line, dots in the six station colors. Wordmark "Coppice" in Overpass 800.

## Landing page: signature move is **a split-flap board and a train of company cards running the line**
Inspirations (viewed as frame sequences): 60F-06 Revolut plan tabs (the whole background tint cross-fades as the active tab changes), 60F-09 Circle (a value rolls like an odometer and settles), LF-12 lock (a shackle drops shut with a small settle), 60F-15 Threads splash (wordmark breaks apart and the feed fades in with placeholders filling), 60F-12 Revolut coachmark (caption crossfades and a highlight arc runs once around the target).
1. **Hero**: a large black **split-flap departures board** fills the top. On load each character cell flips through a few random characters to its final letter (per flap: rotateX 0 to -90 then 90 to 0 with the next glyph, 60 ms per flip, 2 to 6 flips per cell, cells staggered left to right 15 ms, total about 1.4 s) to spell "NEW BOARD" on line one and "SAME ROOTS" on line two, then three sample departures flip in below (CATERPILLAR, ELI LILLY, ROLLS-ROYCE with times and platforms). The headline, subhead and CTAs sit beside or below it on white. Use CSS 3D transforms on real DOM cells (no canvas), driven by WAAPI or GSAP.
2. **The line** (centerpiece; pinned horizontal scroll section, about 400 vh, GSAP ScrollTrigger with `scrub: 0.5`): a long line map with the six stations runs horizontally; a **company card (the train)** travels along the line as you scroll. At each station the card pauses (the scroll segment eases) and an info panel above explains what happens there: station 1, imported from last year's sheet and claimed before contact; station 2, logged with a follow-up date; the queue brings it back on time (a clock pictogram ticks); station 3, the reply gets credited to the template; station 4, conversation; station 5, committed. At the end the line loops back into a C and a "Service change" banner flips in: "This line is now operated by the 2026-27 board. All history kept." The page background tint shifts slightly per station color (60F-06 idea, very subtle, 6% tint).
3. **Service disruptions** (the problem section): five yellow diamond warning pictograms each flip in (rotateY 180 to 0, 400 ms) with a disruption notice ("Two officers pitched the same company") and the Coppice fix underneath.
4. **Maya and Dev**: two platforms side by side with ticket gates. Maya taps first: her gate arms open (rotate 90 degrees, 300 ms) and her ticket gets punched. Dev arrives 2 seconds later: his gate arms stay shut with a small settle (LF-12 style) and an amber line on the board reads "HELD BY MAYA UNTIL NOV 11".
5. **Features**: a numbered "network map" grid; each feature tile has a station-colored header band.
6. **Who it's for**: four "lines" (student orgs, hackathons, nonprofits, alumni boards) as colored route bullets.
7. **Name story**: the C-shaped line logo animates once (the line draws around the C and the dots pop in order) with the coppice explanation.
8. **Get started**: "How to ride" four steps; **FAQ** as the information desk.
9. **Final CTA**: a single big departures row flips to "COPPICE  NOW BOARDING" with a "Start a workspace" button.

## In-app motion
Split-flap appears **only on counters** (station counts, overdue count) and runs at most 200 ms (one flip), and not at all with reduced motion. When a station count changes, its marker pulses once (scale 1 to 1.15 to 1, 220 ms). First load of the queue: departures rows slide in from the right 12 px with opacity, 20 ms stagger, 180 ms each (only on first mount, never on updates). Claim success: a **ticket punch**, a small circle punches out of the claim badge (scale 0 to 1 in 140 ms) and the operator cell swaps to your name with a 120 ms crossfade. Claim refused: the row flashes a 2 px amber outline once (200 ms) and the board shows "HELD BY MAYA UNTIL NOV 11" in the operator cell for 3 s. Stage change: the company's stop on the route map fills and the segment of line up to it draws (260 ms). Information desk drawer: slides 240 ms. Toasts: a **station announcement bar** that slides down from under the line strip (180 ms) with a speaker pictogram, holds 3 s, slides back.

## Screen notes
Sign-in: a ticket machine screen ("Buy a ticket" becomes "Sign in with Google"). Workspaces: a network list, each workspace as a line with its own color and counts. Import: "Timetable import" steps with the duplicate groups as "Possible duplicate services". Facts: "Notices" with page and quote, verified ones get a green station square. Settings: "Operator settings" (members as staff roster with role badges, claim window as "Hold time 14 days", AI switch).

## Don'ts
No red or orange stations, no split-flap on lists, no subway-bullet copy logo, no color as the only signal, no tiny type on the board.

## Additional references (component libraries, viewed)
Split-flap is this direction's number treatment; do not add odometer rolls or count-ups (other directions own those).
