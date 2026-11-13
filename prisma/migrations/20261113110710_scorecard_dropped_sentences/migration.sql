-- How many sentences of the model's reply the checks left out before the explanation was stored,
-- for the quiet "N sentences were left out" line. Additive only: one column with a default, so
-- every stored row stays valid (and reads as 0). The table's row-level security covers it already.

-- AlterTable
ALTER TABLE "ScorecardNarrative" ADD COLUMN     "droppedSentences" INTEGER NOT NULL DEFAULT 0;
