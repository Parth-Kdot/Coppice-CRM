"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { completeStamp } from "./motion-kit";

// Stamps what an action just added to a server-rendered list. It remembers the ids it was first
// drawn with; when a later render (the server's fresh page after an action) brings an id it hasn't
// seen, it plays the motion kit's completeStamp on that item ([data-stamp-id] inside it), or on
// `target` (a selector inside it, e.g. the summary of an "Archived" fold the item went into). Never
// on the first render, so nothing moves on page load. The wrapper adds no box of its own.
export function StampOnNew({ ids, target, children }: { ids: string[]; target?: string; children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const key = ids.join("\n");
  useEffect(() => {
    const now = key ? key.split("\n") : [];
    const before = seen.current;
    seen.current = new Set(now);
    if (!before) return;
    const added = now.filter((id) => !before.has(id));
    if (added.length === 0) return;
    const root = scope.current;
    if (!root) return;
    if (target) {
      void completeStamp(root.querySelector(target));
      return;
    }
    for (const id of added) void completeStamp(root.querySelector(`[data-stamp-id="${CSS.escape(id)}"]`));
  }, [key, target]);
  return (
    <div ref={scope} className="lg-stampscope">
      {children}
    </div>
  );
}
