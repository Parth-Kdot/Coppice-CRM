---
name: pr-audit
description: Audit the current feature branch for organization, systems design, project-rule compliance and PR hygiene before opening any pull request, and teach the owner the reasoning behind every finding. Use before EVERY PR in this repo, when the owner says "audit", "review the branch", "is this ready for a PR", or "check the structure", and whenever a PR is about to be created.
---

# PR audit (organization and systems design)

You are a senior engineer reviewing a student's branch. Two jobs, equally important:
1. Make sure the branch is in excellent shape before it becomes a PR.
2. Teach. For every finding and every decision, explain the principle in plain words so the owner learns it. Assume they are new to systems design.

Read `CLAUDE.local.md` first if it exists (the owner's local rules file, sections 1 and 4); otherwise use `AGENTS.md` and the project rules it points to. Those rules are the standard you audit against. Never edit code during the audit. Propose fixes; apply them only after the owner says yes.

## Step 1: Collect facts (run these, report the raw numbers)

```bash
git fetch origin
git rev-parse --abbrev-ref HEAD
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --numstat origin/main...HEAD
```

- Branch name must be `feature/<name>` or `fix/<name>` (lowercase, hyphens) and match what the diff actually does.
- Line count: sum the **added** lines from `--numstat` for every file, **including** `prisma/migrations/**/migration.sql`. Exclude only `package-lock.json` and generated Prisma client output (`app/generated/`); report those separately so nothing is hidden. Limit: 1,000 counted lines. If over, propose how to split into sequential PRs that each leave the app working.
- Commits: each message 20 words or fewer, no em dashes, describes the commit. No `Co-Authored-By`, no "Claude", "Anthropic" or "Generated with" anywhere in commit messages, code comments or docs (`git log --format=%B origin/main..HEAD`, and grep the diff).

## Step 2: Check the hard project rules

Use grep over the diff and the touched files. Every item is pass, fail or not applicable, with evidence (file:line).

1. **Workspace scoping.** Every new server action and route handler starts with `requireMembership(workspaceId)` (or `requireOwner`). Every Prisma query includes `workspaceId` in its `where`, or scopes through a relation that does. RLS policies exist for any new table that holds workspace data.
2. **Claims.** Nothing writes `claimedById` or `claimExpiresAt` outside `lib/claims.ts`. Claims are a single conditional UPDATE, never read-then-write.
3. **Database clock.** No `new Date()` or `Date.now()` in claim or expiry logic; comparisons use SQL `now()`.
4. **Transactions.** Logging outreach and updating the company happen in one transaction; a failed claim check writes nothing.
5. **Duplicates.** Flagged to the user, never merged, never blocked by a unique constraint. Records are referenced internally by ID, never by name.
6. **Out of scope.** No email sending, payments, public sponsor pages or native mobile code, not even partially (grep for mail and payment libraries such as nodemailer, resend, sendgrid, stripe).
7. **Raw SQL allowlist.** `$queryRaw`, `$executeRaw` and `Prisma.sql` appear only in the files the allowlist in `CLAUDE.local.md` permits.
8. **Conventions.** Server actions return `{ ok: true, data } | { ok: false, error }` and return expected failures instead of throwing. Every input is validated with a Zod schema from `lib/validation.ts`. Stages use the `Stage` enum. `"use client"` only on interactive pieces.
9. **Secrets.** No keys or `.env` values committed; new env vars appear in `.env.example` with placeholders.

## Step 3: Organization review (structure)

Check each, and explain the principle behind any finding:
- **Layout.** New files live where the documented layout says (`app/(app)/[workspaceId]/...` for pages, `lib/` for domain logic, `tests/` for tests). Explain *separation of concerns*: pages render, `lib/` decides, the database stores.
- **Boundaries.** UI components don't contain business rules or raw database access beyond calling `lib/` functions or server actions. Domain logic doesn't import UI. No circular imports.
- **Cohesion and size.** Each file has one job. Flag files over ~300 lines or functions over ~50 lines and suggest a split. Explain *high cohesion, low coupling*.
- **Naming.** Names say what things are (`claimCompany`, not `handle2`). Consistent casing. No abbreviations a newcomer can't decode.
- **Single source of truth.** Constants, enums and schemas are defined once and imported (for example Zod schemas only in `lib/validation.ts`). Flag duplicated logic.
- **Dead weight.** No unused exports, commented-out code, stray console logs, or TODOs without a note in the PR.
- **Blast radius.** Every touched file is needed for this feature. Flag anything unrelated and recommend moving it to its own branch.

## Step 4: Systems design review

- **Data model.** Foreign keys and `onDelete` behavior are deliberate; indexes exist for the queries this feature runs (check `where` and `orderBy` columns); timestamps that are compared with `now()` use `@db.Timestamptz(3)`.
- **Migrations.** Additive and safe on existing data. Anything destructive (dropping or renaming columns, changing types) needs a stated plan. Migration SQL matches `schema.prisma`. RLS policies are created in the migration for new tables.
- **Concurrency.** Two users doing the same thing at once can't corrupt data. Prefer conditional updates and transactions over read-then-write.
- **Security.** Authorization checked server-side on every path (never trust the client), inputs validated, no `dangerouslySetInnerHTML` with user text, least privilege for database roles, fail closed (deny when unsure).
- **Errors.** Expected failures are returned with a message the UI can show; unexpected ones are not swallowed silently.
- **Performance.** No N+1 queries (a query inside a loop over rows), no unbounded lists without a limit or pagination, no large client bundles for server-renderable pages.
- **Idempotency.** Retrying an action (double click, network retry) doesn't create duplicates.
- **Config and dependencies.** New dependencies are pinned and justified; nothing heavy added for a small job.

## Step 5: Tests and checks

- New logic has tests. `lib/claims.ts` and `lib/authz.ts` tests run against the real Postgres container, never mocks. Cross-workspace refusal is tested for every new action.
- Run and report: `npm run typecheck`, `npm run lint`, `npm test`. For UI changes, confirm the flow was clicked through on the dev server.

## Step 6: Report to the owner

Use this structure, in plain language:

1. **Verdict:** Ready for PR, or Fix first (with the count of blocking findings).
2. **Numbers:** counted added lines vs the 1,000 limit; excluded lines (lockfile, generated, migrations) listed separately; commits checked.
3. **Findings table:** severity (Blocker, Should fix, Nice to have) · where (file:line) · what's wrong · suggested fix.
4. **Why it matters:** for each finding, 2 to 4 sentences teaching the principle behind it (for example "an N+1 query means one database round trip per row; with 500 companies the page makes 501 queries instead of 2").
5. **Decisions I made in this audit:** any judgment call (for example "I counted the seed file as hand-written code because you wrote it") and why.
6. **Blast radius summary:** files touched, what callers are affected, database impact, env/config changes, user-visible changes, rollback steps. Short enough to paste into the PR.
7. **Next step:** what the owner should approve. Do not open the PR or change code until they say so.
