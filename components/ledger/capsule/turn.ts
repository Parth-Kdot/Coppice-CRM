// What a key press or a swipe means in the recap (components/ledger/capsule/recap-reader.tsx).

const SWIPE_PX = 48;

// The direction a key or a swipe means, or null. Pure, so it is tested (tests/capsule-ui.test.ts).
export function turnFor(event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): "next" | "back" | "first" | "last" | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") return "next";
  if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") return "back";
  if (event.key === "Home") return "first";
  if (event.key === "End") return "last";
  return null;
}

export function swipeFor(dx: number, dy: number): "next" | "back" | null {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "back";
}

