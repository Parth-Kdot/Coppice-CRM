"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ResetIcon } from "../icons";
import { buildHeroTimeline, heroFinal, heroStart } from "./hero-script";
import { LIT_KEYS, MINI_KEYS } from "./mini-data";
import { MiniCursor, MiniQueue, type MiniState } from "./mini-queue";
import { MOTION_OK, REDUCED_MOTION, setupGsap } from "./motion";

// The live queue in the hero. It plays once, after the headline has settled, and only while it is on
// screen. Then it rests on its final state (the claim is yours, the rows have re-sorted) and offers a
// Replay button. With reduced motion it simply shows that final state. The window is decoration for
// screen readers, so a paragraph below says what happens in it.
export function HeroDemo({ settled }: { settled: boolean }) {
  const [state, setState] = useState<MiniState>(heroStart);
  const [lit, setLit] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "done" | "static">("idle");
  const [visible, setVisible] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const timeline = useRef<ReturnType<typeof buildHeroTimeline> | null>(null);
  const started = useRef(false);

  // Build the timeline once the window is mounted (or show the end state for reduced motion).
  useEffect(() => {
    const win = stage.current?.querySelector<HTMLElement>(".ldm");
    const cursor = win?.querySelector<HTMLElement>("[data-cursor]");
    if (!win || !cursor) return;
    const { gsap } = setupGsap();
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const tl = buildHeroTimeline({ root: win, cursor, set: setState, light: setLit, onDone: () => setPhase("done") });
      timeline.current = tl;
      return () => {
        tl.kill();
        timeline.current = null;
        started.current = false;
      };
    });
    mm.add(REDUCED_MOTION, () => {
      setState(heroFinal());
      setPhase("static");
    });
    return () => mm.revert();
  }, []);

  // Watch whether the window is on screen.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // First play: after the headline settles, when the window is on screen. It pauses when it leaves.
  useEffect(() => {
    const tl = timeline.current;
    if (!tl || phase === "static" || phase === "done") return;
    if (visible && settled) {
      if (!started.current) {
        started.current = true;
        setPhase("playing");
      }
      tl.play();
    } else {
      tl.pause();
    }
  }, [visible, settled, phase]);

  const replay = useCallback(() => {
    const tl = timeline.current;
    if (!tl) return;
    setState(heroStart());
    setLit(null);
    setPhase("playing");
    tl.restart(false, false);
  }, []);

  const litKeys = lit ? (LIT_KEYS[lit] ?? []) : [];
  return (
    <div ref={wrap} className="ldm-wrap">
      <div ref={stage}>
        <MiniQueue state={state}>
          <MiniCursor />
        </MiniQueue>
      </div>
      <div className="ldm-keyrow">
        <ul className="ldm-keys" aria-hidden="true">
          {MINI_KEYS.map((group) => (
            <li key={group.id}>
              <span className="ldm-keycaps">
                {group.keys.map((k) => (
                  <kbd key={k} data-lit={litKeys.includes(k)}>
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="ldm-key-label">{group.label}</span>
            </li>
          ))}
        </ul>
        {phase !== "static" && (
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm ldm-replay" onClick={replay} data-shown={phase === "done"} tabIndex={phase === "done" ? 0 : -1} aria-hidden={phase === "done" ? undefined : true}>
            <ResetIcon size={16} />
            Replay
          </button>
        )}
      </div>
      <p className="lg-sr">
        An example of the queue. A cursor opens the search with the slash key, types lilly and presses Enter to pick Eli Lilly. Pressing C claims it: a gold ribbon drops in and the button reads Yours until
        Nov 11. The list re-sorts so the company you hold is first, J and K move the selection, and L opens the form that logs outreach with a 7 day follow-up.
      </p>
    </div>
  );
}
