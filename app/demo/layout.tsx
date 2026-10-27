import type { ReactNode } from "react";
import { DemoProvider } from "@/demo/store";
import { LedgerProviders } from "./_ledger/providers";

// Wraps every prototype screen under /demo in the shared mock state (demo/store.tsx), then in the
// Ledger services (margin notes, confirmation dialog). The design branches draw everything else.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <LedgerProviders>{children}</LedgerProviders>
    </DemoProvider>
  );
}
