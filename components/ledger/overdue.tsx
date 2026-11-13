import { HourglassIcon, type HourglassFill } from "./icons";

// How late a follow-up is, in one place. Every screen that shows overdue text (queue, board slips,
// company page, palette results, the landing mini app) calls overdueLevel() and draws
// the result with <OverdueMark>, so the thresholds and the treatments never drift apart.
//
//   upcoming  due in the future            ink-2 text, plain hourglass
//   today     due today                    ink text, hourglass with sand in both bulbs
//   late      1 to 2 days overdue          ink text, same hourglass, no rust
//   overdue   3 to 6 days overdue          rust text, rust hourglass, a small mound of sand below
//   long      7 or more days overdue       rust semibold text, heavy hourglass with no sand, and the row
//                                          gets a 3 px rust rule in its margin (class lg-rule-row, data-od="long")
//
// Rust always comes with words and a glass, never as a color alone, and never as a filled background.
//
// shortDue(days) is the compact wording for tight layouts: "Due today" | "9d late" | "In 3d".

export type OverdueLevel = "upcoming" | "today" | "late" | "overdue" | "long";

// Days past the follow-up date: zero all of the due day, negative before it.
export function overdueLevel(days: number): OverdueLevel {
  if (days < 0) return "upcoming";
  if (days === 0) return "today";
  if (days <= 2) return "late";
  if (days <= 6) return "overdue";
  return "long";
}

const FILL: Record<OverdueLevel, HourglassFill> = {
  upcoming: "empty",
  today: "half",
  late: "half",
  overdue: "low",
  long: "drained",
};

// "Due in 4 days" for the coming week, "Due Nov 2" after that. `dueOn` is the short date ("Nov 2").
export function overdueText(days: number, dueOn?: string): string {
  if (days > 0) return days === 1 ? "1 day overdue" : `${days} days overdue`;
  if (days === 0) return "Due today";
  if (days === -1) return "Due tomorrow";
  if (days >= -7 || !dueOn) return `Due in ${-days} days`;
  return `Due ${dueOn}`;
}

// The compact form for tight places (the queue between 760 and 1100 px, board slips): "Due today",
// "9d late", "In 3d". Same `days` as overdueText (positive is overdue). Callers keep the full words,
// overdueText(days, dueOn), in sr-only text and in title=.
export function shortDue(days: number): string {
  if (days === 0) return "Due today";
  if (days > 0) return `${days}d late`;
  return `In ${-days}d`;
}

// Whether the row it sits in should carry the long-overdue rule in its margin.
export const isLongOverdue = (days: number | null): boolean => days !== null && overdueLevel(days) === "long";

export function OverdueMark({
  days,
  dueOn,
  size = 16,
  iconOnly = false,
  short = false,
  className = "",
}: {
  days: number;
  dueOn?: string;
  size?: number;
  // The glass alone, for tight places that print the words elsewhere (the words stay in a title and for screen readers).
  iconOnly?: boolean;
  // Also print shortDue ("9d late") in .lg-od-short. A layout that is tight shows it and makes the
  // full words (.lg-od-text) screen-reader only with CSS; the short form itself is never read aloud.
  short?: boolean;
  className?: string;
}) {
  const level = overdueLevel(days);
  const text = overdueText(days, dueOn);
  return (
    <span className={`lg-od ${className}`} data-level={level} title={iconOnly || short ? text : undefined}>
      <HourglassIcon sand={FILL[level]} size={size} />
      {iconOnly ? <span className="lg-sr">{text}</span> : <span className="lg-od-text">{text}</span>}
      {short && !iconOnly && (
        <span className="lg-od-short" aria-hidden="true">
          {shortDue(days)}
        </span>
      )}
    </span>
  );
}
