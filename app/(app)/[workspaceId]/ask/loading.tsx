import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while Ask Coppice loads: the heading with its sub line, then a few ruled rows.
export default function AskLoading() {
  return <RowsSkeleton title sub rows={4} />;
}
