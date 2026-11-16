"use client";

import { createContext, useContext, useId, useMemo, useRef, useState } from "react";
import { formatCount } from "@/lib/format";
import type { DisclosureProps } from "./disclosure";
import { focusSoon } from "./focus";
import { ChevronRightIcon } from "./icons";

// LazyDisclosure: Disclosure's look, built as a <button aria-expanded aria-controls> over a panel,
// for heavy content. Children mount on the first open and then stay mounted (hidden while closed),
// so a half-typed form survives a close. onOpen runs on every open (load something, log a view).
// Import it from "./disclosure"; it lives here only because it needs the client.
//
// useLazyDisclosure() gives the children { close } (null outside one): an Add contact form calls
// close() after it saves, and focus returns to the toggle button instead of falling to <body>.

const LazyDisclosureContext = createContext<{ close: () => void } | null>(null);
export function useLazyDisclosure(): { close: () => void } | null {
  return useContext(LazyDisclosureContext);
}

export function LazyDisclosure({
  summary,
  count,
  defaultOpen = false,
  id,
  variant = "section",
  className = "",
  "data-tour": dataTour,
  onOpen,
  children,
}: DisclosureProps & { onOpen?: () => void }) {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  const button = useRef<HTMLButtonElement>(null);
  const shown = typeof count === "number" ? formatCount(count) : count;
  const api = useMemo(
    () => ({
      close: () => {
        setOpen(false);
        focusSoon(() => button.current);
      },
    }),
    [],
  );

  return (
    <div id={id} className={`lg-disc ${className}`.trim()} data-variant={variant} data-open={open} data-tour={dataTour}>
      <button
        ref={button}
        type="button"
        className="lg-disc-summary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            setMounted(true);
            onOpen?.();
          }
        }}
      >
        <ChevronRightIcon size={16} className="lg-disc-chev" />
        <span className="lg-disc-title">{summary}</span>
        {shown !== undefined && <span className="lg-disc-count">{shown}</span>}
      </button>
      <div id={panelId} className="lg-disc-body" hidden={!open}>
        {mounted && <LazyDisclosureContext value={api}>{children}</LazyDisclosureContext>}
      </div>
    </div>
  );
}
