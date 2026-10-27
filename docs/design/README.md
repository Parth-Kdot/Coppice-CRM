# Design exploration

Coppice (the team outreach CRM that is being renamed from BoilerPitch) is getting a new look. Eight design branches each build a clickable prototype of the same nine screens, so the designs can be compared side by side before one is chosen. This folder explains the setup. The functional contract every design must keep is in [SCREENS.md](./SCREENS.md).

A prototype is a set of pages that run on mock data. There is no database, no sign-in and no network call. Every button works, but only against in-memory state that starts the same for everyone and resets on a page reload.

## Route map

Every design branch builds these URLs, and only these. Build links with `demoRoutes` from `demo/routes.ts`, never by hand, so the eight prototypes stay interchangeable.

| Prototype URL | Screen | Real app URL | Section of SCREENS.md |
| --- | --- | --- | --- |
| `/` | Landing page (each design branch replaces `app/page.tsx`) | `/` redirects to the workspace list | none |
| `/demo/signin` | Sign-in | `/signin` | 2 |
| `/demo/workspaces` | Workspace list | `/workspaces` | 3 |
| `/demo/w/[ws]` | Queue (workspace home) | `/[workspaceId]` | 4 |
| `/demo/w/[ws]/board` | Board | `/[workspaceId]/board` | 5 |
| `/demo/w/[ws]/companies/[companyId]` | Company page | `/[workspaceId]/companies/[companyId]` | 6 |
| `/demo/w/[ws]/companies/new` | New company | `/[workspaceId]/companies/new` | 7 |
| `/demo/w/[ws]/import` | Import | `/[workspaceId]/import` | 8 |
| `/demo/w/[ws]/facts` | Fact sheet | `/[workspaceId]/facts` | 9 |
| `/demo/w/[ws]/settings` | Settings | `/[workspaceId]/settings` | 10 |

`[ws]` is a workspace id from the mock data. A workspace the person does not belong to, and a company that does not exist in it, should render a plain 404 (`notFound()`), as the real app does.

The three workspaces the signed-in person belongs to:

| Id | Name | Kind | The person is | AI | Companies |
| --- | --- | --- | --- | --- | --- |
| `boiler-robotics` | Boilermaker Robotics Club | Purdue student org | Officer | on | 44, across all six stages |
| `tartan-build` | Tartan Build Weekend | Hackathon at another school | Owner | off | 6 |
| `calumet-alumni` | Calumet Scholars Alumni Board | Nonprofit alumni board | Officer | on | 5 |

A fourth, `boiler-formula` (Boilermaker Formula Racing), is not joined yet: an invitation to it waits on the workspace list, and pressing Join adds it.

## What lives where

```
app/demo/layout.tsx      wraps /demo in the shared state; no markup of its own
demo/                    shared mock data and logic. No visuals anywhere in it.
docs/design/             these docs
```

`demo/` holds data and behavior only. A design branch adds its pages under `app/demo/` and its components wherever it likes, and imports from `demo/` through the `@/demo/...` alias. Nothing in `demo/` should be edited by a design branch; if something is missing or wrong, change it on the shared branch so all eight designs get the fix.

| File | What it is |
| --- | --- |
| `routes.ts` | `demoRoutes` URL helpers, the queue and board filters that live in the URL, `WORKSPACE_NAV`, `matchDemoRoute` |
| `store.tsx` | The provider and every hook a screen uses (client code) |
| `store-core.ts` | The store without React, and the list of every action (`DemoActions`) |
| `use-csv-import.ts` | The whole CSV import flow as one hook |
| `selectors.ts` | One read-only view of the state per screen |
| `engine-claims.ts` | Claim, release, force release, log outreach, move stage |
| `engine-companies.ts` | Create and edit companies, duplicates, archive, contacts |
| `engine-import.ts` | Previews and runs a CSV import |
| `engine-facts.ts` | Verify, edit, add, delete facts; read an uploaded packet |
| `engine-ai.ts` | Simulated drafts and Claim Checker, with the real AI gates and messages |
| `engine-settings.ts` | Workspaces, members, invitations, claim window, AI switch, demo tools |
| `engine-core.ts` | Shared plumbing for the engine files |
| `rules.ts` | Pure rules, including the real app's own claim rules, duplicate keys and mail links |
| `csv.ts`, `sample-csv.ts` | The CSV parser and checks, and a deliberately messy sample sheet |
| `validation.ts` | The real app's input rules and messages, without server-only imports |
| `dates.ts`, `clock.ts` | Date helpers that print the same text on the server and in the browser; the fixed "now" |
| `types.ts` | The shapes and labels, mirroring `prisma/schema.prisma` |
| `data.ts`, `seed-main.ts`, `seed-others.ts`, `seed-helpers.ts` | The mock data |

The engine reuses the real app's pure code where it has no database or server-only imports: `lib/claim-rules.ts`, `lib/compose-links.ts`, `lib/placeholders.ts` and `lib/duplicates.ts` (through `rules.ts`). Nothing in `lib/`, `prisma/`, `proxy.ts` or the real routes is touched by the prototypes.

## Using the data in a screen

The provider is already in place for everything under `/demo`. A screen is a client component that reads with a hook and acts with a function:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { demoRoutes } from "@/demo/routes";
import { useDemoActions, useQueue, useQueueFilters } from "@/demo/store";

export function QueueScreen({ ws }: { ws: string }) {
  const filters = useQueueFilters();            // from the URL: ?mine=1&never=1&all=due
  const queue = useQueue(ws, filters);
  const { claimCompany } = useDemoActions();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ul>
        {queue.due.map((row) => (
          <li key={row.company.id}>
            <Link href={demoRoutes.company(ws, row.company.id)}>{row.company.name}</Link>
            <span>{row.timing}</span>
            <span>{row.claim.label}</span>
            {row.action === "claim" && (
              <button
                onClick={() => {
                  const result = claimCompany(ws, row.company.id);
                  setError(result.ok ? null : result.error);
                }}
              >
                Claim
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

Every action returns `{ ok: true, data }` or `{ ok: false, error }`, the same shape as the real server actions. Show `error` where the person clicked; the messages are the real app's wording. The actions that wait (`draftEmail`, `checkDraft`, `uploadFactSheet`) return a promise and mark the work in progress in `state.busy`.

Hooks, one per screen:

| Hook | Gives |
| --- | --- |
| `useWorkspaceList()` | Workspace cards, invitations, `canCreate`, `nothingHere` |
| `useMe(ws)`, `useIsMember(ws)` | The person and their role in a workspace |
| `useQueue(ws, filters)`, `useQueueFilters()` | Due and never-contacted rows with claim badges and timing |
| `useBoard(ws, filters)`, `useBoardFilters()` | Six columns, duplicate pairs, archived list, industries |
| `useCompany(ws, id)` | Everything on the company page, and which controls apply |
| `useReplyChoice(ws, id, stage)` | Whether a stage move should ask which outreach got the reply |
| `useCompanySearch(ws, query)` | Ranked search over names, industries, websites, contacts, notes |
| `useFactSheet(ws)` | Files, unverified and verified facts with quote checks |
| `useSettings(ws)` | Members, invitations, claim window, AI usage |
| `useTemplateStats(ws)` | Sent, replies and reply rate per template (for the future stats screen) |
| `useWorkspaceStats(ws)`, `useActivity(ws)` | Counts and a feed, for headers and teasers |
| `useCsvImport(ws)` | The whole import flow |
| `useDemoState()`, `useDemoActions()` | The raw state and every action |

For the claim check and mail links on a draft, import `checkRules` and `composeLinks` from `@/demo/rules`. They are the real app's functions and run on every keystroke.

### Reviewer tools

Each prototype should carry a small "demo tools" control, out of the way, with: a **View as** switch (Owner or Officer) through `setRole`, **Reset** through `resetDemo`, and ideally **Skip a week** through `advanceClock(7)` so claims expire. `setFlags` reaches the AI-not-set-up notice, the no-workspace state and a one-time "AI is busy" error. The full list is in section 13 of SCREENS.md.

### Where to find each state in the mock data

All dates are relative to Wednesday Oct 28, 2026, 3:00 PM (West Lafayette). The person is Jordan Ellis.

| To show | Look at (workspace `boiler-robotics` unless noted) |
| --- | --- |
| Claimed by me, with time left | NVIDIA (13 days), Microsoft (expires Oct 30), Corteva, Intel, Ford, Rolls-Royce |
| Claimed by someone else | Boeing (Wei Chen), Elanco (Marcus Webb), Collins Aerospace (Aaliyah Brooks), Eli Lilly (Priya Raghunathan) |
| Claim expiring tomorrow | Cummins Inc., held by Aaliyah Brooks, until Oct 29, 11:00 AM |
| Expired claim | Allison Transmission, Wei Chen's claim |
| Free and overdue | Toyota Motor Manufacturing Indiana (30 days), Siemens (23), Roche Diagnostics (18), John Deere (15) |
| Due today | Lockheed Martin (held by Priya Raghunathan) |
| Never contacted | Rockwell Automation, Texas Instruments, Zimmer Biomet, and others |
| Likely duplicates | Eli Lilly and Lilly (same website), Rolls-Royce and Rolls Royce Corporation (same name) |
| An archived company | Anthem, Inc. and Hill-Rom |
| Committed and Declined | General Motors, Deloitte, NiSource, Accenture; JPMorgan Chase, Meta, UPS |
| A draft already waiting | NVIDIA and Microsoft |
| Verified, unverified and stale facts | Fact sheet of `boiler-robotics`; stale are the 2011 and 2025 facts; Bronze has a quote mismatch |
| AI switched off | `tartan-build` |
| Owner view with a second owner | `tartan-build`, or switch `boiler-robotics` with `setRole("owner", "boiler-robotics")` |
| Someone who has left | Kenji Watanabe is no longer a member of `boiler-robotics` but his name stays on older outreach and stage changes |
| Import with problems and duplicates | `SAMPLE_CSV` against `boiler-robotics`: 17 rows, 4 with problems, 2 duplicate groups |
| A pending invitation for me | Boilermaker Formula Racing on the workspace list |

## Run it locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/demo/workspaces>. The prototype pages need no environment file, no database and no API keys: they never import the real app's database or sign-in code, and the dev server compiles a route only when it is visited.

To check a design before pushing:

```bash
npm run typecheck
npm run lint
```

`npm run build` runs the real app's routes too. Those routes read `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` while the build collects page data, and the build stops with "DATABASE_URL is not set" when they are missing (`lib/db.ts` line 19, then `lib/auth.ts` lines 26, 66 and 67). Any non-empty placeholder values satisfy it, and nothing connects to anything:

```bash
DATABASE_URL=postgres://u:p@localhost:5432/d \
BETTER_AUTH_SECRET=placeholderplaceholderplaceholder12 \
GOOGLE_CLIENT_ID=placeholder GOOGLE_CLIENT_SECRET=placeholder \
npm run build
```

Vercel previews need the same four values set for the Preview environment, or the preview build fails.

## Rules and cautions for prototype builders

### Do and do not touch

- Do not change `lib/`, `prisma/`, `proxy.ts` or any existing route in `app/(app)`, `app/(auth)` or `app/api`. The prototypes live in `app/demo/` and your own components.
- Do replace `app/page.tsx` with the landing page for your design. The prototype's other pages sit under `/demo`.
- Do not import `@/lib/db`, `@/lib/auth`, `@/lib/authz`, `@/generated/prisma/...`, or anything that does, in prototype code. They throw without environment variables and pull server code into the browser. Import from `@/demo/...` instead.

### The security headers apply to `/demo`

`proxy.ts` sends a Content-Security-Policy on every page request, `/demo` included, with a fresh nonce each time. In production (which includes Vercel previews) it means:

- **No inline `style` attributes in server-rendered HTML.** `style-src` allows only files and the nonce, so `<div style="width: 40%">` in the server's HTML is ignored by the browser. React's client-side `style={{ ... }}` goes through the browser's style API and works, but anything rendered on the server does not. This catches animation libraries that write starting styles into the server's HTML (Motion's `initial` prop, for example) and any CSS variable set through `style`. Use Tailwind classes, CSS files, or set the style after mount. The development server allows inline styles, so this only shows up in a production build.
- **No inline `<script>` or `<style>` elements** without the nonce. Next.js adds the nonce to its own scripts; a hand-written tag does not get one.
- **Images, fonts and connections must come from this site.** `img-src` is `'self' blob: data:`, `font-src` is `'self'`, `connect-src` is `'self'`. Use `next/font` (it self-hosts Google Fonts), put images in `public/`, and do not load anything from a CDN. A Web Worker created from a `blob:` URL is blocked, because worker scripts follow `script-src`, which does not allow `blob:`.
- **No framing.** `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **Permissions-Policy** switches off camera, microphone, geolocation, payment and USB.

### Every page is rendered per request

`app/layout.tsx` calls `await connection()` so each request gets its own nonce, which makes every page dynamic. That is why prototype pages show as "server-rendered on demand" in the build output. Do not add `export const dynamic = "force-static"` or expect static generation. The shared store is created when the page loads in the browser and when it renders on the server, and both start from the same state.

### The server and the browser must print the same text

The mock state is fixed at one "now" so hydration never disagrees. To keep it that way in prototype code: never call `Date.now()` or `new Date()` to get the current time, never call `toLocaleString`, `toLocaleDateString` or `Intl` formatters on dates, and never use `Math.random()` while rendering. Use the helpers in `demo/dates.ts` (`formatDay`, `formatWhen`, `overdueLabel`, `dueLabel`, `relativeDay`) and the labels the selectors already return. A server rendered in a different time zone still prints the same text; this was checked with the server's time zone set to UTC, Los Angeles and Tokyo.

### State

- State lives in the browser's memory. Moving between `/demo` pages keeps it; a full reload resets it. Do not use `localStorage` for mock data.
- Actions are plain functions you call from an event handler, not form actions. Wire them to `onClick` and `onSubmit`, and show `result.error` next to the control.
- If a screen needs something the hooks do not provide, add a selector to `demo/selectors.ts` on the shared branch rather than reading the raw state with ad hoc code.

### Previews and branches

`vercel.json` turns off deployments for branches that start with `feature/` or `fix/`. Name a design branch with any other prefix if it should get a Vercel preview.

### Animation libraries

Installed and pinned to exact versions for all designs, so the eight prototypes can be compared on the same footing. Use what the design needs; none is required.

| Package | Version | Typical use |
| --- | --- | --- |
| `gsap` | 3.15.0 | Timelines, scroll-driven sequences |
| `motion` | 14.1.0 | Component and layout animation for React |
| `lenis` | 1.3.26 | Smooth scrolling |
| `@number-flow/react` | 0.6.2 | Animated number changes (counts, rates) |
| `ogl` | 1.0.11 | Lightweight WebGL for hero and background effects |

Respect `prefers-reduced-motion` in every design. The real screens are used daily for routine work, so motion must never slow a click down.
