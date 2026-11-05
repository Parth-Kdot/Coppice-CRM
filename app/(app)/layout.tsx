import type { ReactNode } from "react";
import { LedgerProviders } from "@/components/ledger/providers";

// Everything signed in shares the margin notes and the confirmation dialog.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <LedgerProviders>{children}</LedgerProviders>;
}
