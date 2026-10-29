"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ResetIcon } from "../ledger/icons";
import { Ribbon } from "../ledger/marks";
import { EXAMPLE } from "./copy";
import { MOTION_OK, REDUCED_MOTION, setupGsap } from "./motion";

// Maya and Dev, same company, same second: two facing ledger pages and two cursors that head for
// the same Claim button. Maya's click lands first and her gilt ribbon drops. Dev's page shakes and
// a rust margin note names the holder and the date. Then Dev moves on to the next company down.
// It plays once, when the book is on screen, and rests on the last state with a Replay button.
// Each row's claim box has three states set through data-state (free, mine, theirs), which the
// timeline flips; the markup starts in its finished state, so without script or with reduced
// motion the book simply shows how it ended.

type Timeline = ReturnType<ReturnType<typeof setupGsap>["gsap"]["timeline"]>;

const ROWS = ["Dunmore Engineering", "Calloway Foods", "Midland Tool and Die"];

type Who = "Maya" | "Dev";
type RowState = "free" | "mine" | "theirs";

// How each row looks at the end, per officer.
const FINAL: Record<Who, RowState[]> = {
  Maya: ["mine", "free", "free"],
  Dev: ["theirs", "mine", "free"],
};

function Page({ who, initial }: { who: Who; initial: RowState[] }) {
  return (
    <section className="ld-rpage" data-who={who} role="group" aria-label={`${who}'s queue`}>
      <header className="ld-rpage-head">
        <h3 className="ld-officer">{who}</h3>
        <p className="lg-sc ld-rpage-sub">Never contacted</p>
      </header>
      <ul className="ld-rrows">
        {ROWS.map((name, i) => (
          <li key={name} className={`ld-rr ${who === "Dev" && i === 0 ? "has-note" : ""}`} data-row={i} data-state={initial[i]}>
            <span className="lg-margin" aria-hidden="true">
              26-27
            </span>
            <span className="ld-rr-name">{name}</span>
            <span className="ld-rr-claim" aria-hidden="true">
              <span className="ld-rr-btn" data-claim>
                Claim
              </span>
              <span className="ld-rr-chip ld-rr-mine">
                <Ribbon size="sm" className="ld-rr-ribbon" />
                Yours until {EXAMPLE.until}
              </span>
              <span className="ld-rr-chip ld-rr-theirs">Maya C. until {EXAMPLE.until}</span>
            </span>
            {who === "Dev" && i === 0 && <p className="ld-rr-note">{EXAMPLE.devNote}</p>}
          </li>
        ))}
      </ul>
      <p className="ld-rpage-foot">{who === "Maya" ? EXAMPLE.mayaNote : EXAMPLE.devNext}</p>
      <span className="ld-rcursor" data-cursor aria-hidden="true">
        <svg width="22" height="24" viewBox="0 0 22 24" focusable="false">
          <path d="M3 2v17l4.7-4.3 3.3 7.3 3-1.4-3.3-7.2 6.6-.4z" fill="var(--ink)" stroke="var(--paper)" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
        <span className="ld-rcursor-name">{who}</span>
      </span>
    </section>
  );
}

export function Example() {
  const root = useRef<HTMLElement>(null);
  const book = useRef<HTMLDivElement>(null);
  const timeline = useRef<Timeline | null>(null);
  const started = useRef(false);
  const [phase, setPhase] = useState<"static" | "idle" | "playing" | "done">("static");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = book.current;
    if (!el) return;
    const { gsap } = setupGsap();
    const mm = gsap.matchMedia();

    mm.add(MOTION_OK, () => {
      const pages = Array.from(el.querySelectorAll<HTMLElement>(".ld-rpage"));
      const [mayaPage, devPage] = pages;
      const cursors = pages.map((p) => p.querySelector<HTMLElement>("[data-cursor]")!);
      const [mayaCursor, devCursor] = cursors;
      const row = (page: HTMLElement, i: number) => page.querySelector<HTMLElement>(`.ld-rr[data-row="${i}"]`)!;
      const setState = (page: HTMLElement, i: number, state: RowState) => {
        const r = row(page, i);
        r.dataset.state = state;
        const ribbon = r.querySelector(".ld-rr-ribbon");
        ribbon?.classList.remove("lg-ribbon-drop");
        if (state === "mine") {
          // Restart the drop animation.
          void (ribbon as HTMLElement | null)?.offsetWidth;
          ribbon?.classList.add("lg-ribbon-drop");
        }
      };
      const reset = () => {
        pages.forEach((p) => {
          for (let i = 0; i < ROWS.length; i++) setState(p, i, "free");
          p.classList.remove("ld-shaking");
          p.querySelectorAll(".lg-ribbon-drop").forEach((r) => r.classList.remove("lg-ribbon-drop"));
        });
        devPage.querySelector(".ld-rr")?.classList.remove("has-note");
        el.dataset.beat = "0";
      };

      const at = (page: HTMLElement, i: number) => {
        const b = row(page, i).querySelector<HTMLElement>("[data-claim]")!.getBoundingClientRect();
        const a = page.getBoundingClientRect();
        return { x: b.left - a.left + b.width * 0.55, y: b.top - a.top + b.height * 0.55 };
      };
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.inOut" }, onComplete: () => setPhase("done") });
      const press = (c: HTMLElement, t: number) => {
        tl.to(c, { scale: 0.82, duration: 0.07, ease: "power2.out" }, t);
        tl.to(c, { scale: 1, duration: 0.14, ease: "power2.out" }, t + 0.07);
      };

      // Start from the empty state as soon as the animated version mounts, long before it is scrolled to,
      // so the result is never on the page before it plays. Each page footer ("Yours until Nov 11...")
      // stays hidden until its page holds a claim. (Without script, or with reduced motion, the markup
      // stays in its finished state.)
      reset();
      tl.call(reset, [], 0);
      tl.set(cursors, { x: (i: number) => pages[i].clientWidth * 0.78, y: () => mayaPage.clientHeight * 0.9, opacity: 0, scale: 1 }, 0);
      tl.to(cursors, { opacity: 1, duration: 0.25, ease: "none" }, 0.15);

      // Both cursors head for the same Claim button. Maya arrives a beat sooner.
      tl.to(mayaCursor, { x: () => at(mayaPage, 0).x, y: () => at(mayaPage, 0).y, duration: 1.0 }, 0.5);
      tl.to(devCursor, { x: () => at(devPage, 0).x, y: () => at(devPage, 0).y, duration: 1.2 }, 0.5);
      press(mayaCursor, 1.6);
      press(devCursor, 1.78);

      // Maya's claim lands: the button becomes the chip and the ribbon drops.
      tl.call(() => setState(mayaPage, 0, "mine"), [], 1.68);
      // Dev's request is refused: his page shakes and the margin note names the holder.
      tl.call(
        () => {
          setState(devPage, 0, "theirs");
          devPage.classList.remove("ld-shaking");
          void devPage.offsetWidth;
          devPage.classList.add("ld-shaking");
          row(devPage, 0).classList.add("has-note");
        },
        [],
        1.86,
      );
      tl.to(mayaCursor, { opacity: 0, duration: 0.3, ease: "none" }, 2.5);

      // Dev moves on to the next company down.
      tl.to(devCursor, { x: () => at(devPage, 1).x, y: () => at(devPage, 1).y, duration: 0.9 }, 3.4);
      press(devCursor, 4.4);
      tl.call(() => setState(devPage, 1, "mine"), [], 4.48);
      tl.to(devCursor, { opacity: 0, duration: 0.3, ease: "none" }, 5.0);
      tl.to({}, { duration: 0.2 }, 5.4);

      timeline.current = tl;
      setPhase("idle");
      return () => {
        tl.kill();
        timeline.current = null;
        started.current = false;
        // Back to the finished state.
        pages.forEach((p, k) => {
          FINAL[k === 0 ? "Maya" : "Dev"].forEach((s, i) => setState(p, i, s));
          p.classList.remove("ld-shaking");
        });
        row(devPage, 0).classList.add("has-note");
        gsap.set(cursors, { clearProps: "all" });
      };
    });
    mm.add(REDUCED_MOTION, () => setPhase("static"));
    return () => mm.revert();
  }, []);

  // Is the book on screen?
  useEffect(() => {
    const el = book.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Plays once, the first time the book is on screen; pauses if it is scrolled away mid-run.
  useEffect(() => {
    const tl = timeline.current;
    if (!tl || phase === "done" || phase === "static") return;
    if (visible) {
      if (!started.current) {
        started.current = true;
        setPhase("playing");
      }
      tl.play();
    } else {
      tl.pause();
    }
  }, [visible, phase]);

  const replay = useCallback(() => {
    const tl = timeline.current;
    if (!tl) return;
    setPhase("playing");
    tl.restart(false, false);
  }, []);

  return (
    <section ref={root} id="example" className="ld-sec ld-example" aria-labelledby="example-title">
      <div className="ld-wrap">
        <header className="ld-grid ld-example-head">
          <div className="ld-example-title">
            <p className="ld-eyebrow">Live example</p>
            <h2 id="example-title" className="ld-h2">
              {EXAMPLE.headline}
            </h2>
          </div>
          <p className="ld-setting">
            <strong>{EXAMPLE.when}.</strong> {EXAMPLE.setting}
          </p>
          {phase !== "static" && (
            <div className="ld-race-bar">
              <button
                type="button"
                className="lg-btn lg-btn-quiet lg-btn-sm ld-replay"
                onClick={replay}
                data-shown={phase === "done"}
                tabIndex={phase === "done" ? 0 : -1}
                aria-hidden={phase === "done" ? undefined : true}
              >
                <ResetIcon size={16} />
                Replay
              </button>
            </div>
          )}
        </header>

        <div ref={book} className="ld-race">
          <Page who="Maya" initial={FINAL.Maya} />
          <Page who="Dev" initial={FINAL.Dev} />
        </div>
        <p className="lg-sr">
          Two ledger pages show the same list. Both officers press Claim on {EXAMPLE.company}. Maya gets it, and Dev sees {EXAMPLE.refusal}.
        </p>

        <ol className="ld-after">
          {EXAMPLE.after.map((item) => (
            <li key={item.title}>
              <p className="ld-after-when">{item.when}</p>
              <h3 className="ld-h3">{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
