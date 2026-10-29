"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { LogoMark } from "../ledger/logo";
import { SHOOTS_MANY, Stool } from "../ledger/stool";
import { FINAL, FOOTER } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The final call to action. When the stool scrolls into view its shoots draw once, one after
// another, and the leaves open along them. Nothing repeats. With reduced motion (or without script)
// the finished stool is simply there. The footer carries the one line about who built this.
export function Final({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLElement>(null);
  const stool = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = root.current;
    const svg = stool.current;
    if (!el || !svg) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(svg);
        const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" }, onComplete: () => svg.classList.remove("ld-draw") });
        q(".lg-shoot").forEach((shoot, i) => {
          const start = i * 0.14;
          tl.fromTo(shoot.querySelectorAll(".lg-stem, .lg-stem-thin"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.0, ease: "lgGrow" }, start);
          shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
            const t = Number(leaf.dataset.t ?? 1);
            tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.3 }, start + 1.0 * (1 - Math.pow(1 - t, 1 / 3)));
          });
        });
        ScrollTrigger.create({ trigger: svg, start: "top 80%", once: true, onEnter: () => tl.play() });
      }, el);
      return () => {
        ctx.revert();
        svg.classList.remove("ld-draw");
      };
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="ld-final" aria-labelledby="final-title">
      <div className="ld-wrap ld-grid ld-final-grid">
        <div className="ld-final-art" aria-hidden="true">
          <Stool ref={stool} shoots={SHOOTS_MANY} className="ld-stool ld-final-stool ld-draw ld-draw-shoots" />
        </div>
        <div className="ld-final-copy">
          <h2 id="final-title" className="ld-h2">
            {FINAL.headline}
          </h2>
          <p className="ld-sub">{FINAL.subhead}</p>
          <div className="ld-cta-row">
            {signedIn ? (
              <Link href="/workspaces" className="lg-btn lg-btn-primary ld-btn-lg">
                Open your workspaces
              </Link>
            ) : (
              <>
                <Link href="/signin" className="lg-btn lg-btn-primary ld-btn-lg">
                  Start a workspace
                </Link>
                <Link href="/signin" className="lg-btn ld-btn-lg">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="ld-footer">
        <div className="ld-wrap ld-footer-grid">
          <div>
            <p className="ld-foot-mark">
              <LogoMark size={36} className="text-moss" />
              <span className="font-display text-[length:var(--fs-4)] font-normal tracking-[0.01em]">Coppice</span>
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="ld-foot-links">
              {FOOTER.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
              {!signedIn && (
                <li>
                  <Link href="/signin">Sign in</Link>
                </li>
              )}
            </ul>
          </nav>
          <div className="ld-foot-small">
            <p>{FOOTER.builder}</p>
            <p>{FOOTER.disclaimer}</p>
            <p>{FOOTER.copyright}</p>
            <p className="ld-foot-tag">{FOOTER.tagline}</p>
          </div>
        </div>
      </footer>
    </section>
  );
}
