import { useId } from "react";

// The Time Capsule's ink stamp: a round moss seal with the board's year printed around its rim and a
// sprout in the middle, tilted a little like a stamp pressed by hand. Decorative: the page's own
// text says everything. Drawn with plain SVG attributes, so the strict style policy allows it.
export function CapsuleStamp({ label, size = 148, className = "" }: { label: string; size?: number; className?: string }) {
  const path = `cap-rim-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className={`lg-cap-stamp ${className}`.trim()} width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true" focusable="false">
      <circle cx="80" cy="80" r="74" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="80" cy="80" r="68" stroke="currentColor" strokeWidth="1" />
      <circle cx="80" cy="80" r="42" stroke="currentColor" strokeWidth="1.2" />
      <defs>
        <path id={path} d="M80 80 m-55 0 a55 55 0 1 1 110 0 a55 55 0 1 1 -110 0" />
      </defs>
      <text fontFamily="var(--font-display), Georgia, serif" fontSize="13.5" letterSpacing="3.2" fill="currentColor">
        <textPath href={`#${path}`} startOffset="0">
          {`COPPICE  ·  BOARD OF ${label}  ·  `}
        </textPath>
      </text>
      <g data-mark="" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M80 108V78" />
        <path d="M80 86C80 74 70 66 58 66c0 12 9 20 22 20Z" fill="currentColor" fillOpacity="0.18" />
        <path d="M80 80C80 69 89 61 101 61c0 11-8 19-21 19Z" fill="currentColor" fillOpacity="0.18" />
        <path d="M68 108h24" />
      </g>
    </svg>
  );
}
