#!/bin/sh
# Design exploration branches only. Vercel preview builds of the design branches have no
# environment variables, and lib/db.ts and lib/auth.ts read these at import time while Next.js
# collects page data. The placeholders below exist only so that step can finish; the /demo
# prototype never talks to a database or to Google. Real values, when set, always win.
: "${DATABASE_URL:=postgresql://preview:preview@localhost:5432/preview}"
: "${BETTER_AUTH_SECRET:=design-preview-placeholder-secret-never-used}"
: "${GOOGLE_CLIENT_ID:=design-preview-placeholder}"
: "${GOOGLE_CLIENT_SECRET:=design-preview-placeholder}"
export DATABASE_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
exec next build "$@"
