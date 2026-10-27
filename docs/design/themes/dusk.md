# Direction 7: Dusk

Branch `design/dusk`, worktree `/home/user/wt/dusk`, port **3107**, visual code under `app/demo/_dusk/`.

## Idea
Calm, dark, and focused: the officer who does outreach at 11 pm after class. Plum night, apricot light, lavender text. The home shows **one company at a time** in a large focus card (with a list toggle for scanning), so each follow-up gets full attention. Navigation is a **floating bottom action bar**, not a sidebar. Motion is soft and slow-feeling but still short. It is the cool-toned, quiet counterpart to Ring Count's warm dark.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| night | #17121F | page |
| surface | #211A2C | cards |
| surface-2 | #2B2338 | raised elements, inputs |
| border | #3B3149 | dividers |
| text | #F1E9F7 | primary text (15.5:1) |
| text-2 | #BDB1CC | secondary (9.0:1 on night, 8.3:1 on surface) |
| apricot | #FFB38A | primary actions (night-colored text on it, 10.6:1), your claims, the sun |
| lavender | #C7A6F0 | links, secondary accent (8.9:1) |
| rose | #FF7A90 | overdue and errors (7.4:1 on night, 6.8:1 on surface), always with text |
| sage | #9AD3A8 | success, committed (9.8:1 on surface) |
Stages are soft rounded labels with a small duotone icon each; never color alone.

## Type
**Figtree** for everything, weights 300 to 800. Large, airy headings (300 and 600 mixed), 15 to 16 px body, tabular numerals.

## Layout and navigation
**Floating bottom action bar** (centered, 64 px tall, rounded 20 px, surface-2 with a soft shadow, 16 px from the bottom): Queue, Board, Search (opens a command sheet), Import, Facts, Settings, then the avatar (user menu with role switcher, Reset demo, "Prototype" tag). The active item gets an apricot dot under it and a lavender pill that **glides** between items (UV-c13 idea, 180 ms). Labels appear on hover or focus; on phones the bar is full width.
Minimal top strip: workspace name, today's date, and a small "x of y due" counter.
**Queue = focus mode**: a centered column (max 720 px). The **focus card** (surface, 24 px radius) shows the most overdue company: name (32 px), why it's due ("Follow-up 9 days overdue"), last outreach note quoted, contact, holder, stage, and big actions: Claim (apricot), Log outreach, Open company, Skip for now. Under it, the **up-next stack**: the next three cards peek out beneath (each offset 10 px down and scaled .96, .92, .88, dimmer). A **List** toggle (top right of the column) switches to a compact list of all due companies plus the "only mine" filter and the never-contacted section; the toggle morphs the card into the list using the View Transitions API (falls back to a crossfade).
Board: six soft columns, horizontally scrollable, each collapsible; cards are small rounded surfaces.
Company page: one column: header, claim card, contacts, the outreach log as a soft timeline, draft panel.
Phone: focus card is full width; swipe-like buttons (no gesture needed) at the bottom of the card.

## Icons
**Soft rounded duotone**: 1.75 px lavender strokes with rounded joins plus one apricot fill spot per icon (for example the sun in a calendar, the flap of an envelope), 22 px.

## Logo
**A setting sun forming a C**: an apricot disc half sunk below a horizon line, with the visible arc drawn as a thick open C (the gap on the right), and a thin lavender horizon line. Wordmark "coppice" in Figtree 600 lowercase.

## Landing page: signature move is **dusk falling as you scroll, while a card stack triages itself**
Inspirations (viewed as frame sequences): 60F-06 Revolut plan tabs (the whole background tint cross-fades between states), 60F-05 Trackables (a card morphs to full screen keeping its color, then content fades in), 60F-01 Clear (an item is checked and sinks out while the rest close the gap), 60F-18 Antimetal (soft blur-in of the headline), 60F-11 Remy (two glowing eyes blink and rise before a list appears), LF-16 sapling (slow growth then withdrawal), UV-c13 glider tabs. Plus React Bits stack, aurora and blur text references in the notes.
1. **Hero**: a layered **dusk sky** built from stacked CSS gradient bands and two SVG hill silhouettes; the apricot sun sits above the horizon. On load the headline "New board, same roots." blurs in word by word (blur 12 px to 0, 700 ms, 120 ms stagger) and the subhead fades after. As the user scrolls the first 120 vh, the **sun sinks** behind the horizon (translateY), the sky shifts from apricot-lilac to deep plum (crossfading gradient layers, 60F-06 idea), and stars fade in one by one (small dots, staggered). Parallax: hills move at .3 and .6 of scroll speed. All transform and opacity; disable parallax with reduced motion.
2. **The problem**: five "11 pm notifications" (rounded cards) arrive one by one from the bottom like phone notifications, each describing a spreadsheet failure; then they dim and slide away as the Coppice fix fades in on the right.
3. **One at a time** (centerpiece; pinned about 300 vh): the **card stack** sits center. As the user scrolls, the top card is triaged: Claim (button glows apricot, the holder line updates), Log outreach (a small form slides up inside the card, fills, closes), then the card **slides out to the left and fades** (60F-01 sink-out, rotated -3 degrees) while the next card **rises from the stack** (scale .96 to 1, translateY 10 px to 0, a soft spring). Captions on the left explain each beat. Three cards are processed; the last one shows "All caught up" with a crescent moon.
4. **How it works**: five steps on a horizon line, each a small glowing dot that lights as it enters view; the explanation text cross-fades.
5. **Maya and Dev**: two focus cards side by side on phones. Maya taps Claim first: her card's border glows apricot and a soft ripple spreads from her tap. Dev's card, a beat later, dims gently, does a 2 degree tilt and back, and shows "Held by Maya until Nov 11" in lavender.
6. **Features**: rounded cards that float slightly up (4 px) on hover with a soft lavender border glow.
7. **Name story**: a slow night scene: a coppiced stump silhouette on the horizon with new shoots, which grow once as the section enters view (the LF-16 rhythm but only the growth half, 2 s).
8. **Get started and FAQ**: calm accordions; answers fade in.
9. **Final CTA**: a thin crescent rises (the next morning), the sky lightens a little behind "Start a workspace". 

## In-app motion
Focus card done (claim plus log, or skip): the card slides out left (x -24 px, opacity 0, rotate -2 degrees, 220 ms ease-out) and the next card rises from the stack (scale .96 to 1, y 10 px to 0, 260 ms with `cubic-bezier(.2,.9,.3,1.15)`); the stack behind shifts up one slot. Press feedback: a **soft ripple** from the pointer position (a circle scaling from 0 to the button size at 20% opacity, 350 ms) on primary buttons. Claim success: the card border and claim button glow apricot (box-shadow fade-in 300 ms, fades to a resting subtle glow). Claim refused: the card does a 2 degree tilt and back (200 ms), then the holder's avatar appears at the card's top edge and a surface-2 pill **grows out from behind the avatar** with "Held by Maya until Nov 11" sliding in inside it (UV-17 toast-from-avatar, compressed to 400 ms). Action bar: the lavender pill glides between items (180 ms). List toggle: View Transitions morph (250 ms). **Toasts**: blur in from the bottom above the action bar (blur 8 px to 0 plus 8 px rise, 220 ms), hold 3 s, fade. AI draft loading: a soft apricot glow breathes in the draft box (opacity .4 to .8, 1.2 s, only while waiting). Numbers crossfade.

## Screen notes
Sign-in: the hero sky at night with a centered surface card and "Continue with Google". Workspaces: three large rounded cards with a tiny horizon illustration each. Import: steps as a horizontal sequence of soft cards; duplicate groups side by side with "Same company?" and Skip or Import. Facts: a calm list with page and quote, verify is a round toggle that fills sage. Settings: grouped soft cards; claim window as a slider with the number shown.

## Don'ts
No pure black, no neon, no harsh borders, no sidebar, no fast flashing, no light theme in this direction.

## Additional references (component libraries, viewed)
The landing card stack follows RB-20 stack (the front card leaves and tucks away, the next card glides forward), driven by scroll instead of drag. **Log outreach** in the app opens as a panel that **grows upward out of the bottom action bar** (MP-08 toolbar expandable: height and width animate from the bar to the panel in 200 ms, content fades in after 80 ms; switching to another tool panel fades content through and animates height). After the sun sets on the landing, a very faint lilac and apricot **aurora** curtain drifts slowly across the top of the night sky (RB-15 aurora idea, canvas or CSS gradient layers, low opacity, landing only, paused off-screen).
