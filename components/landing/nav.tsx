"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "../ledger/logo";
import { NAV_LINKS } from "./copy";

// The landing nav: the mark and word, the section links and the main button. The bar is
// solid paper. Below 860 px the section links sit in a menu that opens under the bar.
export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const main = signedIn ? { href: "/workspaces", label: "Open your workspaces" } : { href: "/signin", label: "Sign in with Google" };
  return (
    <header className="ld-nav" data-open={open}>
      <a className="lg-skip" href="#top-of-page">
        Skip to the page
      </a>
      <div className="ld-nav-in">
        <Link href="/" className="ld-nav-logo" aria-label="Coppice, home">
          <Logo size={34} />
        </Link>
        <nav aria-label="Sections" id="ld-sections">
          <ul className="ld-nav-links">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
            {!signedIn && (
              <li className="ld-nav-menu-only">
                <Link href="/signin">Sign in</Link>
              </li>
            )}
          </ul>
        </nav>
        <button type="button" className="lg-btn ld-nav-menu-btn" aria-expanded={open} aria-controls="ld-sections" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Menu"}
        </button>
        <div className="ld-nav-cta">
          <Link href={main.href} className="lg-btn lg-btn-primary">
            {main.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
