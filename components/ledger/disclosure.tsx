import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";
import { ChevronRightIcon } from "./icons";

// The one collapsible. A native <details>/<summary> with a chevron, a title and an optional muted
// count, so keyboard and screen-reader behaviour come for free and it renders on the server with no
// script. The summary is at least 44 px tall on touch screens (ledger.css .lg-disc*).
//
//   <Disclosure summary="History" count={12}>...</Disclosure>
//   variant "section" (default): an h2-sized summary with a ruled top, for a block of the page.
//   variant "inline": a link-sized summary, for "How do I export?" under a paragraph.
//   defaultOpen opens it on first render; after that the person's toggle wins. `id` and
//   `data-tour` go on the <details>.
//
// LazyDisclosure (re-exported from ./lazy-disclosure, a client component) takes the same props plus
// onOpen, and mounts its children only after the first open: for heavy forms (contact edit,
// template edit, AI tools). Children stay mounted after a close, so typed input survives.

export type DisclosureProps = {
  summary: ReactNode;
  count?: number | string;
  defaultOpen?: boolean;
  id?: string;
  variant?: "section" | "inline";
  className?: string;
  "data-tour"?: string;
  children: ReactNode;
};

export function Disclosure({ summary, count, defaultOpen = false, id, variant = "section", className = "", "data-tour": dataTour, children }: DisclosureProps) {
  const shown = typeof count === "number" ? formatCount(count) : count;
  return (
    <details id={id} className={`lg-disc ${className}`.trim()} data-variant={variant} data-tour={dataTour} open={defaultOpen || undefined}>
      <summary className="lg-disc-summary">
        <ChevronRightIcon size={16} className="lg-disc-chev" />
        <span className="lg-disc-title">{summary}</span>
        {shown !== undefined && <span className="lg-disc-count">{shown}</span>}
      </summary>
      <div className="lg-disc-body">{children}</div>
    </details>
  );
}

export { LazyDisclosure, useLazyDisclosure } from "./lazy-disclosure";
