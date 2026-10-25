"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { boardQuery, type BoardFilters } from "@/lib/validation";

type Props = { filters: BoardFilters; industries: string[] };

// Search box and industry filter. They only change the URL; the server renders the board for it,
// so a filtered board can be bookmarked and Back works. Typing waits 300 ms after the last key
// so each keystroke doesn't load the board.
export function BoardSearch({ filters, industries }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(filters.q);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A new search starts over: any column expanded with "Show all" goes back to 50 cards.
  const go = (changes: Partial<BoardFilters>) =>
    startTransition(() => router.replace(`${pathname}${boardQuery({ ...filters, all: null, ...changes })}`, { scroll: false }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={text}
        maxLength={100}
        placeholder="Search companies"
        aria-label="Search companies"
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => go({ q: value.trim() }), 300);
        }}
        className="rounded border px-2 py-1"
      />
      <select
        value={filters.industry}
        onChange={(e) => go({ industry: e.target.value })}
        aria-label="Industry"
        className="rounded border px-2 py-1"
      >
        <option value="">All industries</option>
        {industries.map((industry) => (
          <option key={industry} value={industry}>
            {industry}
          </option>
        ))}
      </select>
      {pending && <span className="text-sm text-zinc-500">Loading...</span>}
    </div>
  );
}
