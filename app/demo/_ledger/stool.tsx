import { useId, type ReactNode, type SVGProps } from "react";

// The coppice stool: a low, wide cut stump seen slightly from above, with slender shoots rising
// from its rim. This file draws the large, engraved version (landing hero, name story, final call to
// action, empty states). The small mark for the spine is in logo.tsx and is drawn on its own grid.
//
// The geometry is computed from a few numbers per shoot and rounded to one decimal, so the server
// and the browser print identical attributes. Parts carry class names (lg-stump, lg-shoot,
// lg-leaf, lg-cut) so GSAP and CSS can reach them.

export const STOOL_VIEWBOX = { x: 0, y: -28, w: 480, h: 468 };

const STUMP = { cx: 240, cy: 330, rx: 150, ry: 38 };

const r1 = (n: number) => Math.round(n * 10) / 10;
const rimY = (x: number) => {
  const k = Math.max(0, 1 - ((x - STUMP.cx) / STUMP.rx) ** 2);
  return STUMP.cy - STUMP.ry * Math.sqrt(k);
};

export type ShootSpec = {
  // Where the shoot leaves the rim (x on the stump's top face).
  x: number;
  // Height of the shoot above the rim, and how far its tip leans sideways.
  h: number;
  lean: number;
  // How much the stem bows out on the way up.
  bow?: number;
  // How many leaves along the stem. A bud always sits at the tip.
  leaves: number;
  // Leaf length in px at the base of the stem.
  size?: number;
  // First leaf goes to the left (-1) or right (1).
  first?: -1 | 1;
};

type Leaf = { x: number; y: number; angle: number; len: number; t: number };
type BuiltShoot = { d: string; leaves: Leaf[]; tip: { x: number; y: number }; base: { x: number; y: number }; point: (t: number) => { x: number; y: number } };

function buildShoot(s: ShootSpec): BuiltShoot {
  const x0 = s.x;
  const y0 = rimY(s.x) + 3;
  const x3 = s.x + s.lean;
  const y3 = y0 - s.h;
  const bow = s.bow ?? 0;
  const x1 = x0 + bow;
  const y1 = y0 - s.h * 0.35;
  const x2 = x3 - bow * 0.6;
  const y2 = y0 - s.h * 0.72;
  const point = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    };
  };
  const tangent = (t: number) => {
    const u = 1 - t;
    const dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
    const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const size = s.size ?? 40;
  const first = s.first ?? 1;
  const leaves: Leaf[] = [];
  for (let k = 0; k < s.leaves; k++) {
    const t = s.leaves === 1 ? 0.55 : 0.3 + (0.58 * k) / (s.leaves - 1);
    const p = point(t);
    const side = (k % 2 === 0 ? first : -first) as 1 | -1;
    leaves.push({ x: r1(p.x), y: r1(p.y), angle: r1(tangent(t) + side * 58), len: r1(size * (1 - 0.4 * t)), t: r1(t) });
  }
  // The bud at the tip grows straight along the stem.
  leaves.push({ x: r1(x3), y: r1(y3), angle: r1(tangent(1)), len: r1(size * 0.55), t: 1 });
  return {
    d: `M${r1(x0)} ${r1(y0)} C${r1(x1)} ${r1(y1)} ${r1(x2)} ${r1(y2)} ${r1(x3)} ${r1(y3)}`,
    leaves,
    tip: { x: r1(x3), y: r1(y3) },
    base: { x: r1(x0), y: r1(y0) },
    point: (t: number) => {
      const p = point(t);
      return { x: r1(p.x), y: r1(p.y) };
    },
  };
}

// A point along a shoot's stem, t from 0 (the rim) to 1 (the tip). For labels hung from a stem.
export function pointOnShoot(spec: ShootSpec, t: number) {
  return buildShoot(spec).point(t);
}

// Three, five and many shoots: autumn, spring and the final sign-off.
export const SHOOTS_THREE: ShootSpec[] = [
  { x: 168, h: 212, lean: -46, bow: -14, leaves: 3, size: 44, first: -1 },
  { x: 244, h: 262, lean: 16, bow: 10, leaves: 4, size: 46, first: 1 },
  { x: 322, h: 192, lean: 52, bow: 16, leaves: 3, size: 42, first: 1 },
];

export const SHOOTS_FIVE: ShootSpec[] = [
  { x: 130, h: 168, lean: -38, bow: -12, leaves: 2, size: 38, first: -1 },
  { x: 188, h: 232, lean: -22, bow: -8, leaves: 3, size: 42, first: 1 },
  { x: 246, h: 276, lean: 10, bow: 8, leaves: 4, size: 46, first: -1 },
  { x: 304, h: 222, lean: 28, bow: 12, leaves: 3, size: 42, first: 1 },
  { x: 356, h: 160, lean: 44, bow: 14, leaves: 2, size: 38, first: -1 },
];

export const SHOOTS_MANY: ShootSpec[] = [
  { x: 112, h: 150, lean: -44, bow: -12, leaves: 2, size: 34, first: -1 },
  { x: 150, h: 214, lean: -34, bow: -10, leaves: 3, size: 38, first: 1 },
  { x: 194, h: 262, lean: -16, bow: -8, leaves: 4, size: 42, first: -1 },
  { x: 232, h: 300, lean: -2, bow: 6, leaves: 4, size: 44, first: 1 },
  { x: 270, h: 280, lean: 14, bow: 8, leaves: 4, size: 44, first: -1 },
  { x: 310, h: 238, lean: 30, bow: 10, leaves: 3, size: 40, first: 1 },
  { x: 348, h: 196, lean: 42, bow: 12, leaves: 3, size: 36, first: -1 },
  { x: 378, h: 140, lean: 38, bow: 10, leaves: 2, size: 32, first: 1 },
];

function leafPath(len: number): string {
  const a = r1(len * 0.26);
  const b = r1(len * 0.3);
  return `M0 0 C${r1(len * 0.22)} ${-a} ${r1(len * 0.68)} ${-b} ${len} 0 C${r1(len * 0.68)} ${b} ${r1(len * 0.22)} ${a} 0 0z`;
}

function leafVeins(len: number): string {
  const parts = [`M0 0 L${r1(len * 0.9)} 0`];
  for (let i = 1; i <= 3; i++) {
    const x = r1(len * 0.16 * i + len * 0.06);
    parts.push(`M${x} 0 L${r1(x + len * 0.13)} ${r1(len * 0.15)}`);
  }
  return parts.join(" ");
}

type ShootSetProps = {
  specs: ShootSpec[];
  // A prefix for the data attribute used to find each shoot ("a" gives data-shoot="a0").
  group?: string;
  engraved?: boolean;
};

// The shoots of one season. Each shoot is a group holding its stem (a path with pathLength 1, so a
// dash offset of 1 hides it and 0 shows it) and its leaves. A leaf is an outer group that places it
// and an inner group, .lg-leaf, that scales from the leaf's base.
export function ShootSet({ specs, group = "s", engraved = true }: ShootSetProps) {
  return (
    <g className="lg-shoots" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {specs.map((spec, i) => {
        const built = buildShoot(spec);
        return (
          <g key={i} className="lg-shoot" data-shoot={`${group}${i}`}>
            <path className="lg-stem" d={built.d} pathLength={1} strokeWidth={2.4} />
            <path className="lg-stem-thin" d={built.d} pathLength={1} strokeWidth={0.8} transform="translate(2.200 0)" />
            {built.leaves.map((leaf, k) => (
              <g key={k} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle})`}>
                <g className="lg-leaf" data-leaf={`${group}${i}-${k}`} data-t={leaf.t}>
                  <path d={leafPath(leaf.len)} strokeWidth={1.8} />
                  {engraved && <path d={leafVeins(leaf.len)} strokeWidth={0.8} />}
                </g>
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

// Where each shoot of a set ends, for labels and falling slips.
export function shootTips(specs: ShootSpec[]) {
  return specs.map((s) => {
    const b = buildShoot(s);
    return { x: b.tip.x, y: b.tip.y, base: b.base, leaves: b.leaves.map((l) => ({ x: l.x, y: l.y })) };
  });
}

type StumpProps = { engraved?: boolean };

// The stump: top face with growth rings, a bark wall with hatching on its shaded side, and root
// flares at the ground. Parts: .lg-stump-top (rim), .lg-stump-rings, .lg-stump-wall.
export function Stump({ engraved = true }: StumpProps) {
  const id = useId();
  const clip = `stump-${id.replace(/:/g, "")}`;
  const { cx, cy, rx, ry } = STUMP;
  const wall = `M${cx - rx} ${cy} L${cx - rx} ${cy + 32} C${cx - rx} ${cy + 54} ${cx - 80} ${cy + 68} ${cx} ${cy + 68} C${cx + 80} ${cy + 68} ${cx + rx} ${cy + 54} ${cx + rx} ${cy + 32} L${cx + rx} ${cy}`;
  const shade = `M${cx - rx} ${cy} L${cx - rx} ${cy + 32} C${cx - rx} ${cy + 54} ${cx - 80} ${cy + 68} ${cx} ${cy + 68} L${cx} ${cy + 4}z`;
  const hatch: ReactNode[] = [];
  for (let x = cx - rx - 40; x < cx + 10; x += 5) hatch.push(<path key={x} d={`M${x} ${cy + 76} L${x + 70} ${cy - 6}`} />);
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {engraved && (
        <>
          <defs>
            <clipPath id={clip}>
              <path d={shade} />
            </clipPath>
          </defs>
          <g className="lg-stump-hatch" clipPath={`url(#${clip})`} strokeWidth={0.8}>
            {hatch}
          </g>
        </>
      )}
      <path className="lg-stump-wall" d={wall} pathLength={1} strokeWidth={2.4} />
      <ellipse className="lg-stump-top" cx={cx} cy={cy} rx={rx} ry={ry} strokeWidth={2.4} pathLength={1} />
      <g className="lg-stump-rings" strokeWidth={1.3}>
        <ellipse cx={cx + 3} cy={cy - 1} rx={112} ry={28} />
        <ellipse cx={cx + 6} cy={cy} rx={74} ry={18} />
        <ellipse cx={cx + 8} cy={cy} rx={38} ry={9} />
        <ellipse cx={cx + 10} cy={cy + 0.5} rx={9} ry={2.200} strokeWidth={1.1} />
      </g>
      {engraved && (
        <g className="lg-stump-bark" strokeWidth={0.8}>
          <path d={`M${cx - 120} ${cy + 22} C${cx - 122} ${cy + 36} ${cx - 118} ${cy + 46} ${cx - 112} ${cy + 54}`} />
          <path d={`M${cx - 70} ${cy + 34} C${cx - 72} ${cy + 46} ${cx - 68} ${cy + 56} ${cx - 64} ${cy + 62}`} />
          <path d={`M${cx - 20} ${cy + 40} C${cx - 20} ${cy + 50} ${cx - 18} ${cy + 60} ${cx - 16} ${cy + 66}`} />
          <path d={`M${cx + 40} ${cy + 38} C${cx + 42} ${cy + 48} ${cx + 40} ${cy + 58} ${cx + 38} ${cy + 64}`} />
          <path d={`M${cx + 96} ${cy + 28} C${cx + 98} ${cy + 40} ${cx + 94} ${cy + 50} ${cx + 90} ${cy + 56}`} />
        </g>
      )}
      <g className="lg-stump-roots" strokeWidth={1.8}>
        <path d={`M${cx - rx} ${cy + 30} C${cx - rx - 16} ${cy + 36} ${cx - rx - 30} ${cy + 46} ${cx - rx - 46} ${cy + 50}`} />
        <path d={`M${cx + rx} ${cy + 30} C${cx + rx + 16} ${cy + 36} ${cx + rx + 30} ${cy + 46} ${cx + rx + 46} ${cy + 50}`} />
        <path d={`M${cx - 110} ${cy + 56} C${cx - 124} ${cy + 66} ${cx - 140} ${cy + 70} ${cx - 160} ${cy + 72}`} strokeWidth={1} />
        <path d={`M${cx + 110} ${cy + 56} C${cx + 124} ${cy + 66} ${cx + 140} ${cy + 70} ${cx + 160} ${cy + 72}`} strokeWidth={1} />
      </g>
    </g>
  );
}

type StoolProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  shoots?: ShootSpec[];
  engraved?: boolean;
  // Extra drawing inside the same coordinate space (labels, slips, a cut line).
  children?: ReactNode;
  title?: string;
};

// The whole stool: ground line, stump, and a set of shoots.
export function Stool({ shoots = SHOOTS_THREE, engraved = true, title, children, ...rest }: StoolProps) {
  return (
    <svg
      viewBox={`${STOOL_VIEWBOX.x} ${STOOL_VIEWBOX.y} ${STOOL_VIEWBOX.w} ${STOOL_VIEWBOX.h}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path className="lg-ground" d="M14 410 H466" fill="none" stroke="currentColor" strokeWidth={0.8} strokeDasharray="2 5" strokeLinecap="round" />
      <Stump engraved={engraved} />
      <ShootSet specs={shoots} engraved={engraved} />
      {children}
    </svg>
  );
}
