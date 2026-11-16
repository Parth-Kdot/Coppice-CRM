import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while a workspace page loads (the queue, and any page below without its own
// loading.tsx), so a slow navigation never looks like a click that did nothing.
export default function Loading() {
  return <RowsSkeleton rows={8} title />;
}
