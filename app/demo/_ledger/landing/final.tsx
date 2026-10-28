"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { demoRoutes } from "@/demo/routes";
import { LogoMark } from "../logo";
import { SHOOTS_MANY, Stool } from "../stool";
import { FINAL, FOOTER } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The final call to action. When the stool scrolls into view its shoots draw once, one after
// another, the leaves unfurl, and then "Coppice. Capisce?" settles in under the buttons. Nothing
// repeats. With reduced motion (or without script) the finished stool and the line are simply there.
export function Final() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(el);
        const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
        const shoots = q(".lg-shoot");
        shoots.forEach((shoot, i) => {
          const start = i * 0.14;
          tl.fromTo(shoot.querySelectorAll(".lg-stem, .lg-stem-thin"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.0, ease: "lgGrow" }, start);
          shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
            const t = Number(leaf.dataset.t ?? 1);
            tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.3, ease: "back.out(2.4)" }, start + 1.0 * (1 - Math.pow(1 - t, 1 / 3)));
          });
        });
        tl.fromTo(q(".ld-signoff"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6 }, 1.5);
        ScrollTrigger.create({ trigger: el.querySelector(".ld-final-art"), start: "top 80%", once: true, onEnter: () => tl.play() });
      }, el);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="ld-final" aria-labelledby="final-title">
      <div className="ld-wrap ld-final-grid">
        <div className="ld-final-art" aria-hidden="true">
          <Stool shoots={SHOOTS_MANY} className="ld-stool ld-final-stool" />
        </div>
        <div className="ld-final-copy">
          <h2 id="final-title" className="ld-h2 ld-final-h">
            {FINAL.headline}
          </h2>
          <p className="ld-sub">{FINAL.subhead}</p>
          <div className="ld-cta-row">
            <Link href={demoRoutes.signIn()} className="lg-btn lg-btn-primary ld-btn-lg">
              Start a workspace
            </Link>
            <a href="#faq" className="lg-btn ld-btn-lg">
              Read the FAQ
            </a>
          </div>
          <p className="ld-signoff lg-quote">{FOOTER.tagline}</p>
        </div>
      </div>

      <footer className="ld-footer">
        <div className="ld-wrap ld-footer-grid">
          <div>
            <p className="ld-foot-mark">
              <LogoMark size={36} className="text-moss" />
              <span className="font-display text-[1.3rem] font-semibold tracking-[0.02em]">Coppice</span>
            </p>
            <p className="lg-quote ld-foot-tag">{FOOTER.tagline}</p>
            <p className="ld-foot-small">
              Said <span className="ld-chip lg-sc">{FOOTER.pronunciation}</span>
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="ld-foot-links">
              {FOOTER.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
              <li>
                <Link href={demoRoutes.signIn()}>Start a workspace</Link>
              </li>
              <li>
                <Link href={demoRoutes.signIn()}>Sign in</Link>
              </li>
            </ul>
          </nav>
          <div className="ld-foot-small">
            <p>{FOOTER.handle}</p>
            <p>{FOOTER.origin}</p>
            <p>{FOOTER.disclaimer}</p>
            <p>{FOOTER.copyright}</p>
          </div>
        </div>
      </footer>
    </section>
  );
}
