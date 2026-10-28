import { useId } from "react";
import { SHOOTS_FIVE, SHOOTS_THREE, ShootSet, Stump, STOOL_VIEWBOX, pointOnShoot, shootTips } from "../stool";
import { SEASONS } from "./copy";

// The stump with its shoots, the claim tags of winter and spring, and the names that hang from the
// regrown shoots. Every moving part has a class the timeline in seasons-timeline.ts looks up.

// Where the cut line stops, in scene units: just above the stump.
export const CUT_Y = 262;
const LABEL_T = [0.6, 0.64, 0.66, 0.62, 0.58];
const LABEL_DX = [-6, -4, 4, 4, 6];
// Where the three claim tags hang on the autumn shoots.
const CLAIM_SHOOT = [0, 2, 1];
const CLAIM_T = [0.84, 0.55, 0.92];
const CLAIM_DX = [-10, 4, 4];

// The stage glyph beside the claimed company, drawn in scene units around (0, 0): a ring with the
// first quarter filled (Contacted) and the second quarter added on a reply (Replied).
const GLYPH_R = 5.2;
const GLYPH_Q1 = `M0 0V${-GLYPH_R}A${GLYPH_R} ${GLYPH_R} 0 0 1 ${GLYPH_R} 0z`;
const GLYPH_Q2 = `M0 0H${GLYPH_R}A${GLYPH_R} ${GLYPH_R} 0 0 1 0 ${GLYPH_R}z`;

export function Scene() {
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
    // The claimed tag is wider: the stage glyph sits on its left and the ribbon hangs on its right.
    const w = Math.round(tag.name.length * 7.4 + 22 + (tag.mine ? 36 : 0));
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
              <text x={tag.x} y={tag.y + 32.5} textAnchor="middle" fontSize={14} fontWeight={500} fill="var(--ink)">
                {tag.name}
              </text>
              {tag.mine && (
                <g className="ld-claim-glyph" transform={`translate(${tag.x - tag.w / 2 + 15} ${tag.y + 27})`} fill="none" stroke="var(--ink)" strokeWidth={1.3} aria-hidden="true">
                  <circle r={GLYPH_R} />
                  <path d={GLYPH_Q1} fill="var(--ink)" />
                  <path className="ld-glyph-q2" d={GLYPH_Q2} fill="var(--ink)" />
                </g>
              )}
              {(tag.mine || !tag.note) && (
                // The outlined Claim button of a company nobody holds. On the claimed tag it hands over to the note.
                <g className={`ld-claim-free ${tag.mine ? "ld-claim-free-mine" : ""}`} fontSize={13.5} fontWeight={500}>
                  <rect x={tag.x - 28} y={tag.y + 46} width={56} height={24} rx={3} fill="var(--sheet)" stroke="var(--ink)" strokeWidth={1.2} />
                  <text x={tag.x} y={tag.y + 62.5} textAnchor="middle" fill="var(--ink)">
                    {SEASONS.freeChip}
                  </text>
                </g>
              )}
              {tag.note && (
                <g className={`ld-claim-note ${tag.mine ? "ld-claim-note-mine" : ""}`}>
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
