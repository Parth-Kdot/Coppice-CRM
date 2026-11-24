# Coppice

Coppice is a shared sponsor outreach workspace for student clubs whose officers change every year. Each company has one officer holding it, a queue brings it back on its follow-up date, and the history stays with the workspace when the board turns over. The name comes from coppicing, the old forestry practice of cutting a tree back to its stump so new stems grow from the same roots.

## What it does

### The core pipeline

- **Workspaces and roles.** Each club gets its own workspace with Owners and Officers. Sign-in is Google. Coppice never sends email, so an Owner invites an officer by Google address in Settings, and the officer accepts under Your workspaces. Only the addresses listed in `WORKSPACE_CREATOR_EMAILS` can create a workspace.
- **Companies.** Add one by hand (Coppice shows look-alikes, archived ones included, before saving), keep contacts and notes, move a company through its stages (Not contacted, Contacted, Replied, In conversation, Committed, Declined), archive it. Search opens with `/` or Ctrl K from any screen.
- **CSV import.** Bring in last year's spreadsheet. Coppice guesses the columns, lets you fix the mapping, rejects rows it cannot use with a reason, and shows look-alike companies (same name or same website, in the file or already in Coppice) so a person decides what counts as a duplicate.
- **Claims.** Before you reach out to a company, you claim it. Everyone can see who holds it and until when. The claim lapses if nothing is logged within the workspace's claim window (14 days unless an Owner changes it). Two officers pressing Claim at the same moment cannot both win.
- **Queue and board.** The queue shows what is overdue, what is due, what is up for grabs and the companies never contacted, most overdue first. The board shows every company by stage.
- **Logging outreach.** Record the channel, a note, the template used and the next follow-up date. Logging renews your claim and sends the company back to the queue on its date. Mark which entry got the reply.
- **Templates and stats.** The stats page ranks email templates by reply rate with a likely range, and only names a best or worst when the ranges allow it. It can split by industry or by touch.
- **Time Capsule.** A recap of the board year, counted by code from the outreach log. Owners build a handoff for the next board in six steps (who is leaving, relationship cards, review, playbook, re-contact calendar, publish). Officers read it once it is published, and a year switcher keeps older handoffs readable.
- **Getting started.** The first time someone opens a workspace, a short tour points at the real controls. It can be replayed from the account menu.
- **Settings.** Members and invitations, templates, the claim window, the AI switch, approved research pages, the assistants switch, and renaming or deleting the workspace.

### The optional AI features

All of these are off until an Owner switches AI on for the workspace in Settings, and each needs its provider key on the server. Every one proposes and a person decides: nothing changes a company until someone presses a button.

- **Fact sheet.** An Owner uploads the club's sponsorship packet as a PDF. Gemini lists facts, each with its page and exact quote, and code checks every quote against the PDF. Only facts an Owner verifies are used anywhere else.
- **Pitch drafter.** Pick a contact, leave an optional note, and get two email drafts (Gemini) written only from verified facts. Drafts open in your own Gmail, Outlook or mail app.
- **Claim checker.** Every draft is checked by code for numbers no verified fact supports, claims of past history with the company and outside links. An optional Gemini pass reads the draft against the facts too.
- **Smart import.** Reads free-text notes in a sheet ("emailed 3/2 by Sam, said reach out in Aug") and proposes a stage, dates and a contact, each with the text it came from. Groq reads the cells, since they can hold names. Gemini only suggests columns and look-alike company names.
- **Research briefs.** On a company page, "Who to contact" reads only web pages an Owner approved in Settings and lists official ways in (university relations, campus recruiting, giving programs). Every line quotes and links its page. Nothing reaches the company until someone adds a line to its notes.
- **Ask Coppice.** A question in plain English at `/<workspace>/ask`. Groq turns it into a small structured intent and code reads the answer from the workspace. Anything it proposes (claim, release, log, move a stage, set a follow-up date) is a confirm card that calls the same actions as the rest of the app. Four starter chips work without a Groq key.
- **Explain these numbers and the Template Lab.** On the stats page, Gemini puts words around numbers the page already holds, and an Owner can ask for two or three variants of a template that each change one thing and run them as an experiment. Code checks every reply.
- **Time Capsule cards and Ask the Archive.** Groq writes relationship-card bullets and answers questions from the workspace's notes. Each bullet or sentence is kept only if code finds the note's quote behind it.

Each person has a daily limit on drafts (40), briefs (10), Ask Coppice questions (50) and archive questions (30), and each workspace has a monthly call limit that an Owner can change.

### Assistants

Officers and Owners can connect their own AI assistant (any assistant that supports remote MCP servers with OAuth) at `https://<your site>/api/mcp`. The assistant can search companies, read a company with its contacts and history, see the queue and your claims and, if you allow changes, claim, log outreach and move stages as you, under the same claim rules as the app. An Owner turns this on per workspace in Settings (off by default), every new assistant gets a consent page, and each person can disconnect their assistants under Settings, which cuts them off at once. Whatever an assistant reads, including contact names, emails and notes, goes to the company behind that assistant, whether or not Coppice's own AI is on. Removing the connector inside the assistant may not end its access; Disconnect under Settings does.

## Requirements

- Node 24 (the version in `.nvmrc`) and npm 11.
- Docker, for a local Postgres 17.
- A Gemini key and a Groq key are optional. Without them the AI features say they are not set up and stay off, and everything else works.
- A Google OAuth client is optional for local work. See "Signing in locally" below.

## Setup

From a fresh clone to a running app with demo data takes about ten minutes. Run every command from the repository root.

1. Start Postgres. The first line runs the same database that `docker compose up -d db` starts from `docker-compose.yml`. If port 5432 is already taken on your machine, change the first number in `-p 5432:5432` and use the same number in step 2.

   ```bash
   docker run -d --name coppice-db -p 5432:5432 \
     -e POSTGRES_USER=boilerpitch -e POSTGRES_PASSWORD=boilerpitch -e POSTGRES_DB=boilerpitch \
     postgres:17
   ```

   Wait a few seconds until `docker exec coppice-db pg_isready -U boilerpitch` says it is accepting connections.

2. Create your `.env`. The values in `.env.example` already match the database above. Set `BETTER_AUTH_SECRET` to a random value (the command prints one) and leave the Google lines as they are for now.

   ```bash
   cp .env.example .env
   openssl rand -base64 32
   ```

3. Install the exact packages from the lockfile. This also generates the Prisma client.

   ```bash
   npm ci
   ```

   It takes about a minute. Warnings about install scripts are expected and harmless.

4. Apply the migrations and give the app's database role its password.

   ```bash
   npm run db:setup
   ```

5. Load the demo workspace.

   ```bash
   npm run db:seed
   ```

6. Start the app, then open http://localhost:3000.

   ```bash
   npm run dev
   ```

7. Sign in. Follow "Signing in locally", then open http://localhost:3000/demo-riverbend.

### Signing in locally

Coppice signs in with Google and nothing else. The people in the demo workspace are made up (`@example.com`) and cannot sign in with Google. There are two honest ways in.

**Without Google keys.** The server starts with the placeholder Google values in `.env.example`, and the landing page and sign-in page load, but the Google button will not work. You can still open the demo as any made-up person by minting a session for them with the same helper the tests use. The demo people are `demo-user-dana` (the Owner) and `demo-user-marcus`, `demo-user-priya`, `demo-user-jonah` and `demo-user-sofia` (Officers).

```bash
cat > /tmp/coppice-session.mts <<EOF
import { signedInHeaders } from "$PWD/tests/helpers/session";
const headers = await signedInHeaders(process.argv[2]);
console.log(headers.get("set-cookie") ?? headers.get("cookie"));
process.exit(0);
EOF
npx tsx --tsconfig tsconfig.json --env-file=.env /tmp/coppice-session.mts demo-user-dana
```

The command prints a line that starts with `better-auth.session_token=`. In your browser, open http://localhost:3000, then the developer tools, then Application (or Storage) and Cookies. Add a cookie named `better-auth.session_token` whose value is everything after the first `=`, up to the first `;`, and reload. Use a different name from the list to sign in as an Officer in a second browser profile, which is how you see the claim rules between two people. The helper only exists in `tests/`, and it needs the same `BETTER_AUTH_SECRET` as the running app.

**With Google keys.** Create an OAuth client in Google Cloud Console (type Web application) with the redirect URI `http://localhost:3000/api/auth/callback/google`, and put its ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. While the client is in Testing mode, add your Google account as a test user. Sign in once, then add yourself to the demo workspace as an Owner:

```bash
SEED_OWNER_EMAIL=you@gmail.com npm run db:seed
```

Add the same address to `WORKSPACE_CREATOR_EMAILS` if you also want to create your own workspace.

### The demo data

`npm run db:seed` builds "Riverbend Robotics Club (demo)" at `/demo-riverbend`: 40 companies across all six stages with contacts on most, 3 templates (one archived), an Owner and four Officers, about 80 logged touches with notes, replies and stage history, overdue and upcoming follow-ups, 7 live claims and 3 expired ones. Dates are counted back from the database clock, so follow-ups are overdue whenever you run it.

Running it again is safe. It rebuilds only the demo workspace, with the same ids each time, and never touches other workspaces. It refuses to run unless `DATABASE_URL` and `DIRECT_URL` both point at localhost.

### Trying the AI features without keys

Both providers' SDKs read a base URL from the environment, so you can point the app at a local stand-in server while you work: start the dev server with `GOOGLE_GEMINI_BASE_URL` and `GROQ_BASE_URL` set to your stand-in and dummy values for `GEMINI_API_KEY` and `GROQ_API_KEY`, then switch AI on for the workspace in Settings. Tests never call a live provider; they use recorded replies.

## Commands

```bash
npm run dev          # the app on port 3000
npm test             # all tests, against a real Postgres (needs the database from step 1)
npm run lint         # ESLint
npm run typecheck    # generates route types, then runs tsc
npm run build        # a production build (stop npm run dev first; both write .next)
npm run db:setup     # apply migrations and set app_user's password, on a local database only
npm run db:seed      # rebuild the demo workspace, on a local database only
```

`npm test` creates and migrates its own database (`boilerpitch_test`) next to the dev one, so it never wipes the data you are clicking around in. CI (`.github/workflows/ci.yml`) runs `npm ci`, `db:setup`, typecheck, lint and tests against Postgres 17.

## Architecture

Next.js 16 (App Router) and React 19 with TypeScript, Tailwind CSS 4, Prisma 7 with the `pg` driver adapter, Postgres, Better Auth (Google sign-in and the organization plugin), Papa Parse for CSV and unpdf for PDF text. Tests use Vitest. This version of Next.js has breaking changes from older ones, for example `proxy.ts` instead of middleware and async `params`; read the guides in `node_modules/next/dist/docs/` before changing Next code.

### Folders

- `app/`: routes. `app/(app)/[workspaceId]/` holds the signed-in screens (queue, board, companies, import, facts, stats, ask, capsule, settings), most with their server actions in an `actions.ts` next to them (the queue's are in `queue-actions.ts`). `app/(auth)/` is sign-in and the assistant consent pages. `app/api/` is Better Auth and the MCP endpoint.
- `components/ledger/`: the UI primitives and screens (the paper-ledger look). Shared pieces include `Disclosure`, `OverflowMenu`, `ShowMore`, `Segmented`, `ActionForm`, the loading skeleton and the motion kit. `components/importer/` is CSV import. `components/landing/` is the home page.
- `lib/`: everything that is not a screen. `authz.ts` and `db.ts` (tenancy), `claims.ts` (claims, outreach logging, stage moves), `ai/` (the one door to the providers), and one folder per feature (`smart-import/`, `research/`, `copilot/`, `scorecard/`, `template-lab/`, `capsule/`, `mcp/`). `validation.ts` holds the Zod schemas for all input.
- `prisma/`: the schema, the migrations and the demo seed. `scripts/`: local database setup and the build wrapper. `tests/`: Vitest files, with helpers in `tests/helpers/`.
- `proxy.ts`: sends the Content-Security-Policy with a fresh nonce on every page request. Styles come from classes and files, never inline attributes, because the policy forbids them.

### Tenancy

Every workspace is walled off twice. Every server action starts with `requireMembership` or `requireOwner` (`lib/authz.ts`), which checks the signed-in user's membership in the database on every request and gives the same error whether a workspace is missing or just not yours. The action then runs its reads and writes inside `withTenant` (`lib/db.ts`), which opens a transaction and sets the user id and workspace id with `set_config(..., true)`, so they last only until the transaction ends. The app connects as `app_user`, a role that cannot bypass row-level security, and every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY` with policies that only show rows of that workspace to a member. Outside `withTenant` those tables look empty. Slow work such as AI calls and network requests stays outside the transaction.

### How a claim works

Claiming is one conditional `UPDATE` in `lib/claims.ts`. It sets the holder and the new end time only where the company is not archived, is not Committed or Declined, and is either unclaimed, expired, or already yours. The caller then checks whether one row came back. Two people pressing Claim at the same moment both send that statement, Postgres locks the row for the first, and the second re-checks its condition after the first commits and matches nothing, so exactly one wins. It is never a read followed by a write in code, which could let both through. Every comparison uses the database clock (`now()` in SQL, `dbNow` and `dbToday` in code) and never `new Date()` in the app, so a server with a drifting clock cannot extend or shorten anyone's claim. Logging outreach, moving a stage and releasing a claim go through the same file, and a loser gets a message naming who holds the company and until when.

### How AI calls work

Every model call goes through `runAi` (`lib/ai/run.ts`), which refuses when the workspace's switch is off, the server has no key or a limit is used up, logs the call in `AiRun`, and then calls `generate` in `lib/ai/client.ts`, the only file that talks to a provider (a test enforces this). Model output is never trusted: it is checked against the same Zod schema the model was asked to follow and then by code, and text people typed (notes, names, sheets, pages) is wrapped and labeled as data, never instructions. No AI call runs inside a database transaction.

Which provider gets what:

- **Gemini** gets text that is not about your contacts, with emails and phone numbers masked: the fact sheet's PDF text, the drafter and claim checker (verified facts and template text, never contact names), Smart import's column and look-alike suggestions, the stats numbers and template text for Explain these numbers and the Template Lab, and the text of research pages an Owner approved. A name written in a packet, a template or on an approved page can still reach it. For research, code drops every passage that names a person before the brief is written. Each feature has a main model and a fallback.
- **Groq** gets anything that can hold a person's name or contact details, with emails and phone numbers masked: Smart import's free-text cells, Ask Coppice's question (with your last few questions, the company names it just showed you and your industry names), and the Time Capsule's cards and archive answers.

If a change alters what reaches a provider, the privacy wording on the home page (`components/landing/copy.ts`) and in Settings changes in the same commit.

## Migrations

Migrations are additive only: new tables, new columns, new indexes, new enum values. They never drop, rename, change the type of or rewrite existing data. Make one with `npx prisma migrate dev --create-only --name <name>`, edit the SQL by hand, apply it locally with `npx prisma migrate dev`, then run `npx prisma generate`. A new enum value goes in its own migration and is not used in that same migration. A new tenant table needs, in the same migration, grants to `app_user`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and policies shaped like the existing ones, plus cross-workspace tests in `tests/` (see `tests/rls.test.ts`).

Production migrations are run by the owner from his own machine, with `npx prisma migrate deploy` through Supabase's session pooler (port 5432, as `postgres.<project-ref>`), before the change is merged. They are not run by Vercel, and `DIRECT_URL` is never set there.

## Deployment

Coppice runs on Vercel with Supabase as a plain Postgres database (no Supabase Auth, no Data API). Pages are rendered per request, so a build needs the database and auth variables below to be present.

Set these in Vercel (names only):

- `DATABASE_URL`: Supabase's transaction pooler (port 6543) as `app_user.<project-ref>`, with no `sslmode`.
- `DATABASE_CA_CERT`: Supabase's public root certificate as PEM text, so the app verifies the connection.
- `DATABASE_POOL_MAX` (optional): connections one server instance may hold, 1 to 50, default 5.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`: the secret, and the public site address. Assistant tokens are bound to `<BETTER_AUTH_URL>/api/mcp`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- `WORKSPACE_CREATOR_EMAILS`: comma-separated addresses that may create workspaces.
- `GEMINI_API_KEY` and `GROQ_API_KEY` (both optional).

`DIRECT_URL` and `SEED_OWNER_EMAIL` are local only. The `app_user` role is created by the migrations without a password, and its password is set by hand in Supabase. The seed and `db:setup` refuse to run against anything that is not localhost. Preview builds that lack secrets get placeholders from `scripts/build-with-preview-fallbacks.sh`, which let the build finish but cannot sign anyone in.

## Status

The core workflow works end to end: import (with Smart import for messy notes), claims, the queue and board, the fact sheet, drafts, the claim checker, logging outreach, reply rates for each template with the Template Lab, research briefs from approved pages, Ask Coppice, and the Time Capsule with its handoff. Members can connect their own AI assistant. Coppice never sends email, takes payments or shows public sponsor pages.
