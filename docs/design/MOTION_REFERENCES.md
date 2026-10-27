# Motion references

Every animation below was downloaded and viewed frame by frame (as a contact sheet of evenly spaced frames) before any direction borrowed from it. Ids are used in the direction briefs. Sources: 60fps.design (60F), Motion Primitives (MP) and React Bits (RB), animated Lucide and Heroicons (LA, HA) and NumberFlow (NF), all curated by designeer.xyz; plus LottieFiles (LF) and Uiverse (UV) as the two extra motion databases. The recordings themselves stay out of the repo: 60fps.design's terms forbid re-hosting, and the rest were study copies.

60F-01 Clear swipe-to-check: row flashes green with check and strikethrough, then drops out to the bottom fading dark while rows below close the gap. ~1s.
60F-03 Cobot toast: pill toast holds, narrows to icon only, icon fades; meanwhile the logo does a Y-axis flip (error shake by rotation).
60F-04 Cosmos drag: dragged tile shrinks to a round thumbnail, dashed "Drag to pin" target morphs to "Pin cluster" carrying the thumbnail; after drop an undo toast slides up.
60F-05 Trackables card morph: tile scales to full screen keeping its color, content fades in; reverse on close.
60F-06 Revolut plan tabs: tab pill moves, card slides sideways, whole background tint cross-fades per tab (indigo, green, bronze).
60F-07 Circle menu morph: chip grows into a white card over dimmed page, rows appear; shrinks back into chip on close.
60F-09 Circle claim balance: button greys "loading", number rolls odometer style to final value, caption swaps, soft green glow arrives on card.
60F-11 Remy checklist: two glowing "eyes" blink and slide up to the top; a list fades in and checkmarks land one row at a time.
60F-12 Revolut coachmark: dim page, caption crossfades per step, a bright arc runs once around the highlighted button; end reveals full page with color.
60F-13 Revolut pocket: create = card scales up from black into full page; delete = page shrinks to card then dissolves into particle grain sweeping sideways.
60F-14 Fold empty state: cards pop up out of a wallet slot one after another and settle. ~0.9s.
60F-15 Threads splash: wordmark erases right to left with letters breaking up, then feed fades in with skeleton bars.
60F-17 Dub slide-compare: a draggable vertical edge with "Slide" pill reveals the competitor version under the product UI.
60F-18 Antimetal hero: dots emerge in a ring, collapse into a dense halftone cluster, then settle into a small dotted globe while headline blurs in.
60F-19 Evervault scan: card slides through a glowing vertical beam; the part past the beam becomes a dot-matrix pattern.
60F-20 ui.sh headline: last words type and delete with a block cursor, cycling phrases.
LF-05 Email sent: envelope flap opens, letter slides in, flap closes, envelope folds into a paper plane that arcs up and shrinks to a dot far away.
LF-06 Empty box: magnifier sweeps over an open box, then fades; a red "!" speech badge pops above the box.
LF-08 Upload: dashed frame draws in, arrow rises, a circular ring completes around the arrow, frame collapses to a dot, green check badge pops, then shrinks to dot.
LF-10 Calendar to clock: calendar shrinks and a clock face emerges from its center, hands sweep, hands morph into a checkmark inside a circle, then back to calendar.
LF-12 Lock: open shackle drops down closed with a small settle.
LF-14 Growing plant: stem rises from soil mound, leaves unfurl alternating left/right, top bud opens; settles at ~1.2s.
LF-16 Sapling lifecycle (line art): thin-line seedling grows, branches split, red buds appear, then the plant browns and withdraws back to the soil (full cycle, 18s). The literal coppice cycle.
LF-17 Grow forest: isometric grass tile; trees pop up in scattered order until the tile is full.
UV-c03 Send button letters: on press the label letters wave and scatter off to the right one by one while the plane icon slides to center and turns to point right.
UV-c06 3D pill press: thick-based button; on press the face sinks into its base (shadow depth shrinks), springs back on release.
UV-c08 Lock switch: shackle swings open about 30 degrees with a small overshoot while the tile's color crossfades dark gray to purple.
UV-c09 Switch spring: knob slides across with a slight overshoot and the track fills with color behind it, ~200 ms.
UV-c10 Checkbox burst: circle fills green with a check, short radial lines burst outward and fade, ~300 ms.
UV-c11 Checkbox jello: the dot squashes wide then tall then settles, a jelly wobble ~400 ms.
UV-c12 Bookmark pop: outline bookmark fills solid, then a check draws inside it, ~350 ms.
UV-c13 Glider tabs: white pill glides under the newly chosen tab, ~150 ms, hover tint on target.
UV-02 File duplicate press: tile squashes slightly, a translucent copy of the file icon lifts up-right and fades, ~200 ms.
UV-07 Padlock checkbox: coral disc with open shackle; on check, disc turns green, shackle snaps shut, three short spark dashes flick out to the right.
UV-15 Card hover reveal: three action icons fade and rise into place under the name, the name lifts slightly and a wide soft shadow grows, ~250 ms.
UV-17 Toast from avatar: a dark pill grows out from behind a circular avatar to the right, then the message text slides in from the left inside it, ~0.8 s.
MP-03 Sliding number: each digit column rolls vertically like an odometer as the value changes; mid-roll shows half digits.
MP-08 Toolbar expandable: a panel grows upward out of a small icon toolbar; switching tools fades content through and changes the panel height.
RB-11 Split text: letters rise about 30 px and fade in, 35 ms apart, line done in ~1 s.
RB-14 Decrypted text: characters scramble into random symbols, then lock in left to right over ~1.4 s.
RB-18 Click spark: eight short lines radiate ~30 px from the click point and fade in 0.5 s.
RB-19 Animated list: rows spring in 70 ms apart; a selection highlight glides row to row on arrow keys in 0.2 s.
RB-20 Stack: front card is dragged and thrown off, tucks under the pile; the next card glides forward.
RB-22 Scroll reveal: words go from blurred and dim to sharp in reading order, tied to scroll position.
