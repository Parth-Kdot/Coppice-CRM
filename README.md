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

**Sending and logging.** Coppice never sends email. Drafts open in your own Gmail, Outlook or mail app. Logging the outreach renews your claim and sets the next follow-up.

## Stack

Next.js 16 (App Router) and React 19 with TypeScript, Tailwind CSS 4, Prisma 7 with the pg driver adapter, Postgres on Supabase, Better Auth with Google sign-in and the organization plugin, Gemini for the AI features, Papa Parse for CSV and unpdf for PDF text. Hosted on Vercel. Tests run on Vitest against a real Postgres.

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

`.env.example` explains every variable. In short: `DATABASE_URL` and `DIRECT_URL` point at the local Postgres, `BETTER_AUTH_SECRET` comes from `openssl rand -base64 32`, the Google client ID and secret come from a Google Cloud OAuth client, and `WORKSPACE_CREATOR_EMAILS` lists who may create workspaces. `GEMINI_API_KEY` is optional; without it the AI features say so and stay off.

## Checks

```bash
npm run lint
npm run typecheck
npm test                      # needs the local Postgres running
```

## Status

The core workflow works end to end: import, claims, the queue and board, the fact sheet, drafts, the claim checker and logging outreach. Next up are reply rates for each pitch template, research briefs on a company before outreach, a pipeline assistant that only acts after you approve, an MCP server so AI assistants can read and update a pipeline, and a turnover summary for each incoming board.
