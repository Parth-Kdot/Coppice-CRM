# Direction 8: The Record

Branch `design/the-record`, worktree `/home/user/wt/the-record`, port **3108**, visual code under `app/demo/_record/`.

## Idea
Editorial. Coppice published as the team's daily paper. A masthead with a dateline sits on top of every screen, the queue is **today's edition** (the most overdue company is the lead story, the rest a dense table set like market listings), company pages are **profiles**, settings is the **staff box**, import is the **wire desk**, facts is the **fact desk**. Cool newsprint gray, pure black, one red. It is also the natural home for the future Turnover Time Capsule as a year-in-review issue. It must stay clearly apart from Ledger: no warm cream, no green, no book serif, and overdue is flagged with type weight ("STOP PRESS") as much as with red.

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| newsprint | #F2F1EC | page |
| newsprint-2 | #E7E6E0 | boxes, table stripes |
| ink | #0B0B0B | text and rules (17.4:1) |
| ink-2 | #4A4A48 | secondary text, captions (7.9:1, 7.1:1 on newsprint-2) |
| rule | #0B0B0B | 1 px column rules, 3 px and double rules under the masthead |
| red | #C8102E | the single spot color: masthead accents, kickers like "STOP PRESS" and "OVERDUE", links on hover (5.2:1) |
| halftone | #9A9A96 | decorative halftone dots only |
Stages read as **section kickers** in small caps: NOT CONTACTED, CONTACTED, REPLIED, IN TALKS, COMMITTED, DECLINED, with a small solid dingbat each (a different shape per stage: square, circle, triangle, diamond, star, cross).

## Type
Headlines and masthead: **Playfair Display** (700 to 900, italics for the masthead and pull quotes). Body, UI and tables: **Libre Franklin** (400 to 700), with tabular numerals, small caps for kickers and bylines. Newspaper rhythm: big headline sizes (40 to 72 px) on the edition page, tight line-height, column widths of 45 to 70 characters for prose.

## Layout and navigation
**Masthead** on every in-app page (compact, 96 px): a thin top line with the dateline in small caps ("WEDNESDAY, OCTOBER 28, 2026 · PURDUE ROBOTICS CLUB EDITION · VOL. 3, NO. 214"), the wordmark centered in Playfair black italic, and a double rule beneath. Under it the **section nav** in small caps separated by thin vertical rules: TODAY'S EDITION (queue), THE BOARD, WIRE DESK (import), FACT DESK, THE OFFICE (settings); search on the right as "Search the archive"; the user menu (role switcher, Reset demo, "Prototype" note in small caps) at the far right.
Content uses a **12-column newspaper grid** with 1 px column rules.
**Today's Edition (queue)**: the **lead story** spans 8 columns: a red kicker ("STOP PRESS · 21 DAYS OVERDUE"), a big Playfair headline ("Caterpillar is still waiting on our follow-up"), a standfirst with the last note, the byline ("Held by Maya Chen until Nov 11", or "Unclaimed" with a Claim button), and actions as text-buttons in small caps with underline. The right 4 columns hold two **secondary stories** (next most overdue) with smaller headlines. Below a rule: **"Also due today"**, a dense table styled like market listings (company, days overdue in tabular figures, holder initials, stage dingbat, actions), 32 px rows with zebra newsprint-2 stripes. Then a "Never contacted" listing in small type. The only-mine filter sits as a small-caps toggle above the table ("Show my stories only").
**Company page = profile**: headline (company name), standfirst (industry, website, stage), a **sidebar fact box** (bordered: claim status and the claim button, contacts, next follow-up), the body as the **correspondence log** (each outreach a dated paragraph with a bold lead-in), a **pull quote** from the latest note, and the AI draft as "Draft letter to the editor" with flagged claims underlined in red with a footnote marker.
**The Board**: six newspaper columns with column rules and section kickers as headers; companies as short items (headline-sized name, one line of detail).
Phone: masthead shrinks to the wordmark plus a "Sections" menu; the edition stacks lead story, secondary stories, then the table as two-line rows.

## Icons
**Solid black dingbats and glyphs**: sharp, filled, geometric shapes in the spirit of printer's ornaments and newspaper section icons (a pointing hand for "go", a small star, a filled square, a printer's fleuron for dividers). 18 px, no strokes. Drawn as inline SVG.

## Logo
A **printer's mark**: a circle with a vertical line and a crossbar rising from it (the classic orb-and-cross printer's mark), with a small C set in the lower half of the circle; black, with an optional red dot. Next to it, the wordmark "Coppice" in Playfair Display black italic. In the masthead, use the wordmark centered with the mark small on either side like newspaper ears.

## Landing page: signature move is **typesetting and a press run that prints the front page**
Inspirations (viewed as frame sequences): 60F-19 Evervault (a card passes through a glowing beam and the part past the beam turns into a dot pattern), 60F-15 Threads splash (the wordmark breaks apart, then the feed fades in with placeholder bars filling with content), 60F-20 ui.sh (text types and deletes with a block cursor), 60F-11 Remy (checks land row by row), 60F-17 Dub slide-to-compare. Plus React Bits split text and decrypted text references in the notes.
1. **Hero (the front page)**: the landing itself is laid out as a broadsheet front page. On load the masthead **typesets**: each letter of "COPPICE" drops into its slot from 12 px above with a hard stop (60 ms per letter, 30 ms stagger), then the dateline types in small caps. Then a **press roller** (a dark horizontal band with a subtle cylinder gradient) sweeps down the page over 1.4 s; above the roller the page is blank newsprint with gray placeholder bars, below it the real content appears **printed**: headlines, columns and a large **halftone illustration** of coppiced trees (rendered as a dot pattern on canvas or SVG circles) that resolves from coarse dots to fine (adapted from 60F-19 beam to dots, and 60F-15 placeholders filling). Lead headline "New board, same roots." with the standfirst and the "Start a workspace" CTA as a boxed coupon.
2. **"Five ways the spreadsheet failed" as a CORRECTIONS column**: each failure set as a correction notice; as each scrolls in, the wrong phrase gets a **red strikethrough** and a red handwritten-style correction appears above it (stroke draw 400 ms), with the Coppice fix in the body.
3. **How it works** as a **five-panel strip** (like a comic strip or illustrated explainer) across the page, panels revealing left to right with a column wipe (clip-path inset 0 100% 0 0 to 0, 350 ms each, 120 ms stagger) as they enter view.
4. **Maya and Dev** as a **news story with a STOP PRESS box**: headline "Kestrel claim goes to Maya by two seconds"; the body tells the beats; a red-bordered STOP PRESS box updates live as the user scrolls: timestamps type in (60F-20 typing rhythm) "10:02:14 Maya claims Kestrel Aerospace", "10:02:16 Dev's claim refused: held by Maya until Nov 11", "Nov 4 follow-up returns to the queue".
5. **Features** as a page of short news items with dingbat bullets and small headlines; hovering a headline underlines it in red.
6. **Who it's for** as classified ads (four small boxed ads: "WANTED: hackathon teams…").
7. **Name story** as "FROM THE ARCHIVES": a halftone woodcut-style illustration of a coppiced wood with a caption, explaining coppicing and "KOP-iss".
8. **Trust and boundaries** as an **editorial** ("Our standards"), set in two columns with a drop cap.
9. **Get started** as a boxed coupon ("Clip and start") with a dashed cut line and scissors glyph; **FAQ** as "Letters to the editor" (question as the letter, answer as the editor's reply in italics).
10. **Final CTA**: "Tomorrow's edition is yours" with the coupon button; the footer as the paper's colophon.

## In-app motion
Page change: a **column wipe** reveals the new page (clip-path from the left, 200 ms) after a 60 ms fade of the old one. Lead story changes (after you log or claim): the old headline slides up and fades while the new one slides in from below with a per-word 20 ms stagger (240 ms total). Claim success: the byline **types** itself ("Held by you until Nov 11", 12 ms per character, max 300 ms) with a red caret that disappears after. Claim refused: a small red STOP PRESS box slides down under the byline (180 ms) with holder and expiry. Log outreach: the new correspondence paragraph inserts with a height expand (180 ms) and its date in red for 2 s, then black. Fact verified: a red check mark draws in the margin (200 ms). **Toasts**: a **bulletin bar** that slides down under the masthead like a news ticker line (180 ms), holds 3 s. AI draft loading: placeholder text bars fill left to right like type being set, row by row (only while waiting). No other motion.

## Screen notes
Sign-in: a single front page with the masthead and a boxed "Subscriber sign-in" with the Google button. Workspaces: "Editions": each workspace as a small front page thumbnail with its name as the masthead and counts as headlines. Import (Wire desk): incoming rows as wire copy in Libre Franklin mono-like settings (use tabular figures), mapping as a two-column form, duplicate groups as "Possibly the same story" boxes with Skip or Run both. Facts (Fact desk): each fact as a quoted line with page reference; verified ones carry a red check in the margin and "VERIFIED" in small caps. The Office (settings): the **staff box** (members listed like a newspaper masthead: "Owner, Sponsorship Chair: Priya Shah"), invite link, claim window, AI switch, transfer ownership.

## Don'ts
No warm cream, no green, no rounded corners over 2 px, no drop shadows, no more than one accent color, no italics for body text, no headlines below 18 px.

## Additional references (component libraries, viewed)
The masthead typesetting adapts RB-11 split text but inverted: letters **drop into place from above** with a hard stop instead of rising, 30 ms apart. Section headlines on the landing use the same split as they enter view, 20 ms apart.
