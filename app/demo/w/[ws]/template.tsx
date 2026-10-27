import type { ReactNode } from "react";

// A template remounts on every navigation, so the page content fades and rises 6 px (160 ms).
export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  return <div className="lg-page-enter">{children}</div>;
}
