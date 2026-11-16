import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

// The tab title for an unknown address. The <title> element below covers a layout calling notFound()
// in the production build, where this export did not reach the head.
export const metadata: Metadata = { title: { absolute: "Page not found" } };

// Shown for any address the app does not have, and for a workspace or company the signed-in
// person cannot open. It is our own page because the framework's default one adds an inline
// style element, which the Content-Security-Policy rightly blocks. It uses only utility classes
// so that no extra stylesheet is loaded on every other page. The title is an element because exported
// metadata never reached the head on a 404 in the production build, for an unknown address or a
// layout calling notFound().
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[640px] content-center justify-items-start gap-3.5 px-5 py-12 sm:px-12">
      <title>Page not found</title>
      <Link href="/" className="inline-flex items-center gap-2 text-moss" aria-label="Coppice home">
        <LogoMark size={32} />
        <span className="font-display text-[1.375rem] text-ink">Coppice</span>
      </Link>
      <h1 className="mt-7 font-display text-[1.875rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[2.625rem]">
        Page not found
      </h1>
      <p className="max-w-[46ch] text-[1.0625rem] text-ink-2">
        The link may be old, or the workspace may belong to another account.
      </p>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href="/workspaces"
          className="inline-flex min-h-11 items-center rounded-[3px] bg-moss px-[18px] font-medium text-paper hover:bg-moss-2"
        >
          Your workspaces
        </Link>
        <Link href="/" className="text-moss underline underline-offset-4">
          Home page
        </Link>
      </p>
    </main>
  );
}
