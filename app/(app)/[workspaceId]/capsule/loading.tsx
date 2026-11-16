import { RowsSkeleton } from "@/components/ledger/skeleton";

// Shown at once while the Time Capsule loads: the heading with its sub line, then its three boxed sections.
export default function CapsuleLoading() {
  return <RowsSkeleton title sub panels={3} />;
}
