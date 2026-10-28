"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { demoRoutes } from "@/demo/routes";
import { Ribbon } from "../marks";
import { SHOOTS_THREE, Stool } from "../stool";
import { HERO } from "./copy";
import { HeroDemo } from "./hero-demo";
import { MOTION_OK, REDUCED_MOTION, setupGsap } from "./motion";

// The hero. On load, in about 2.2 s, the engraved stool draws itself: the stump strokes in, then
// three shoots grow with leaves unfurling alternately left and right, then the headline ink-bleeds
// in word by word, then the subhead and the two buttons fade up. After that it is still.
export function Hero() {
  const root = useRef<HTMLElement>(null);
  // True once the headline, subhead and buttons have settled. The live queue waits for it.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap } = setupGsap();
    const mm = gsap.matchMedia();

    mm.add(MOTION_OK, () => {
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(el);
        const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

        // The stump outline strokes in over 500 ms.
        tl.fromTo(q(".lg-stump-wall, .lg-stump-top"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut", stagger: 0.05 }, 0);
        tl.fromTo(q(".lg-stump-rings ellipse"), { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.05 }, 0.25);
        tl.fromTo(q(".lg-stump-hatch, .lg-stump-bark, .lg-stump-roots, .lg-ground"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.3);

        // Three shoots, 120 ms apart, 900 ms each, leaves unfurling as the stem passes them.
        const shoots = q(".lg-shoot");
        shoots.forEach((shoot, i) => {
          const start = 0.5 + i * 0.12;
          const stems = shoot.querySelectorAll(".lg-stem, .lg-stem-thin");
          tl.fromTo(stems, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, ease: "lgGrow" }, start);
          shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
            const t = Number(leaf.dataset.t ?? 1);
            const at = start + 0.9 * (1 - Math.pow(1 - t, 1 / 3));
            tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.3, ease: "back.out(2.4)" }, at);
          });
        });

        // The headline ink-bleeds in: blur 6 px and clear to sharp over 500 ms, 70 ms apart.
        tl.fromTo(q(".ld-word"), { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.5, stagger: 0.07, clearProps: "filter" }, 1.25);
        // Subhead, buttons and the supporting strip fade up 8 px.
        tl.fromTo(q(".ld-up"), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, clearProps: "transform" }, 1.75);

        tl.call(() => setSettled(true), [], 2.3);
        el.classList.remove("ld-pre");
      }, el);
      return () => ctx.revert();
    });

    mm.add(REDUCED_MOTION, () => {
      el.classList.remove("ld-pre");
      setSettled(true);
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="top-of-page" className="ld-hero ld-pre" aria-labelledby="hero-title">
      <Ribbon size="lg" className="ld-hero-ribbon" />
      <div className="ld-wrap ld-hero-grid">
        <div className="ld-hero-copy">
          <Stool shoots={SHOOTS_THREE} className="ld-stool ld-hero-stool" />
          <p className="ld-eyebrow ld-up">A shared outreach pipeline</p>
          <h1 id="hero-title" className="ld-h1">
            {HERO.headline.map((word, i) => (
              <span key={i}>
                <span className="ld-word">{word}</span>
                {i < HERO.headline.length - 1 ? " " : ""}
              </span>
            ))}
          </h1>
          <p className="ld-lede ld-up">{HERO.subhead}</p>
          <div className="ld-cta-row ld-up">
            <Link href={demoRoutes.signIn()} className="lg-btn lg-btn-primary ld-btn-lg">
              Start a workspace
            </Link>
            <Link href={demoRoutes.signIn()} className="lg-btn ld-btn-lg">
              Sign in
            </Link>
          </div>
          <p className="ld-micro ld-up">{HERO.micro}</p>
        </div>
        <div className="ld-hero-demo ld-up">
          <HeroDemo settled={settled} />
        </div>
      </div>
      <div className="ld-wrap">
        <ul className="ld-strip">
          {HERO.strip.map((item) => (
            <li key={item.title} className="ld-up">
              <p className="lg-sc ld-strip-title">{item.title}</p>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
