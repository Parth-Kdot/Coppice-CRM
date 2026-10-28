"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { STAGES, type Stage } from "@/demo/types";

// Drag and drop for board slips, on pointer events. Press a slip and move more than 5 px and it
// lifts: a copy of it follows the pointer with a larger shadow and a 1 degree tilt, the slip it came
// from stays behind as a dashed outline, and the stage under the pointer shows a ruled drop line.
// Letting go over another stage calls onDrop. Escape or letting go anywhere else sends the copy back.
// Mouse and pen only: a finger belongs to scrolling, so phones use the Move to menu.
//
// Motion is plain DOM here: the copy is positioned through the CSSOM (style.setProperty), which the
// strict style policy allows, and it settles back with the Web Animations API.

const THRESHOLD = 5;
const EDGE = 56;

type Session = {
  id: string;
  stage: Stage;
  el: HTMLElement;
  ghost: HTMLElement | null;
  startX: number;
  startY: number;
  offX: number;
  offY: number;
  x: number;
  y: number;
  raf: number | null;
};

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isStage = (value: string | undefined): value is Stage =>
  (STAGES as readonly string[]).includes(value ?? "");

const place = (s: Session) => {
  s.ghost?.style.setProperty(
    "transform",
    `translate3d(${s.x - s.offX}px, ${s.y - s.offY}px, 0) rotate(1deg)`,
  );
};

export function useBoardDrag({
  scroller,
  onDrop,
}: {
  // The strip of columns, scrolled sideways when the pointer leans on its edge.
  scroller: RefObject<HTMLElement | null>;
  // Called with the company and the stage it was dropped on, and the box the copy was in.
  onDrop: (companyId: string, to: Stage, from: DOMRect) => void;
}) {
  const session = useRef<Session | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });
  const teardown = useRef<(() => void) | null>(null);

  const stop = useCallback((drop: boolean) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    teardown.current?.();
    teardown.current = null;
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    document.body.removeAttribute("data-board-dragging");
    delete s.el.dataset.lifted;
    const ghost = s.ghost;
    if (!ghost) return;
    const target = drop
      ? (document
          .elementFromPoint(s.x, s.y)
          ?.closest<HTMLElement>("[data-drop-stage]")?.dataset.dropStage ??
        undefined)
      : undefined;
    const box = ghost.getBoundingClientRect();
    setDragging(null);
    setOver(null);
    // The click that follows letting go over the slip's own link must not open the company.
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(
      () => window.removeEventListener("click", swallow, true),
      0,
    );
    if (drop && isStage(target) && target !== s.stage) {
      ghost.remove();
      dropRef.current(s.id, target, box);
      return;
    }
    // Back to where it came from.
    const home = s.el.getBoundingClientRect();
    if (reducedMotion() || typeof ghost.animate !== "function") {
      ghost.remove();
      return;
    }
    const animation = ghost.animate(
      [
        {
          transform: `translate3d(${box.left}px, ${box.top}px, 0) rotate(1deg)`,
        },
        {
          transform: `translate3d(${home.left}px, ${home.top}px, 0) rotate(0deg)`,
        },
      ],
      { duration: 160, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    animation.onfinish = () => ghost.remove();
    animation.oncancel = () => ghost.remove();
  }, []);

  useEffect(() => () => stop(false), [stop]);

  const begin = useCallback(
    (s: Session) => {
      const box = s.el.getBoundingClientRect();
      const ghost = s.el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      ghost
        .querySelectorAll("a, button")
        .forEach((n) => n.setAttribute("tabindex", "-1"));
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("lg-slip-ghost");
      ghost.style.setProperty("width", `${box.width}px`);
      ghost.style.setProperty("height", `${box.height}px`);
      document.body.appendChild(ghost);
      s.ghost = ghost;
      s.offX = s.startX - box.left;
      s.offY = s.startY - box.top;
      s.el.dataset.lifted = "";
      document.body.setAttribute("data-board-dragging", "");
      setDragging(s.id);
      place(s);
      // Lean on the left or right edge of the strip and it scrolls, for the narrow screens.
      const tick = () => {
        const strip = scroller.current;
        if (strip && session.current === s) {
          const r = strip.getBoundingClientRect();
          if (s.x < r.left + EDGE) strip.scrollLeft -= 14;
          else if (s.x > r.right - EDGE) strip.scrollLeft += 14;
          s.raf = requestAnimationFrame(tick);
        }
      };
      s.raf = requestAnimationFrame(tick);
    },
    [scroller],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, stage: Stage) => {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        session.current
      )
        return;
      // Buttons (Claim, Move to) keep their own clicks.
      if ((event.target as HTMLElement).closest("button")) return;
      const s: Session = {
        id,
        stage,
        el: event.currentTarget,
        ghost: null,
        startX: event.clientX,
        startY: event.clientY,
        offX: 0,
        offY: 0,
        x: event.clientX,
        y: event.clientY,
        raf: null,
      };
      session.current = s;

      const move = (e: PointerEvent) => {
        s.x = e.clientX;
        s.y = e.clientY;
        if (!s.ghost) {
          if (Math.hypot(s.x - s.startX, s.y - s.startY) < THRESHOLD) return;
          begin(s);
        }
        place(s);
        const target = document
          .elementFromPoint(s.x, s.y)
          ?.closest<HTMLElement>("[data-drop-stage]")?.dataset.dropStage;
        setOver(isStage(target) && target !== s.stage ? target : null);
      };
      const up = () => stop(true);
      const cancel = () => stop(false);
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape" && s.ghost) {
          e.preventDefault();
          stop(false);
        }
      };
      const select = (e: Event) => {
        if (s.ghost) e.preventDefault();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      window.addEventListener("selectstart", select);
      teardown.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("selectstart", select);
      };
    },
    [begin, stop],
  );

  return { dragging, over, onPointerDown };
}
