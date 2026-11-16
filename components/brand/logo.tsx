import type { SVGProps } from "react";

// The Coppice mark: a low, wide cut stump seen from slightly above, two growth rings on its face,
// three slender shoots from the rim with one or two leaves each. Moss ink, drawn line by line on its
// own 48 px grid so it holds up small (the spine uses it at 40 px). The big engraved version is the
// Stool in stool.tsx.

type MarkProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; title?: string };

export function LogoMark({ size = 40, title, ...rest }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {/* the stump: wall, face, two rings */}
      <path d="M10.800 33.400v4.600c0 2.600 5.800 4.600 13.200 4.600s13.200-2 13.200-4.600v-4.600" />
      <ellipse cx="24" cy="33.400" rx="13.200" ry="4.200" />
      <ellipse cx="24.800" cy="33.200" rx="7.400" ry="2.100" strokeWidth={1.1} />
      {/* shoots */}
      <path d="M16.200 31.600C15.400 26.400 12.800 22.200 11.200 15.600" />
      <path d="M24 29.800C24.600 23.400 23.200 16.200 25.200 7.400" />
      <path d="M32 31.600C33 27.400 36 23.400 38 17.200" />
      {/* leaves */}
      <path d="M13.800 21.600c-3.600 0-5.600-1.800-6.200-4.800 3.600 0 5.600 1.800 6.200 4.800z" strokeWidth={1.2} />
      <path d="M11.300 15.800c.2-3 2.200-4.800 5-5-.2 3-2.200 4.800-5 5z" strokeWidth={1.2} />
      <path d="M24.200 19.800c3.200-.2 5.400-2 6-4.800-3.200.2-5.400 2-6 4.800z" strokeWidth={1.2} />
      <path d="M25.200 7.600c-2.400-.4-3.800-2-4-4.200 2.400.3 3.800 2 4 4.200z" strokeWidth={1.2} />
      <path d="M35.200 22.600c3.200.4 5.400-.8 6.400-3.600-3.200-.4-5.400.8-6.400 3.600z" strokeWidth={1.2} />
      <path d="M38.100 17.400c-.4-3-2.400-4.600-5.200-4.600.4 3 2.400 4.600 5.200 4.600z" strokeWidth={1.2} />
    </svg>
  );
}

type WordmarkProps = { className?: string };

// "Coppice" in Libre Caslon Text bold, slightly tracked.
function Wordmark({ className = "" }: WordmarkProps) {
  return <span className={`font-display font-bold tracking-[0.01em] ${className}`}>Coppice</span>;
}

// The mark and the word together, for the landing nav and the sign-in page.
export function Logo({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-moss ${className}`}>
      <LogoMark size={size} />
      <Wordmark className="text-[1.35rem] leading-none text-ink" />
    </span>
  );
}
