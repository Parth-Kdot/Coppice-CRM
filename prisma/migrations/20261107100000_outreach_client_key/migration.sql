-- Log outreach is idempotent: the log form sends a key it makes once per entry, and a second
-- submit with the same key (a double press, a retry, a second tab) adds nothing. Old rows and
-- the AI assistant's logs have no key; NULLs never conflict with each other.
ALTER TABLE "Outreach" ADD COLUMN "clientKey" TEXT;

CREATE UNIQUE INDEX "Outreach_workspaceId_clientKey_key" ON "Outreach"("workspaceId", "clientKey");

-- A company's latest outreach first (the queue's last note, the company page's log).
CREATE INDEX "Outreach_companyId_workspaceId_sentAt_idx" ON "Outreach"("companyId", "workspaceId", "sentAt" DESC);
