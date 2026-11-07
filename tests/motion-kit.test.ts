import { afterEach, describe, expect, test, vi } from "vitest";
import { exitOffset, flightVector, hexToRgba, moveSpan, MOVE_LIMIT_S, ringShadow, shouldAnimate, TIMING } from "@/components/ledger/motion-kit";

describe("motion kit timing", () => {
  test.each(Object.entries(TIMING))("%s ends within the move limit", (_name, parts) => {
    expect(moveSpan(parts)).toBeGreaterThan(0);
    expect(moveSpan(parts)).toBeLessThanOrEqual(MOVE_LIMIT_S);
  });

  test("the removal matches the CSS exit (slide 220 ms, collapse 220 ms after 160 ms)", () => {
    expect(TIMING.removeAway.slide).toEqual({ at: 0, dur: 0.22 });
    expect(TIMING.removeAway.collapse).toEqual({ at: 0.16, dur: 0.22 });
  });

  test("moveSpan is the latest end, not the sum", () => {
    expect(moveSpan({ a: { at: 0, dur: 0.2 }, b: { at: 0.1, dur: 0.05 } })).toBeCloseTo(0.2);
    expect(moveSpan({})).toBe(0);
  });
});

describe("exitOffset", () => {
  test.each([
    [undefined, undefined, { x: -16, y: 0 }],
    ["left", 10, { x: -10, y: 0 }],
    ["right", 10, { x: 10, y: 0 }],
    ["up", 8, { x: 0, y: -8 }],
    ["down", 8, { x: 0, y: 8 }],
    ["left", -5, { x: 0, y: 0 }],
    ["up", 0, { x: 0, y: 0 }],
  ] as const)("%s by %s", (direction, distance, expected) => {
    expect(exitOffset(direction, distance)).toEqual(expected);
  });
});

describe("flightVector", () => {
  const box = (left: number, top: number, width = 100, height = 40) => ({ left, top, width, height });

  test.each([
    { name: "all the way", from: box(0, 0), to: box(300, 0), opts: { reach: 1 }, expected: { x: 300, y: 0 } },
    { name: "most of the way by default", from: box(0, 0), to: box(200, 100), opts: {}, expected: { x: 170, y: 85 } },
    { name: "centers, not corners", from: box(0, 0, 100, 40), to: box(0, 0, 300, 40), opts: { reach: 1 }, expected: { x: 100, y: 0 } },
    { name: "capped, direction kept", from: box(0, 0), to: box(3000, 4000), opts: { reach: 1, maxPx: 500 }, expected: { x: 300, y: 400 } },
    { name: "up and left", from: box(400, 300), to: box(100, 0), opts: { reach: 1 }, expected: { x: -300, y: -300 } },
    { name: "already there", from: box(50, 50), to: box(50, 50), opts: {}, expected: { x: 0, y: 0 } },
    { name: "reach clamped to 1", from: box(0, 0), to: box(100, 0), opts: { reach: 3 }, expected: { x: 100, y: 0 } },
    { name: "reach clamped to 0", from: box(0, 0), to: box(100, 0), opts: { reach: -1 }, expected: { x: 0, y: 0 } },
  ])("$name", ({ from, to, opts, expected }) => {
    expect(flightVector(from, to, opts)).toEqual(expected);
  });
});

describe("hexToRgba", () => {
  test.each([
    ["#2f5233", 1, "rgba(47, 82, 51, 1)"],
    ["#456B47", 0.5, "rgba(69, 107, 71, 0.5)"],
    ["#fff", 0, "rgba(255, 255, 255, 0)"],
    [" #f6f1e6 ", 2, "rgba(246, 241, 230, 1)"],
    ["f6f1e6", 1, "rgba(246, 241, 230, 1)"],
    ["rgb(1, 2, 3)", 1, null],
    ["", 1, null],
    ["#12345", 1, null],
  ])("%s at %s", (hex, alpha, expected) => {
    expect(hexToRgba(hex, alpha)).toBe(expected);
  });
});

describe("ringShadow", () => {
  const ring = { paper: "#f6f1e6", moss: "#456b47", gap: 2, spread: 7, paperAlpha: 0, mossAlpha: 0.5 };

  test("a paper gap over a moss ring", () => {
    expect(ringShadow(ring)).toBe("0 0 0 2px rgba(246, 241, 230, 0), 0 0 0 7px rgba(69, 107, 71, 0.5)");
  });

  test("keeps the element's own shadow underneath", () => {
    expect(ringShadow({ ...ring, base: "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px" })).toBe("0 0 0 2px rgba(246, 241, 230, 0), 0 0 0 7px rgba(69, 107, 71, 0.5), rgba(0, 0, 0, 0.1) 0px 1px 2px 0px");
    expect(ringShadow({ ...ring, base: "none" })).not.toContain("none");
  });

  test("the moss ring is never inside the gap, and bad tokens fall back", () => {
    expect(ringShadow({ ...ring, gap: 4, spread: 1 })).toContain("0 0 0 4px rgba(69, 107, 71");
    expect(ringShadow({ ...ring, paper: "var(--x)", moss: "oops" })).toBe("0 0 0 2px rgba(246, 241, 230, 0), 0 0 0 7px rgba(69, 107, 71, 0.5)");
  });
});

describe("shouldAnimate", () => {
  test.each([
    [{ reduced: false, hidden: false, connected: true }, true],
    [{ reduced: true, hidden: false, connected: true }, false],
    [{ reduced: false, hidden: true, connected: true }, false],
    [{ reduced: false, hidden: false, connected: false }, false],
  ])("%o", (env, expected) => {
    expect(shouldAnimate(env)).toBe(expected);
  });
});

// The moves themselves, in Node with a stand-in window: every one resolves without animating
// when it shouldn't animate, and without loading GSAP at all when it doesn't need it.
describe("moves skip and still resolve", () => {
  class FakeElement {
    isConnected = true;
    contains() {
      return false;
    }
  }

  function fakeBrowser({ reduced }: { reduced: boolean }) {
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("document", { visibilityState: "visible", activeElement: null, documentElement: {} });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }), setTimeout, clearTimeout });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("gsap");
    vi.doUnmock("gsap/CustomEase");
    vi.resetModules();
  });

  type Factory = () => Record<string, unknown>;

  async function freshKit(gsapFactory: Factory) {
    vi.resetModules();
    vi.doMock("gsap", gsapFactory);
    vi.doMock("gsap/CustomEase", gsapFactory);
    return import("@/components/ledger/motion-kit");
  }

  test("reduced motion: every move resolves at once and GSAP is never loaded", async () => {
    fakeBrowser({ reduced: true });
    const loads = vi.fn<Factory>(() => ({}));
    const kit = await freshKit(loads);
    const el = new FakeElement();
    await expect(Promise.all([kit.completeStamp(el as never), kit.removeAway(el as never), kit.sendTo(el as never, new FakeElement() as never), kit.celebrate(el as never)])).resolves.toBeDefined();
    expect(loads).not.toHaveBeenCalled();
  });

  test("a missing or detached element resolves without loading GSAP", async () => {
    fakeBrowser({ reduced: false });
    const loads = vi.fn<Factory>(() => ({}));
    const kit = await freshKit(loads);
    const detached = Object.assign(new FakeElement(), { isConnected: false });
    await kit.completeStamp(null);
    await kit.removeAway(undefined);
    await kit.sendTo(detached as never, null);
    await kit.celebrate(detached as never);
    expect(loads).not.toHaveBeenCalled();
  });

  test("GSAP failing to load still resolves the move", async () => {
    fakeBrowser({ reduced: false });
    const kit = await freshKit((): Record<string, unknown> => {
      throw new Error("chunk failed");
    });
    await expect(kit.removeAway(new FakeElement() as never)).resolves.toBeUndefined();
    await expect(kit.completeStamp(new FakeElement() as never)).resolves.toBeUndefined();
  });

  test("restore on an element that isn't moving is a no-op", async () => {
    fakeBrowser({ reduced: false });
    const kit = await freshKit(() => ({}));
    expect(() => kit.restore(new FakeElement() as never)).not.toThrow();
    expect(() => kit.restore(null)).not.toThrow();
  });
});
