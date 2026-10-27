import Link from "next/link";
import { demoRoutes } from "@/demo/routes";
import { Logo } from "../logo";
import { NAV_LINKS } from "./copy";

// The landing nav: the mark and word, four section links, Sign in and Start a workspace. Both of
// the last two go to the sign-in page of the prototype.
export function LandingNav() {
  return (
    <header className="ld-nav">
      <a className="lg-skip" href="#top-of-page">
        Skip to the page
      </a>
      <div className="ld-nav-in">
        <Link href="/" className="ld-nav-logo" aria-label="Coppice, home">
          <Logo size={34} />
        </Link>
        <nav className="ld-nav-links" aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ld-nav-cta">
          <Link href={demoRoutes.signIn()} className="ld-nav-signin">
            Sign in
          </Link>
          <Link href={demoRoutes.signIn()} className="lg-btn lg-btn-primary">
            Start a workspace
          </Link>
        </div>
      </div>
    </header>
  );
}
