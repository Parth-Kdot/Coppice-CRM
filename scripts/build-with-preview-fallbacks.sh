#!/bin/sh
# Preview builds on Vercel can run before the owner adds preview secrets. lib/db.ts and
# lib/auth.ts read these variables at import time while Next.js collects page data, so the
# build would stop without them. The placeholders below only let that step finish; pages are
# rendered per request, so a preview that still has placeholders cannot sign anyone in or reach
# a database. Real values, when set, always win.
#
# Previews only: anywhere else a missing secret must stop the build, not ship a broken site.
if [ "$VERCEL_ENV" = "preview" ]; then
  : "${DATABASE_URL:=postgresql://preview:preview@localhost:5432/preview}"
  : "${BETTER_AUTH_SECRET:=preview-placeholder-secret-never-used}"
  : "${GOOGLE_CLIENT_ID:=preview-placeholder}"
  : "${GOOGLE_CLIENT_SECRET:=preview-placeholder}"
  export DATABASE_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
fi
exec next build "$@"
