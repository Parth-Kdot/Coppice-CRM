# Direction 6: Stamp

Branch `design/stamp`, worktree `/home/user/wt/stamp`, port **3106**, visual code under `app/demo/_stamp/`.

## Idea
The loud, playful direction for teams that want energy, done with enough discipline to stay credible. Neo-brutalist: thick black borders, hard offset shadows, flat ink colors, chunky wide display type, and a rubber stamp as the hero object: claiming a company **stamps** it. Two inks plus black, never more. The home is a **bento grid** where the overdue queue is always the largest tile, so the playfulness never pushes the core job aside.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| paper | #FFFDF5 | page |
| paper-2 | #F4F1E6 | quiet tiles, inputs |
| ink | #111111 | text, borders (3 px), shadows (hard offset 4 px 4 px 0) |
| ink-2 | #5C5A52 | secondary text (6.8:1) |
| sun | #FFD23F | primary ink: highlights, primary buttons, your claims (ink text on it 13.1:1) |
| coral | #FF6B5B | second ink: overdue tiles and warnings as a fill with ink text (6.8:1); for coral text on paper use #C2321F (5.5:1) |
Stages use the inks plus pattern, always labeled: Not contacted (paper with black border), Contacted (paper-2), Replied (sun at 40% tint #FFEDB2), In conversation (sun), Committed (ink fill with sun text, label "WON"), Declined (diagonal black hatch on paper, label "NO").

## Type
Display: **Unbounded** (700 to 900) for headlines, tile titles, big numbers and stamp text. UI and body: **Archivo** (400 to 700), tabular numerals in lists. Uppercase with tight tracking for labels.

## Layout and navigation
Top **sticker nav** (68 px): logo on the left, then nav items as chunky tabs (Queue, Board, Import, Facts, Settings) each with a 3 px border and hard shadow; the active tab is sun-filled and pressed down (shadow collapsed). Right side: search, user menu (role switcher, Reset demo, "PROTOTYPE" sticker).
**Queue page = bento grid** (12 columns, 16 px gaps): the **Overdue queue tile** spans 8 columns and the full height of the first screen (the list of due companies with chunky rows, overdue amount in a coral pill, holder, stage chip, Claim and Log buttons); right column tiles stack: "Your claims" (count plus 3 names), "Overdue" (one huge Unbounded number in a coral tile), "Pipeline" (six mini bars by stage with counts), "Quick add company" (a compact form). Below: "Never contacted" tile with a horizontal scroll of chunky cards.
Board: six column tiles with thick borders; cards are mini stickers with hard shadows; drag and drop picks a card up (shadow grows to 8 px, slight rotate 2 degrees).
Company page: a big header tile (name in Unbounded, website, stage chip, claim stamp area), then tiles for Contacts, Outreach log (as a stack of tickets), Draft email (with flagged claims highlighted in sun with a coral squiggle underline), Notes.
Phone: nav becomes a bottom sticker bar; bento collapses to one column with the queue first.

## Icons
**Sticker icons**: chunky filled shapes with a 2 px ink outline and a white 3 px outer stroke (like a die-cut sticker), 24 px, slightly rounded. Drawn as inline SVG. Include a rubber stamp icon for Claim.

## Logo
A **rubber stamp impression**: a rounded rectangle double border with "COPPICE" in Unbounded 900 and a tiny "CO." with a star, ink black, with a subtle distressed edge made by an SVG mask of small irregular gaps (no raster texture). Also a small square version "C." for the favicon area.

## Landing page: signature move is **stickers slapping onto the page and a CLAIMED stamp coming down**
Inspirations (viewed as frame sequences): UV-c06 3D pill press (the button face sinks into its base and springs back), UV-c11 jello (squash wide, squash tall, settle), UV-c10 checkbox burst (fill plus a short radial burst of lines), UV-c03 send button (letters wave and scatter off one by one), 60F-14 Fold empty state (cards pop up out of a slot one after another and settle), 60F-02 Numo (check, then a toast drops in, then a short burst of confetti), LF-13 confetti (a brief burst, two seconds). Plus React Bits click spark and infinite scroll references in the notes.
1. **Hero**: huge Unbounded headline "NEW BOARD, SAME ROOTS." where each word **drops in with squash and stretch** (from y -40 px: scaleY 1.2 and scaleX .9 while falling, then scaleY .85 and scaleX 1.1 on landing, settling to 1 with a jello wobble like UV-c11; 90 ms stagger per word; total about 1 s). Then **stickers slap** onto the page around the headline: "HACKATHONS", "ROBOTICS CLUB", "ALUMNI BOARD", "NONPROFITS", "STUDENT ORGS", each scaling from 1.4 to 1 with a random rotation between -8 and 8 degrees and its hard shadow popping in (140 ms each, 80 ms stagger), with a tiny burst of 6 short lines at impact (UV-c10). The primary CTA is a sun 3D button that sinks into its base when pressed (UV-c06).
2. **Org marquee**: a thick black band with sun text running "STUDENT ORGS  HACKATHONS  NONPROFITS  ALUMNI BOARDS" as an infinite horizontal scroll (CSS animation; pauses on hover and with reduced motion).
3. **The problem**: five torn "spreadsheet scraps" (paper-2 tiles with a jagged SVG torn edge) that slide in rotated; each gets a coral "NOPE" stamp when it settles, and a sun tile beside it with the fix.
4. **The claim** (centerpiece; scroll-triggered): a big company card "KESTREL AEROSPACE" sits center. When it enters view, a **rubber stamp** (the stamp object drawn in SVG with a handle) comes down from above (translateY and scale 1.6 to 1, 160 ms ease-in), the card squashes slightly on impact (scaleY .96, 80 ms), the stamp lifts away (200 ms), leaving the impression "CLAIMED · MAYA · UNTIL NOV 11" rotated -6 degrees in ink with distressed edges. A second card for Dev slides in beside it, and when he clicks Claim, a coral "TAKEN" stamp lands on his button instead, with the line "Held by Maya until Nov 11".
5. **How it works**: five steps as numbered stickers on a corkboard-free grid; each step tile flips in (rotateY 90 to 0, 300 ms) as it enters view.
6. **Features**: bento of feature tiles that **tilt slightly toward the cursor** on hover (max 4 degrees) with the hard shadow shifting opposite.
7. **Who it's for, name story, trust**: chunky tiles; the trust tile has a big "WILL NEVER" list with each item struck through by a thick coral line as it scrolls in.
8. **Get started**: four numbered stickers; **FAQ** as chunky accordions whose plus icon spins 45 degrees and whose panel opens with a quick spring (height, 220 ms).
9. **Final CTA**: "START A WORKSPACE" giant 3D button; on click, a short confetti burst of square ink pieces in sun and coral (LF-13, 1.5 s, landing only) before navigating.

## In-app motion
Buttons: **press into the shadow** (translate 3 px 3 px, shadow from 4 px to 1 px, 70 ms; release 110 ms) on every primary and secondary button (UV-c06). Claim success: the **stamp impression** appears on the card or row: scale 1.3 to 1 with a -8 degree rotation and one tiny 2 px shake on landing (200 ms total), then it stays as the claim badge "YOURS · NOV 11". Claim refused: a coral "TAKEN" stamp lands on the claim button (same motion, coral) plus a toast with holder and expiry. Toggles (AI switch, only-mine filter): the knob slides with a slight overshoot and the track fills sun (UV-c09, 200 ms). Fact verify: the checkbox fills ink with a short radial burst of 6 lines (UV-c10, 260 ms). Card hover: lift 2 px with the shadow growing from 4 to 6 px (120 ms). **Toasts**: sticker-like cards that slap in at the top-right (scale 1.15 to 1, rotate -3 degrees to 0, 160 ms) and slide out after 3 s. Page change: tiles fade up 8 px with a 30 ms stagger capped at 6 tiles (total under 300 ms). AI draft loading: the rubber stamp icon bobs up and down (one 600 ms loop) while waiting. Empty states: a sticker "ALL CLEAR" slaps in once.

## Screen notes
Sign-in: one chunky tile with the stamp logo and a big Google button. Workspaces: workspace tiles in a bento with org-type stickers. Import: steps as numbered tiles; duplicate groups shown as two stickers overlapping with "SAME?" and Skip or Import buttons. Facts: rows with page and quote; verified rows get the ink check. Settings: tiles for Members, Invite link (big copy button that shows "COPIED" stamp), Claim window (a chunky stepper), AI (big switch), Ownership.

## Don'ts
No third ink color, no gradients, no soft shadows, no rounded-pill everything (corners 6 px max), no motion over 300 ms in the app, no confetti in the app.

## Additional references (component libraries, viewed)
Feature tiles on the landing **tilt toward the pointer** with a short lag (MP-10 tilt, max 4 degrees, 150 ms follow). Bento tiles on in-app page loads appear as a quick **group entrance** (MP-06 animated group idea: fade and scale .97 to 1, 40 ms apart, capped at 6 tiles).
