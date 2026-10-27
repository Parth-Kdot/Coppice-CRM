"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { demoRoutes } from "@/demo/routes";
import { LogoMark } from "../logo";
import { SHOOTS_MANY, Stool, shootTips } from "../stool";
import { FINAL, FOOTER } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The final call to action: the stool now carries many stems and sways a few degrees in a slow
// loop. The loop stops when the stool is off screen and is switched off for reduced motion.
export function Final() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const tips = shootTips(SHOOTS_MANY);
      const ctx = gsap.context(() => {
        const shoots = gsap.utils.toArray<SVGGElement>(".lg-shoot", el);
        const tl = gsap.timeline({ paused: true });
        shoots.forEach((shoot, i) => {
          const base = tips[i]?.base;
          if (!base) return;
          const amp = 1.6 + (i % 3) * 0.55;
          const dur = 3.4 + (i % 4) * 0.5;
          tl.fromTo(
            shoot,
            { rotation: -amp, svgOrigin: `${base.x} ${base.y}` },
            { rotation: amp, svgOrigin: `${base.x} ${base.y}`, duration: dur, ease: "sine.inOut", repeat: -1, yoyo: true },
            -i * 0.35,
          );
        });
        ScrollTrigger.create({
          trigger: el.querySelector(".ld-final-art"),
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
        });
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
