import "@/components/ledger/zod-jitless";
import type { ReactNode } from "react";
import { DemoProvider } from "@/demo/store";
import { LedgerProviders } from "@/components/ledger/providers";
import { DemoToolsProvider } from "./_ledger/form-actions";

// Wraps every screen under /demo in the in-browser store (demo/store.tsx), then in the margin
// notes and the confirmation dialog the real app uses.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <DemoToolsProvider>
        <LedgerProviders>{children}</LedgerProviders>
      </DemoToolsProvider>
    </DemoProvider>
  );
}
