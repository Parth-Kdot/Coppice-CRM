# Coppice

A shared sponsor outreach workspace for student clubs whose officers change every year.

Most clubs run sponsor outreach out of one shared spreadsheet. Two officers email the same company because nobody updated the owner column, follow-ups slip, and when seniors graduate their notes leave with them. Coppice keeps that work in one place: each company has one officer holding it, a queue brings it back on the follow-up date, and the history stays with the workspace after the board turns over.

The name comes from coppicing, the old forestry practice of cutting a tree back to its stump so new stems grow from the same roots.

## What it does

**Workspaces and roles.** Sign in with Google. Each club gets its own workspace with Owners and Officers, and new officers join by invitation.

**CSV import.** Bring in last year's spreadsheet. Coppice guesses the columns, lets you fix the mapping, rejects rows it can't use with a reason, and flags look-alike companies (same name or same website) so a person decides what counts as a duplicate.

**Claims.** Before you reach out to a company, you claim it. Everyone can see who holds it and until when, and the claim lapses if nothing is logged. Two officers clicking Claim at the same moment can't both win.

**Queue and board.** The queue shows what is overdue, due this week and never contacted. The board shows every company by stage.

**Fact sheet.** An Owner uploads the club's sponsorship packet as a PDF. The AI pulls out facts, each with its page and exact quote, and code checks every quote against the PDF. Only facts an Owner verifies are used anywhere else.

**Pitch drafter.** Pick a contact, leave an optional note, and get two email drafts written only from verified facts.

**Claim checker.** Every draft is checked for numbers no verified fact supports, claims of past history with the company and outside links. An optional AI pass reads the draft against the verified facts too.

**Research briefs.** On a company page, "Who to contact" asks for a short brief on the company's official ways in: university relations, campus recruiting, giving programs. It reads only web pages an Owner approved in Settings, every line quotes the page it came from and links to it, and nothing reaches the company until someone adds a specific line to its notes. AI must be on for the workspace, and each person can ask for 10 briefs a day.

**Ask Coppice.** A member types a question in plain English ("who's overdue in tech?", "what should I do in the next 30 minutes?", "how do claims work?") at `/<workspace>/ask`. One Groq call turns the question into a small structured intent; the model never sees companies, notes, contacts or outreach history, and never calls tools. Code checks the intent and reads the answer from the workspace: filter chips you can take off (no AI call), rows with a next-move chip, a company card, a plan, a template stats summary, or sections of the built-in Coppice guide. Anything it proposes (claim, release, log, move a stage, set a follow-up date) is a confirm card that calls the same server actions the rest of the app uses, so the claim rules apply. Conversations are private to each person and kept for 30 days. AI must be on for the workspace, and each person can ask 50 questions a day. The four starter chips work without a Groq key.

**Template stats, Explain these numbers and the Template Lab.** The stats page ranks templates by reply rate with a likely range, and only names a best or worst when the ranges allow it. "Explain these numbers" asks Gemini to put words around the numbers the page already holds: code builds the list of facts, and a reply that writes a digit, uses an unknown fact or holds a contact detail is refused, and a sentence that writes a number as a word, ranks a template in its own words or holds a link is left out, with a quiet line saying how many. The explanation is stored with the facts it was written about, so the numbers on screen are chips drawn from stored facts, and a quiet line says when today's numbers have changed since. It runs only when its button is pressed and counts as one AI call. Owners can also open a template's ⋯ menu and choose "Try a variant": Gemini proposes two or three versions that each change one thing, code checks the placeholders, the numbers and that exactly one place changed, and the owner starts an experiment with one or two of them. One experiment runs at a time; its templates can't be edited or archived, the log form and the drafter suggest the arm with the fewest sends, the stats page shows the arms side by side with a verdict decided in code, and ending it keeps the arm the owner picks and archives the rest. Gemini receives template text, verified facts and the stats numbers for these two features, never notes or contact names.

**Getting started.** The first time someone opens a workspace, a short basics tour points at the real controls: the queue, claiming, logging a follow-up, the board, adding companies and search (and, for Owners, inviting officers). An optional AI tour covers the fact sheet, Smart import, the drafter and checker, research briefs, Ask Coppice, Explain these numbers and AI assistants. Either can be replayed from the account menu.

**Sending and logging.** Coppice never sends email. Drafts open in your own Gmail, Outlook or mail app. Logging the outreach renews your claim and sets the next follow-up.

**AI assistants (MCP).** Officers and owners can connect their own AI assistant (any assistant that supports remote MCP servers with OAuth) at `https://<your site>/api/mcp`. The assistant can list workspaces, search companies, read a company with its contacts and history, see the follow-up queue and your claims, and, if you allow changes, claim, log outreach and move stages as you, under the same claim rules as the app. Each owner turns it on per workspace in Settings (off by default). Sign-in is Google, and every new assistant gets a consent page that names it and what it asks for. Whatever an assistant reads, including contact names, emails and notes, goes to the company behind it. Its changes are marked "via assistant" in the history. Removing the connector in the assistant may not end its access; to end it, each person disconnects that assistant under Settings > AI assistants > Your connected assistants, which cuts it off at once (its next call is refused, in every workspace) and deletes its sign-in. Only the person who connected an assistant sees or disconnects it. Turning assistants off blocks every assistant in that workspace while it stays off, and turning it back on lets back in every assistant members already allowed. Removing a member blocks their assistant while they are out of the workspace.

## Stack

Next.js 16 (App Router) and React 19 with TypeScript, Tailwind CSS 4, Prisma 7 with the pg driver adapter, Postgres on Supabase, Better Auth with Google sign-in and the organization plugin, Gemini for the AI features (and Groq for Smart import's free-text cells and for Ask Coppice), Papa Parse for CSV and unpdf for PDF text. Hosted on Vercel. Tests run on Vitest against a real Postgres.

## Security

Every workspace is walled off with Postgres row-level security. The app connects as a role that cannot bypass it, and each request sets the signed-in user and workspace for its own transaction. Pages are served with a strict Content Security Policy: only scripts carrying a per-request nonce may run, and nothing may be evaluated at run time. Contact emails in uploaded PDFs are masked before the AI sees them.

## Running it locally

You need Node 24 and Docker.

```bash
npm install
cp .env.example .env          # then fill in the values, see below
docker compose up -d db
npm run db:setup              # applies migrations and sets up the app_user role
npm run dev
```

The app runs at http://localhost:3000.

`.env.example` explains every variable. In short: `DATABASE_URL` and `DIRECT_URL` point at the local Postgres, `BETTER_AUTH_SECRET` comes from `openssl rand -base64 32`, the Google client ID and secret come from a Google Cloud OAuth client, and `WORKSPACE_CREATOR_EMAILS` lists who may create workspaces. `GEMINI_API_KEY` is optional; without it the AI features say so and stay off. `GROQ_API_KEY` is optional too; without it Smart import and typed questions in Ask Coppice say so; the normal CSV import and the Ask Coppice starter chips work as usual.

## Demo data

`npm run db:seed` (or `npx prisma db seed`) fills your local database with a demo workspace, "Riverbend Robotics Club (demo)", so the board, queue and claims have something to show. Everything in it is made up: the companies, people and websites (all `*.example.com`) do not exist.

It creates 40 companies across all six stages, with contacts on most; 3 templates (one archived); an owner and four officers (`@example.com`, they cannot sign in with Google); about 80 logged touches with notes, replies and stage history; overdue and upcoming follow-ups; 7 live claims and 3 expired ones. Dates are counted back from the database clock, so follow-ups are overdue whenever you run it. Open it at `/demo-riverbend`.

- Running it again is safe. It rebuilds only the demo workspace (`demo-riverbend`): its companies, contacts, outreach, stage history and templates are cleared and recreated with the same ids, so the result is the same each time. Other workspaces are never touched.
- It refuses to run unless both `DATABASE_URL` and `DIRECT_URL` point at `localhost`, `127.0.0.1` or `::1`, so it cannot be run against Supabase by accident.
- To open the demo workspace with your own account, sign in once locally, then run `SEED_OWNER_EMAIL=you@gmail.com npm run db:seed`. That adds you as an owner of the demo workspace.

### The MCP server

Built on Better Auth's MCP and OAuth provider plugins (`lib/auth.ts`) and the official MCP SDK (`lib/mcp/`). Assistants register themselves (open dynamic client registration), sign in with Google, and get access tokens that last an hour and work only for `/api/mcp`. Discovery lives at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server/api/auth`. `BETTER_AUTH_URL` must be the public site address, since tokens are bound to `<BETTER_AUTH_URL>/api/mcp`. Tool calls are limited to 60 reads and 10 changes a minute per person. Every request also checks that the grant behind the token still stands (`lib/mcp/grant.ts`). Disconnect in Settings (`lib/mcp/connections.ts`) deletes that person's consent and every access and refresh token of that assistant for them in one transaction, so its current access token is refused on the next call and its refresh token no longer works; other people's connections to the same assistant are untouched.

While the Google OAuth app is in Testing mode, only the Google accounts listed as test users can sign in, through an assistant or otherwise.

## Checks

```bash
npm run lint
npm run typecheck
npm test                      # needs the local Postgres running
```

## Status

The core workflow works end to end: import (with Smart import for messy notes), claims, the queue and board, the fact sheet, drafts, the claim checker, logging outreach, reply rates for each pitch template, and research briefs from approved pages. Members can also connect their own AI assistant through the MCP server. Ask Coppice answers questions about the pipeline and only acts after you confirm. Next up is a turnover summary for each incoming board.
