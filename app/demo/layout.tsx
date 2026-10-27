import type { ReactNode } from "react";
import { DemoProvider } from "@/demo/store";

// Wraps every prototype screen under /demo in the shared mock state (demo/store.tsx). It adds no
// markup of its own: the design branches draw everything.
export default function DemoLayout({ children }: { children: ReactNode }) {
  return <DemoProvider>{children}</DemoProvider>;
}
