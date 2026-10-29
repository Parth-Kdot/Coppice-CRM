"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { SHOOTS_THREE, Stool } from "../ledger/stool";
import { HERO } from "./copy";
import { MiniQueue } from "./mini-queue";
import { MOTION_OK, setupGsap } from "./motion";

// The hero: the headline and the main button are on the page from the first paint. The engraved
// stool beside them draws itself once in about two seconds (the stump strokes in, three shoots
// grow, leaves open along the stems) and then stays. On the right, the product in its finished
// state: a queue made of made-up rows, labeled as an example, running past the edge of the window.
export function Hero({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLElement>(null);
  const stool = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = stool.current;
    const el = root.current;
    if (!svg || !el) return;
    const { gsap } = setupGsap();
    const mm = gsap.matchMedia();

    mm.add(MOTION_OK, () => {
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(svg);
        const tl = gsap.timeline({ defaults: { ease: "power2.out" }, onComplete: () => svg.classList.remove("ld-draw") });

        // The stump outline strokes in over 500 ms.
        tl.fromTo(q(".lg-stump-wall, .lg-stump-top"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut", stagger: 0.05 }, 0);
        tl.fromTo(q(".lg-stump-rings"), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.25);
        tl.fromTo(q(".lg-stump-hatch, .lg-stump-bark, .lg-stump-roots, .lg-ground"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.3);

        // Three shoots, 120 ms apart, 900 ms each, leaves opening as the stem passes them.
        q(".lg-shoot").forEach((shoot, i) => {
          const start = 0.5 + i * 0.12;
          tl.fromTo(shoot.querySelectorAll(".lg-stem, .lg-stem-thin"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, ease: "lgGrow" }, start);
          shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
            const t = Number(leaf.dataset.t ?? 1);
            const at = start + 0.9 * (1 - Math.pow(1 - t, 1 / 3));
            tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.3, ease: "power2.out" }, at);
          });
        });
      }, el);
      return () => {
        ctx.revert();
        svg.classList.remove("ld-draw");
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="top-of-page" className="ld-hero" aria-labelledby="hero-title">
      <div className="ld-wrap ld-grid ld-hero-grid">
        <div className="ld-hero-copy">
          <Stool ref={stool} shoots={SHOOTS_THREE} className="ld-stool ld-hero-stool ld-draw" />
          <h1 id="hero-title" className="ld-h1">
            {HERO.headline}
          </h1>
          <p className="ld-lede">{HERO.subhead}</p>
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
          {!signedIn && <p className="ld-micro">{HERO.micro}</p>}
        </div>
        <figure className="ld-hero-window">
          <figcaption>{HERO.exampleLabel}</figcaption>
          <div className="ldm-wrap">
            <MiniQueue />
          </div>
        </figure>
      </div>
    </section>
  );
}
