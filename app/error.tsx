"use client";

import Link from "next/link";
import { LogoMark } from "@/components/ledger/logo";

// The page a person sees if something unexpected breaks while a screen is drawn. Our own markup
// with utility classes only, so it carries no inline style for the Content-Security-Policy to block.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[640px] content-center justify-items-start gap-3.5 px-5 py-12 sm:px-12">
      <Link href="/" className="inline-flex items-center gap-2 text-moss" aria-label="Coppice home">
        <LogoMark size={32} />
        <span className="font-display text-[1.375rem] text-ink">Coppice</span>
      </Link>
      <h1 className="mt-7 font-display text-[1.875rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[2.625rem]">
        Something went wrong
      </h1>
      <p className="max-w-[46ch] text-[1.0625rem] text-ink-2">Go back to your workspaces, or try this page again.</p>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href="/workspaces"
          className="inline-flex min-h-11 items-center rounded-[3px] bg-moss px-[18px] font-medium text-paper hover:bg-moss-2"
        >
          Your workspaces
        </Link>
        <button type="button" onClick={() => retry()} className="min-h-11 cursor-pointer text-moss underline underline-offset-4">
          Try again
        </button>
      </p>
    </main>
  );
}
