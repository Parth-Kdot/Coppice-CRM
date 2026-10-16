<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Skills

Project skills give coding agents expert guidance for this stack. They are installed per machine (not committed); `skills-lock.json` pins the exact versions. Restore all of them with:

```bash
npx skills experimental_install
```

| Skill | Use it when | Install on its own |
| --- | --- | --- |
| supabase-postgres-best-practices | Writing or changing anything in Postgres: tables, indexes, migrations, row-level security, pgvector | `npx skills add supabase/agent-skills -s supabase-postgres-best-practices` |
| supabase | Supabase project settings, connection strings, pooler, Data API | `npx skills add supabase/agent-skills -s supabase` |
| prisma-orm-setup | Prisma configuration, driver adapter, connection problems (this app stays on Prisma 7.10.1) | `npx skills add prisma/skills -s prisma-orm-setup` |
| better-auth-best-practices | Better Auth server and client setup, sessions, environment variables | `npx skills add better-auth/skills -s better-auth-best-practices` |
| organization-best-practices | Workspaces, members, roles and invitations (Better Auth organization plugin) | `npx skills add better-auth/skills -s organization-best-practices` |
| vercel-react-best-practices | Writing or reviewing React and Next.js code | `npx skills add vercel-labs/agent-skills -s vercel-react-best-practices` |
| tdd | Building a feature or fixing a bug test-first | `npx skills add mattpocock/skills -s tdd` |
| improve-codebase-architecture | Reviewing structure and module boundaries | `npx skills add mattpocock/skills -s improve-codebase-architecture` |
| security-review | Reviewing auth, permissions, row-level security and input handling | `npx skills add getsentry/skills -s security-review` |
| web-design-guidelines | Reviewing UI and accessibility before demos | `npx skills add vercel-labs/agent-skills -s web-design-guidelines` |
| pr-audit | Before every pull request: structure, design, project rules and PR hygiene | Committed in this repo at `.claude/skills/pr-audit/SKILL.md` |

When a skill's advice conflicts with this project's choices, the project wins: Prisma stays on 7.10.1, database tests use a real Postgres instead of mocks, and authentication uses Better Auth rather than Supabase Auth.
