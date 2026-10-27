"use client";

import { useEffect, useId, useRef } from "react";
import { SHOOTS_FIVE, SHOOTS_THREE, ShootSet, Stump, STOOL_VIEWBOX, pointOnShoot, shootTips } from "../stool";
import { SEASONS } from "./copy";
import { MOTION_OK, setupGsap } from "./motion";

// The centerpiece: four seasons of a board, as one pinned scene about 300 vh tall, scrubbed by the
// scroll position. Autumn: the shoots grow. Winter: a clean cut sweeps down, the leaves fall as
// small slips and become ledger rows on the right page. Spring: five shoots regrow from the same
// roots. Summer: full growth, with committed sponsors hanging from the stems on tags.
// Without motion (or script) the section is a plain stack: the scene in summer and four captions.

const CUT_Y = 262;
const LABEL_T = [0.6, 0.64, 0.66, 0.62, 0.58];
const LABEL_DX = [-6, -4, 4, 4, 6];

function Scene() {
  const id = useId().replace(/:/g, "");
  const cutId = `cut-${id}`;
  const tipsA = shootTips(SHOOTS_THREE);
  const slipSources = tipsA
    .flatMap((s) => s.leaves.slice(0, -1))
    .sort((a, b) => a.y - b.y)
    .slice(0, 8);
  const tags = SHOOTS_FIVE.map((spec, i) => {
    const p = pointOnShoot(spec, LABEL_T[i]);
    const text = SEASONS.labels[i];
    const w = Math.round(text.length * 6.7 + 22);
    return { x: p.x + LABEL_DX[i], y: p.y, w, text };
  });
  return (
    <svg
      className="ld-scene"
      viewBox={`${STOOL_VIEWBOX.x} ${STOOL_VIEWBOX.y} ${STOOL_VIEWBOX.w} ${STOOL_VIEWBOX.h}`}
      role="img"
      aria-label="A cut stump. In autumn three shoots grow, in winter they are cut back, in spring five shoots regrow from the same roots, and in summer company names hang from the stems."
      focusable="false"
    >
      <defs>
        <clipPath id={cutId}>
          <rect className="ld-cut-rect" x={-20} y={-40} width={520} height={500} />
        </clipPath>
      </defs>
      <path className="lg-ground" d="M14 410 H466" fill="none" stroke="currentColor" strokeWidth={0.8} strokeDasharray="2 5" strokeLinecap="round" />
      <Stump />
      <g className="ld-shoots-a" clipPath={`url(#${cutId})`}>
        <ShootSet specs={SHOOTS_THREE} group="a" />
      </g>
      <g className="ld-shoots-b">
        <ShootSet specs={SHOOTS_FIVE} group="b" />
      </g>
      <path className="ld-cutline" d="M44 0 H436 M44 -5 V5 M436 -5 V5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="7 5" />
      {slipSources.map((leaf, i) => (
        <g key={i} className="ld-slip" data-x={leaf.x} data-y={leaf.y} transform={`translate(${leaf.x} ${leaf.y})`}>
          <rect x={-10} y={-6.500} width={20} height={13} rx={1.600} fill="var(--sheet)" stroke="currentColor" strokeWidth={1.2} />
          <path d="M-6 -2h12M-6 2h8" stroke="currentColor" strokeWidth={0.8} strokeLinecap="round" />
        </g>
      ))}
      <g className="ld-tags" fontFamily="var(--font-sans)">
        {tags.map((tag, i) => (
          <g key={i} className="ld-tag" data-i={i}>
            <path d={`M${tag.x} ${tag.y} v16`} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={tag.x - tag.w / 2} y={tag.y + 16} width={tag.w} height={24} rx={2} fill="var(--sheet)" stroke="currentColor" strokeWidth={1.3} />
            <circle cx={tag.x} cy={tag.y + 21} r={1.600} fill="currentColor" />
            <text x={tag.x} y={tag.y + 33.500} textAnchor="middle" fontSize={12.500} fontWeight={500} fill="var(--ink)">
              {tag.text}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Seasons() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const mm = gsap.matchMedia();

    mm.add(MOTION_OK, () => {
      el.dataset.motion = "on";
      el.dataset.season = "0";
      const ctx = gsap.context(() => {
        const q = gsap.utils.selector(el);
        const tl = gsap.timeline({ defaults: { ease: "none" } });

        const grow = (group: string, count: number, startAt: number, step: number, dur: number) => {
          for (let i = 0; i < count; i++) {
            const shoot = el.querySelector<SVGGElement>(`[data-shoot="${group}${i}"]`);
            if (!shoot) continue;
            const start = startAt + i * step;
            tl.fromTo(shoot.querySelectorAll(".lg-stem, .lg-stem-thin"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.out" }, start);
            shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
              const t = Number(leaf.dataset.t ?? 1);
              tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.14, ease: "back.out(2)" }, start + dur * (1 - Math.pow(1 - t, 1 / 2.4)));
            });
          }
        };

        // Autumn, 0 to 1: three shoots grow.
        grow("a", 3, 0.04, 0.1, 0.5);

        // Winter, 1 to 2: a clean cut sweeps down to the stump.
        const rect = el.querySelector(".ld-cut-rect");
        const line = el.querySelector(".ld-cutline");
        tl.fromTo(line, { y: -36, opacity: 0 }, { opacity: 1, duration: 0.06 }, 1.04);
        tl.to(line, { y: CUT_Y, duration: 0.5, ease: "power1.inOut" }, 1.06);
        tl.to(rect, { attr: { y: CUT_Y, height: 460 - CUT_Y }, duration: 0.5, ease: "power1.inOut" }, 1.06);
        tl.to(line, { opacity: 0, duration: 0.14 }, 1.58);

        // The leaves fall as slips and become ledger rows.
        const slips = el.querySelectorAll<SVGGElement>(".ld-slip");
        slips.forEach((slip, i) => {
          const x = Number(slip.dataset.x);
          const y = Number(slip.dataset.y);
          const at = 1.06 + 0.5 * ((y + 36) / (CUT_Y + 36));
          tl.set(slip, { opacity: 0 }, 0);
          tl.set(slip, { opacity: 1, x, y, rotation: 0 }, at);
          tl.to(slip, { x: 500 + (i % 3) * 14, y: y + 110 + i * 5, rotation: (i % 2 ? 1 : -1) * (20 + i * 4), duration: 0.42, ease: "power1.in" }, at);
          tl.to(slip, { opacity: 0, duration: 0.1 }, at + 0.34);
        });
        const rows = q(".ld-ledger-row");
        rows.forEach((row, i) => {
          tl.fromTo(row, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.14, ease: "power2.out" }, 1.3 + i * 0.1);
        });

        // Spring, 2 to 3: five shoots regrow from the same roots.
        grow("b", 5, 2.04, 0.1, 0.6);

        // Summer, 3 to 4: names hang from the stems.
        q(".ld-tag").forEach((tag, i) => {
          tl.fromTo(tag, { opacity: 0, rotation: i % 2 ? 9 : -9, transformOrigin: "50% 0%" }, { opacity: 1, rotation: 0, duration: 0.2, ease: "back.out(1.6)" }, 3.05 + i * 0.1);
        });

        // Keep the timeline exactly four units long: one unit per season.
        tl.to({}, { duration: 0.02 }, 3.98);

        ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: "+=300%",
          pin: true,
          scrub: 0.6,
          animation: tl,
          anticipatePin: 1,
          onUpdate: (self) => {
            const season = String(Math.min(3, Math.floor(self.progress * 4)));
            if (el.dataset.season !== season) el.dataset.season = season;
          },
        });
      }, el);
      return () => {
        ctx.revert();
        delete el.dataset.motion;
        el.dataset.season = "3";
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={root} id="seasons" className="ld-seasons" data-season="3" aria-labelledby="seasons-title">
      <div className="ld-tints" aria-hidden="true">
        <i className="ld-tint ld-tint-0" />
        <i className="ld-tint ld-tint-1" />
        <i className="ld-tint ld-tint-2" />
        <i className="ld-tint ld-tint-3" />
      </div>
      <div className="ld-wrap ld-seasons-in">
        <header className="ld-seasons-head">
          <div className="ld-seasons-title">
            <p className="ld-eyebrow">The name in motion</p>
            <h2 id="seasons-title" className="ld-h2">
              {SEASONS.headline}
            </h2>
            <p className="ld-sub">{SEASONS.subhead}</p>
          </div>
          <ol className="ld-season-tabs" aria-hidden="true">
            {SEASONS.seasons.map((s, i) => (
              <li key={s.name} className="ld-stab lg-sc" data-i={i}>
                {s.name}
              </li>
            ))}
          </ol>
        </header>

        <div className="ld-book">
          <div className="ld-page ld-page-left">
            <div className="ld-captions">
              {SEASONS.seasons.map((s, i) => (
                <article key={s.name} className="ld-caption" data-i={i}>
                  <p className="lg-sc ld-caption-season">{s.name}</p>
                  <h3 className="ld-h3">{s.line}</h3>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="ld-scene-wrap">
            <Scene />
          </div>

          <div className="ld-page ld-page-right">
            <p className="lg-sc ld-ledger-title">Kept on file</p>
            <ul className="ld-ledger-rows">
              {SEASONS.rows.map((row) => (
                <li key={row.what} className="ld-ledger-row">
                  <span className="lg-margin">25-26</span>
                  <span className="ld-ledger-what">
                    <strong>{row.who}</strong> {row.what}
                  </span>
                  <span className="ld-ledger-when lg-num">{row.when}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
