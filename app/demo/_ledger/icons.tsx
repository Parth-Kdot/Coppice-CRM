import { useId, type ReactNode, type SVGProps } from "react";
import type { Stage } from "@/demo/types";

// The Ledger icon set. Drawn for a 20 px grid with 1.5 px strokes and round caps. Where two lines
// meet, a second, thinner path (0.75 px) is drawn beside the main stroke so the line seems to swell
// and thin like a pen nib. No hatching below 32 px: the engraved variants at the bottom of this file
// are for 48 px and up (landing, empty states).

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// The thinner second path of the calligraphic strokes.
const THIN = 0.75;

export function QueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 5.5h9.5M7 10h9.5M7 14.5h6" />
      <path d="M7 7.3h9.5" strokeWidth={THIN} />
      <circle cx="3.6" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.8" y="3.8" width="4" height="12.4" rx="0.8" />
      <rect x="8" y="3.8" width="4" height="8.2" rx="0.8" />
      <rect x="13.2" y="3.8" width="4" height="10.4" rx="0.8" />
      <path d="M4 6.4h1.6M9.2 6.4h1.6M14.4 6.4h1.6" strokeWidth={THIN} />
    </Icon>
  );
}

export function CompaniesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.2 17V6.4L10 3.4l5.8 3V17M2.6 17h14.8" />
      <path d="M8 9.4h1M11 9.4h1M8 12.2h1M11 12.2h1" strokeWidth={THIN} />
      <path d="M9 17v-2.6h2V17" />
    </Icon>
  );
}

export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3v8.2M6.8 8.2 10 11.4l3.2-3.2" />
      <path d="M3.4 12.4v3a1.1 1.1 0 0 0 1.1 1.1h11a1.1 1.1 0 0 0 1.1-1.1v-3" />
      <path d="M5.6 14.4h8.8" strokeWidth={THIN} />
    </Icon>
  );
}

export function FactsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 2.9h7.3L15.8 6.4V16.6a.6.6 0 0 1-.6.6H5a.6.6 0 0 1-.6-.6V3.5a.6.6 0 0 1 .6-.6z" />
      <path d="M12.3 2.9v3.5h3.5" strokeWidth={THIN} />
      <path d="M7.2 11.6l1.7 1.7 3.4-3.7" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h2.3M9.1 6H17M3 10h8.2M14.8 10H17M3 14h1.6M8.4 14H17" />
      <circle cx="7.2" cy="6" r="1.9" />
      <circle cx="13" cy="10" r="1.9" />
      <circle cx="6.5" cy="14" r="1.9" />
      <path d="M7.2 4.6v.6" strokeWidth={THIN} />
    </Icon>
  );
}

// Claim: a bookmark, like the ribbon that marks your place in the book.
export function ClaimIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.4 3h9.2v14l-4.6-3.7L5.4 17z" />
      <path d="M7.4 5.4v7.6" strokeWidth={THIN} />
    </Icon>
  );
}

// Release: the bookmark lifted out, drawn broken, with an arrow.
export function ReleaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.4 17V3h9.2v14l-4.6-3.7" strokeDasharray="3 2.2" />
      <path d="M10 11.2V6.6M7.9 8.6 10 6.5l2.1 2.1" />
    </Icon>
  );
}

// Log: a quill.
export function LogIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16.6 3.4C11.8 3.3 8 6.1 6.7 10.7l-.9 3 3.1-.9c4.6-1.3 7.5-4.5 7.7-9.4z" />
      <path d="M4.9 15.3l6.6-6.7" strokeWidth={THIN} />
      <path d="M4.3 16.5l-1.1 1.1" />
    </Icon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.2" y="5" width="13.6" height="11.6" rx="1.2" />
      <path d="M3.2 8.6h13.6M7 3.2v3.2M13 3.2v3.2" />
      <path d="M7 12.2h.01M10 12.2h.01M13 12.2h.01" strokeWidth={1.8} />
    </Icon>
  );
}

// The hourglass. The glass is the same in every state; the sand says how much time is left.
//   empty:   no sand drawn, a plain glass (a follow-up that is still ahead)
//   half:    sand in both bulbs and a thin stream (due today, or a day or two late)
//   low:     most of the sand has run down (overdue)
//   drained: the top bulb is empty and the sand lies in the bottom (long overdue), with a heavier glass
export type HourglassFill = "empty" | "half" | "low" | "drained";

export function HourglassIcon({ sand = "empty", ...props }: IconProps & { sand?: HourglassFill }) {
  const heavy = sand === "drained";
  return (
    <Icon {...props}>
      <path d="M5.8 3h8.4M5.8 17h8.4" strokeWidth={heavy ? 1.9 : 1.5} />
      <path d="M6.8 3c0 3.2 3.2 4 3.2 7s-3.2 3.8-3.2 7M13.2 3c0 3.2-3.2 4-3.2 7s3.2 3.8 3.2 7" strokeWidth={heavy ? 1.9 : 1.5} />
      {sand === "empty" && <path d="M8.6 15.4h2.8" strokeWidth={THIN} />}
      {sand === "half" && (
        <>
          <path d="M8.1 5.2h3.8L10 8.4z" fill="currentColor" strokeWidth={0.6} />
          <path d="M10 8.6v3.6" strokeWidth={THIN} />
          <path d="M8.2 15.6h3.6L10 13.2z" fill="currentColor" strokeWidth={0.6} />
        </>
      )}
      {sand === "low" && (
        <>
          <path d="M9.1 7.3h1.8L10 8.6z" fill="currentColor" strokeWidth={0.6} />
          <path d="M10 8.8v3.2" strokeWidth={THIN} />
          <path d="M7.6 15.7h4.8L10 12.3z" fill="currentColor" strokeWidth={0.6} />
        </>
      )}
      {sand === "drained" && <path d="M7.2 15.7h5.6c-.2-1.9-1.5-2.9-2.8-4.6-1.3 1.7-2.6 2.7-2.8 4.6z" fill="currentColor" strokeWidth={0.6} />}
    </Icon>
  );
}

// The original single-state hourglass, kept for places that only need the glass.
export function OverdueIcon(props: IconProps) {
  return <HourglassIcon sand="empty" {...props} />;
}

// Duplicate: two overlapping slips.
export function DuplicateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.4" y="6.6" width="9" height="10.4" rx="0.9" />
      <path d="M7.4 5V3.9a.9.9 0 0 1 .9-.9h7.4a.9.9 0 0 1 .9.9v8.4a.9.9 0 0 1-.9.9h-1.4" />
      <path d="M5.6 10.4h4.6M5.6 13h4.6" strokeWidth={THIN} />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.4 10.6l3.7 3.7L15.6 5.9" />
    </Icon>
  );
}

export function CopyLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.6 11.4a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" />
      <path d="M11.4 8.6a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
    </Icon>
  );
}

// AI draft: a quill with a small spark.
export function AiDraftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.6 7.4C10.2 7.3 7.5 9.2 6.5 12.5l-.7 2.3 2.3-.7c3.3-1 5.2-3.3 5.5-6.7z" />
      <path d="M4.6 15.9l5.1-5" strokeWidth={THIN} />
      <path d="M4.1 16.9l-.9.9" />
      <path d="M15.4 2.4v3.4M13.7 4.1h3.4" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.8" cy="8.8" r="5.2" />
      <path d="M12.6 12.6l4 4" />
      <path d="M6.3 8.2A2.7 2.7 0 0 1 8.4 6.2" strokeWidth={THIN} />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="6.6" r="3" />
      <path d="M4 17c.4-3.2 2.9-5 6-5s5.6 1.8 6 5" />
      <path d="M7.6 6.2a2.5 2.5 0 0 1 1.6-1.7" strokeWidth={THIN} />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.2 17.4 16.4H2.6z" />
      <path d="M10 8.4v3.8" />
      <path d="M10 14.2h.01" strokeWidth={1.9} />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.6 4.6 13 10l-5.4 5.4" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 7.6 10 13l5.4-5.4" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.4 4.6 7 10l5.4 5.4" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4.2v11.6M4.2 10h11.6" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.2 4.2H4.6a1 1 0 0 0-1 1v10.2a1 1 0 0 0 1 1h10.2a1 1 0 0 0 1-1v-3.6" />
      <path d="M11.4 3.6h5v5M16.4 3.6l-7 7" />
    </Icon>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="14" height="11" rx="1.6" />
      <path d="M6.4 8.4h.01M9 8.4h.01M11.6 8.4h.01M14 8.4h.01M6.4 11.6h7.2" strokeWidth={1.4} />
    </Icon>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.8 7.2 8 13a1.9 1.9 0 0 1-2.7-2.7l6.3-6.3a3.1 3.1 0 0 1 4.4 4.4l-6.5 6.5a4.3 4.3 0 0 1-6-6" />
    </Icon>
  );
}

// A small engraved glyph per stage: an empty ring, then the ring filling by quarters, a tick when it
// is committed, a dash when it is declined. Always printed beside the stage name.
export function StageGlyph({ stage, size = 14, ...rest }: Omit<SVGProps<SVGSVGElement>, "children"> & { stage: Stage; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <circle cx="7" cy="7" r="5.2" fill={stage === "COMMITTED" ? "currentColor" : "none"} />
      {stage === "CONTACTED" && <path d="M7 7V1.8A5.2 5.2 0 0 1 12.2 7z" fill="currentColor" />}
      {stage === "REPLIED" && <path d="M7 1.8A5.2 5.2 0 0 1 7 12.2z" fill="currentColor" />}
      {stage === "IN_CONVERSATION" && <path d="M7 7V1.8A5.2 5.2 0 1 1 1.8 7z" fill="currentColor" />}
      {stage === "COMMITTED" && <path d="M4.5 7.2 6.3 9l3.3-3.7" stroke="var(--paper)" strokeWidth={1.4} />}
      {stage === "DECLINED" && <path d="M4.6 7h4.8" />}
    </svg>
  );
}

// A sprout for empty states, small and drawn once. The big, engraved versions live in stool.tsx.
export function SproutIcon({ size = 36, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path className="lg-sprout-soil" d="M6 30h24" />
      <path className="lg-sprout-stem" pathLength={1} d="M18 30c0-5 .4-9 .2-13" />
      <path className="lg-sprout-leaf lg-sprout-leaf-l" d="M18.1 21.5c-3.6.4-6.6-1.2-7.6-5.3 3.7-.5 6.8 1 7.6 5.3z" />
      <path className="lg-sprout-leaf lg-sprout-leaf-r" d="M18.2 17.8c.3-4.2 3-7 7.4-7.3.1 4.4-2.6 7.2-7.4 7.3z" />
    </svg>
  );
}

// ----- Engraved variants: 48 px and up, with fine parallel hatching -----

type EngravedProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

// Diagonal hatching lines across the 48 x 48 box, clipped by the caller to the shape they shade.
function hatchLines(spacing = 3, from = -48, to = 96): ReactNode {
  const lines: ReactNode[] = [];
  for (let x = from; x <= to; x += spacing) {
    lines.push(<path key={x} d={`M${x} 48 L${x + 48} 0`} />);
  }
  return lines;
}

function Engraved({ size = 48, shape, shade, detail, ...rest }: EngravedProps & { shape: ReactNode; shade?: ReactNode; detail?: ReactNode }) {
  const id = useId();
  const clip = `eng-${id.replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <defs>
        <clipPath id={clip}>{shade}</clipPath>
      </defs>
      <g className="lg-eng-hatch" clipPath={`url(#${clip})`} strokeWidth={0.7}>
        {hatchLines()}
      </g>
      <g strokeWidth={1.6}>{shape}</g>
      <g strokeWidth={0.8}>{detail}</g>
    </svg>
  );
}

export function EngravedClaim(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={<path d="M13 5h22v38l-11-9-11 9z" />}
      shade={<path d="M13 5h11v29l-11 9z" />}
      detail={<path d="M17.5 5v31M30.5 9v22" />}
    />
  );
}

export function EngravedQueue(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <rect x="7" y="8" width="34" height="8" rx="1.4" />
          <rect x="7" y="20" width="34" height="8" rx="1.4" />
          <rect x="7" y="32" width="22" height="8" rx="1.4" />
        </>
      }
      shade={
        <>
          <rect x="7" y="8" width="9" height="8" />
          <rect x="7" y="20" width="9" height="8" />
          <rect x="7" y="32" width="9" height="8" />
        </>
      }
      detail={<path d="M21 12h14M21 24h14M21 36h4" />}
    />
  );
}

export function EngravedBoard(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <rect x="6" y="7" width="10" height="34" rx="1.4" />
          <rect x="19" y="7" width="10" height="22" rx="1.4" />
          <rect x="32" y="7" width="10" height="28" rx="1.4" />
        </>
      }
      shade={
        <>
          <rect x="6" y="7" width="5" height="34" />
          <rect x="19" y="7" width="5" height="22" />
          <rect x="32" y="7" width="5" height="28" />
        </>
      }
      detail={<path d="M9 13h4M22 13h4M35 13h4M9 18h4M22 18h4M35 18h4" />}
    />
  );
}

export function EngravedLog(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={<path d="M40 7C28.6 6.8 19.6 13.4 16.4 24.6l-2.3 7.5 7.5-2.2C32.8 26.700 39.800 19 40 7z" />}
      shade={<path d="M40 7C28.6 6.8 19.6 13.4 16.4 24.6l7.2.6C31 22 37 16 40 7z" />}
      detail={<path d="M11.700 36.300 28 20M10 40l-3 3" />}
    />
  );
}

export function EngravedDuplicate(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <rect x="7" y="15" width="22" height="26" rx="1.6" />
          <path d="M17 11V8.600A1.600 1.600 0 0 1 18.600 7H39.400A1.600 1.600 0 0 1 41 8.600V30.400A1.600 1.600 0 0 1 39.400 32H33" />
        </>
      }
      shade={<rect x="7" y="15" width="10" height="26" />}
      detail={<path d="M21 24h4M21 30h4M21 36h4M23 12h12M23 17h12" />}
    />
  );
}

export function EngravedImport(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <path d="M24 6v20M16 18l8 8 8-8" />
          <path d="M7 29v8a3 3 0 0 0 3 3h28a3 3 0 0 0 3-3v-8z" />
        </>
      }
      shade={<path d="M7 29v8a3 3 0 0 0 3 3h12V29z" />}
      detail={<path d="M13 34h22" />}
    />
  );
}

export function EngravedDraft(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <path d="M33 17C23.500 16.800 16.400 22 13.800 30.800l-1.900 6 6-1.800C26.700 32.300 32.600 26 33 17z" />
          <path d="M38 5v9M33.500 9.500h9" />
        </>
      }
      shade={<path d="M33 17C23.500 16.800 16.400 22 13.800 30.800l5.600.4C26 28 31 23 33 17z" />}
      detail={<path d="M10.500 38.500 24 25M9 42l-3 3" />}
    />
  );
}

// History that survives turnover: a cut stump with its rings.
export function EngravedHistory(props: EngravedProps) {
  return (
    <Engraved
      {...props}
      shape={
        <>
          <ellipse cx="24" cy="18" rx="15" ry="6.500" />
          <path d="M9 18v14c0 3.600 6.700 6.500 15 6.500S39 35.600 39 32V18" />
        </>
      }
      shade={<path d="M9 18v14c0 3.600 6.700 6.500 15 6.500V24.500z" />}
      detail={
        <>
          <ellipse cx="24" cy="18" rx="9.500" ry="3.800" />
          <ellipse cx="24" cy="18" rx="4.500" ry="1.800" />
        </>
      }
    />
  );
}
