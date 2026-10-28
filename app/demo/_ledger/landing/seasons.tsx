"use client";

import { useEffect, useId, useRef } from "react";
import { Tick, TurnoverRule } from "../marks";
import { SHOOTS_FIVE, SHOOTS_THREE, ShootSet, Stump, STOOL_VIEWBOX, pointOnShoot, shootTips } from "../stool";
import { SEASONS } from "./copy";
import { heroFinal } from "./hero-script";
import { MiniQueue } from "./mini-queue";
import { MOTION_OK, setupGsap } from "./motion";

// How it works, as one pinned scene about 150 vh long, scrubbed by the scroll position. Four seasons
// of a board, each one a step of the product:
//   Autumn, Import: three shoots grow and the imported sheet is noted on the right page.
//   Winter, Claim: company names hang from the stems; a gilt ribbon drops on the one you claim.
//   Spring, Log and follow up: the log entries are written into the ledger.
//   Summer, Turnover: a clean cut sweeps down, the leaves fall as slips, a double rule closes the
//     board year and five shoots regrow from the same roots, the names hanging from them again.
// Then the scene settles into a framed render of the real queue page, which is where the work happens.
// Without motion (or script) the section is a plain page: the scene in summer, the four steps as
// captions, the ledger, and the framed queue below.

const CUT_Y = 262;
const TOTAL = 5;
const LABEL_T = [0.6, 0.64, 0.66, 0.62, 0.58];
const LABEL_DX = [-6, -4, 4, 4, 6];
// Where the three claim tags hang on the autumn shoots.
const CLAIM_SHOOT = [0, 2, 1];
const CLAIM_T = [0.84, 0.55, 0.92];
const CLAIM_DX = [-10, 4, 4];

function Scene() {
  const id = useId().replace(/:/g, "");
  const cutId = `cut-${id}`;
  const tipsA = shootTips(SHOOTS_THREE);
  const slipSources = tipsA
    .flatMap((s) => s.leaves.slice(0, -1))
    .sort((a, b) => a.y - b.y)
    .slice(0, 8);
  const tagsB = SHOOTS_FIVE.map((spec, i) => {
    const p = pointOnShoot(spec, LABEL_T[i]);
    const text = SEASONS.labels[i];
    const w = Math.round(text.length * 7.4 + 22);
    return { x: p.x + LABEL_DX[i], y: p.y, w, text };
  });
  const tagsA = SEASONS.claimTags.map((tag, i) => {
    const p = pointOnShoot(SHOOTS_THREE[CLAIM_SHOOT[i]], CLAIM_T[i]);
    // The claimed tag is wider on the right, where the ribbon hangs.
    const w = Math.round(tag.name.length * 7.4 + 22 + (tag.mine ? 18 : 0));
    return { ...tag, x: p.x + CLAIM_DX[i], y: p.y, w };
  });
  return (
    <svg
      className="ld-scene"
      viewBox={`${STOOL_VIEWBOX.x} ${STOOL_VIEWBOX.y} ${STOOL_VIEWBOX.w} ${STOOL_VIEWBOX.h}`}
      role="img"
      aria-label="A cut stump. In autumn three shoots grow and company names hang from them, one with a gold ribbon. After the cut, five shoots regrow from the same roots and the company names hang from them again."
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
        <g className="ld-claim-tags" fontFamily="var(--font-sans)">
          {tagsA.map((tag, i) => (
            <g key={tag.name} className="ld-claim-tag" data-i={i}>
              <path d={`M${tag.x} ${tag.y} v14`} fill="none" stroke="currentColor" strokeWidth={1} />
              <rect x={tag.x - tag.w / 2} y={tag.y + 14} width={tag.w} height={26} rx={2} fill="var(--sheet)" stroke="currentColor" strokeWidth={1.3} />
              <circle cx={tag.x} cy={tag.y + 19} r={1.6} fill="currentColor" />
              <text x={tag.x - (tag.mine ? 9 : 0)} y={tag.y + 32.5} textAnchor="middle" fontSize={14} fontWeight={500} fill="var(--ink)">
                {tag.name}
              </text>
              {tag.note && (
                <g className="ld-claim-note">
                  <rect
                    x={tag.x - tag.w / 2 - 6}
                    y={tag.y + 46}
                    width={tag.w + 12}
                    height={24}
                    rx={tag.mine ? 3 : 12}
                    fill={tag.mine ? "var(--ink)" : "var(--sheet)"}
                    stroke="var(--ink)"
                    strokeWidth={1.2}
                    strokeDasharray={tag.mine ? undefined : "4 3"}
                  />
                  <text x={tag.x} y={tag.y + 62.5} textAnchor="middle" fontSize={13.5} fontWeight={500} fill={tag.mine ? "var(--paper)" : "var(--ink)"}>
                    {tag.note}
                  </text>
                </g>
              )}
              {tag.mine && (
                <g className="ld-claim-ribbon" aria-hidden="true">
                  <path d={`M${tag.x + tag.w / 2 - 20} ${tag.y + 10} h12 v26 l-6 -6 l-6 6z`} fill="var(--gilt)" />
                </g>
              )}
            </g>
          ))}
        </g>
      </g>
      <g className="ld-shoots-b">
        <ShootSet specs={SHOOTS_FIVE} group="b" />
      </g>
      <path className="ld-cutline" d="M44 0 H436 M44 -5 V5 M436 -5 V5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="7 5" />
      {slipSources.map((leaf, i) => (
        <g key={i} className="ld-slip" data-x={leaf.x} data-y={leaf.y} transform={`translate(${leaf.x} ${leaf.y})`}>
          <rect x={-10} y={-6.5} width={20} height={13} rx={1.6} fill="var(--sheet)" stroke="currentColor" strokeWidth={1.2} />
          <path d="M-6 -2h12M-6 2h8" stroke="currentColor" strokeWidth={0.8} strokeLinecap="round" />
        </g>
      ))}
      <g className="ld-tags" fontFamily="var(--font-sans)">
        {tagsB.map((tag, i) => (
          <g key={tag.text} className="ld-tag" data-i={i}>
            <path d={`M${tag.x} ${tag.y} v16`} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={tag.x - tag.w / 2} y={tag.y + 16} width={tag.w} height={26} rx={2} fill="var(--sheet)" stroke="currentColor" strokeWidth={1.3} />
            <circle cx={tag.x} cy={tag.y + 21} r={1.6} fill="currentColor" />
            <text x={tag.x} y={tag.y + 34.5} textAnchor="middle" fontSize={14} fontWeight={500} fill="var(--ink)">
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

        // Autumn, 0 to 1. Import: three shoots grow and the imported sheet is noted on the right page.
        grow("a", 3, 0.04, 0.1, 0.5);
        tl.fromTo(q(".ld-import-card"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, 0.5);

        // Winter, 1 to 2. Claim: names hang from the stems, a gilt ribbon drops on the one you claim.
        q(".ld-claim-tag").forEach((tag, i) => {
          tl.fromTo(tag, { opacity: 0, rotation: i % 2 ? 8 : -8, transformOrigin: "50% 0%" }, { opacity: 1, rotation: 0, duration: 0.2, ease: "back.out(1.6)" }, 1.04 + i * 0.1);
        });
        q(".ld-claim-note").forEach((note, i) => {
          tl.fromTo(note, { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "power1.out" }, 1.52 + i * 0.12);
        });
        tl.fromTo(q(".ld-claim-ribbon"), { scaleY: 0, transformOrigin: "50% 0%" }, { scaleY: 1, duration: 0.18, ease: "back.out(2)" }, 1.46);

        // Spring, 2 to 3. Log and follow up: the entries are written into the ledger.
        tl.fromTo(q(".ld-kept-title"), { opacity: 0 }, { opacity: 1, duration: 0.12 }, 2.0);
        q(".ld-ledger-row").forEach((row, i) => {
          tl.fromTo(row, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.14, ease: "power2.out" }, 2.04 + i * 0.12);
        });

        // Summer, 3 to 4. Turnover: a clean cut sweeps down to the stump, the leaves fall as slips,
        // the double rule closes the board year, five shoots regrow and the names hang again.
        const rect = el.querySelector(".ld-cut-rect");
        const line = el.querySelector(".ld-cutline");
        tl.to(q(".ld-claim-tags"), { opacity: 0, duration: 0.12 }, 3.0);
        tl.fromTo(line, { y: -36, opacity: 0 }, { opacity: 1, duration: 0.05 }, 3.0);
        tl.to(line, { y: CUT_Y, duration: 0.4, ease: "power1.inOut" }, 3.02);
        tl.to(rect, { attr: { y: CUT_Y, height: 460 - CUT_Y }, duration: 0.4, ease: "power1.inOut" }, 3.02);
        tl.to(line, { opacity: 0, duration: 0.1 }, 3.42);

        el.querySelectorAll<SVGGElement>(".ld-slip").forEach((slip, i) => {
          const x = Number(slip.dataset.x);
          const y = Number(slip.dataset.y);
          const at = 3.02 + 0.4 * ((y + 36) / (CUT_Y + 36));
          tl.set(slip, { opacity: 0 }, 0);
          tl.set(slip, { opacity: 1, x, y, rotation: 0 }, at);
          tl.to(slip, { x: 500 + (i % 3) * 14, y: y + 110 + i * 5, rotation: (i % 2 ? 1 : -1) * (20 + i * 4), duration: 0.34, ease: "power1.in" }, at);
          tl.to(slip, { opacity: 0, duration: 0.08 }, at + 0.28);
        });
        tl.fromTo(q(".ld-turnover-wrap"), { opacity: 0, scaleX: 0.2, transformOrigin: "0% 50%" }, { opacity: 1, scaleX: 1, duration: 0.3, ease: "power2.out" }, 3.3);

        grow("b", 5, 3.4, 0.07, 0.45);
        q(".ld-tag").forEach((tag, i) => {
          tl.fromTo(tag, { opacity: 0, rotation: i % 2 ? 9 : -9, transformOrigin: "50% 0%" }, { opacity: 1, rotation: 0, duration: 0.16, ease: "back.out(1.6)" }, 3.78 + i * 0.05);
        });

        // The queue, 4 to 5: the book gives way to a framed render of the real queue page.
        tl.to(q(".ld-book"), { opacity: 0, scale: 0.97, duration: 0.4, ease: "power1.in" }, 4.0);
        tl.fromTo(q(".ld-frame"), { opacity: 0, y: 28, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, 4.3);

        // Keep the timeline exactly five units long.
        tl.to({}, { duration: 0.02 }, TOTAL - 0.02);

        ScrollTrigger.create({
          trigger: el,
          start: "top top",
          end: "+=150%",
          pin: true,
          scrub: 0.6,
          animation: tl,
          anticipatePin: 1,
          onUpdate: (self) => {
            const season = String(Math.min(4, Math.floor(self.progress * TOTAL)));
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
    <section ref={root} id="how" className="ld-seasons" data-season="3" aria-labelledby="seasons-title">
      <div className="ld-tints" aria-hidden="true">
        <i className="ld-tint ld-tint-0" />
        <i className="ld-tint ld-tint-1" />
        <i className="ld-tint ld-tint-2" />
        <i className="ld-tint ld-tint-3" />
      </div>
      <div className="ld-wrap ld-seasons-in">
        <header className="ld-seasons-head">
          <div className="ld-seasons-title">
            <p className="ld-eyebrow">How it works</p>
            <h2 id="seasons-title" className="ld-h2">
              {SEASONS.headline}
            </h2>
            <p className="ld-sub">{SEASONS.subhead}</p>
          </div>
          <ol className="ld-season-tabs" aria-hidden="true">
            {SEASONS.steps.map((s, i) => (
              <li key={s.season} className="ld-stab" data-i={i}>
                <span className="lg-sc ld-stab-season">{s.season}</span>
                <span className="ld-stab-step">{s.tab}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className="ld-stage">
          <div className="ld-book">
            <div className="ld-page ld-page-left">
              <ol className="ld-captions">
                {SEASONS.steps.map((s, i) => (
                  <li key={s.season} className="ld-caption" data-i={i}>
                    <p className="lg-sc ld-caption-season">
                      {s.season}, step {i + 1} of 4
                    </p>
                    <h3 className="ld-h3">{s.title}</h3>
                    <p>{s.body}</p>
                    <p className="ld-caption-who lg-sc">{s.who}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="ld-scene-wrap">
              <Scene />
            </div>

            <div className="ld-page ld-page-right">
              <div className="ld-import-card">
                <p className="lg-sc ld-ledger-title">{SEASONS.imported.title}</p>
                <p className="ld-import-line">
                  <Tick size={20} auto={false} className="lg-tick-draw" />
                  <span>{SEASONS.imported.body}</span>
                </p>
              </div>
              <p className="lg-sc ld-ledger-title ld-kept-title">Kept on file</p>
              <ul className="ld-ledger-rows">
                {SEASONS.rows.map((row) => (
                  <li key={row.what} className="ld-ledger-row">
                    <span className="lg-margin">26-27</span>
                    <span className="ld-ledger-what">
                      <strong>{row.who}</strong> {row.what}
                    </span>
                    <span className="ld-ledger-when lg-num">{row.when}</span>
                  </li>
                ))}
              </ul>
              <div className="ld-turnover-wrap">
                <TurnoverRule endsYear="2026-27" />
              </div>
            </div>
          </div>

          <figure className="ld-frame">
            <div className="ld-frame-win ldm-wrap">
              <MiniQueue state={heroFinal()} />
            </div>
            <figcaption>
              <span className="ld-frame-title">{SEASONS.queue.title}</span>
              <span className="ld-frame-body">{SEASONS.queue.body}</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
