"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadTourCompany, saveTourProgress } from "@/app/(app)/[workspaceId]/onboarding-actions";
import {
  aiSteps,
  anchorSelector,
  basicsPending,
  basicsSteps,
  resumeIndex,
  ROUTE_LABELS,
  type Illustration,
  type TourName,
  type TourRole,
  type TourRoute,
  type TourStep,
} from "@/lib/onboarding-steps";
import { focusSoon } from "./focus";
import { useNotify } from "./providers";
import { autoOpenView, isEditable, placeCard, scrollTarget } from "./tour-logic";
import "./tour.css";

// The onboarding tours, drawn over the real app (the card lists are lib/onboarding-steps.ts).
// Loaded with next/dynamic by tour-gate.tsx only when a tour is due or was asked for, so an
// ordinary page load never downloads it.
//
//   Welcome    A native modal <dialog> (focus trapped, Escape ignored, no close button), shown once
//              on the first full page load in a workspace. "Start (2 min)" goes to the queue.
//   Coach card Every later card: a non-modal role=dialog beside the highlighted real control (a 3px
//              moss outline, no scrim, the page stays usable). Back, Next, Hide; Escape hides it into
//              the Resume pill (the basics) or ends it (a replay, the AI tour). Each card takes focus
//              on its title; "Show me" hands focus to the real control. On a phone it is a bottom
//              sheet above the tab bar and the control is scrolled into the space above it.
//   Pill       "Basics 3 of 8 · Resume", bottom left (above the tab bar on a phone).
//
// It never interrupts work: it opens by itself only on a full page load and only when no dialog
// is open and no text field has focus; it moves to another page only when you press a tour button,
// and not then if the page has typed-in input; it never takes focus from a field being typed in.
// Progress is saved card by card (onboarding-actions.ts); a replay of the basics saves nothing.

export type TourProgress = {
  basicsStep: number;
  basicsDone: boolean;
  basicsRole: TourRole | null;
  aiStep: number;
  aiDone: boolean;
  aiDismissed: boolean;
};

export type TourProps = {
  workspaceId: string;
  workspaceName: string;
  role: TourRole;
  empty: boolean;
  aiConfigured: boolean;
  aiOn: boolean;
  mcpOn: boolean;
  claimWindowDays: number;
  progress: TourProgress;
  // The basics were due at the first full page load: open them (or the pill) by themselves.
  autoStart: boolean;
  // "Replay the basics" / "AI tour" from the account menu (?tour=), a new id each time.
  request: { tour: TourName; id: number } | null;
};

type Run = {
  tour: TourName;
  index: number;
  replay: boolean;
  // Non-zero: this card was reached by a tour button, so the tour may go to the card's page.
  // A fresh number each time, so the same card reached twice navigates twice.
  nav: number;
  // Started from the account menu (?tour=): the first move replaces that address instead of
  // adding to the history, so Back doesn't start the tour again.
  fromRequest?: boolean;
};

type View = "waiting" | "card" | "pill" | "closed";

const PHONE = "(max-width: 760px)";
const REDUCED = "(prefers-reduced-motion: reduce)";
const matches = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

let navCounter = 0;
const nextNav = () => ++navCounter;

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

// The first anchor on the page that can be seen (a phone tries its own first). One hidden only by a collapsed <details> (a
// Settings section) is revealed by opening it.
function pickAnchor(step: TourStep): HTMLElement | null {
  const anchors = matches(PHONE) && step.phoneAnchors ? [...step.phoneAnchors, ...step.anchors] : step.anchors;
  for (const anchor of anchors) {
    for (const el of document.querySelectorAll<HTMLElement>(anchorSelector(anchor))) {
      if (el.closest("[data-tour-card]")) continue;
      if (visible(el)) return el;
      const closed = el.parentElement?.closest<HTMLDetailsElement>("details:not([open])");
      if (closed && !closed.querySelector(":scope > summary")?.contains(el)) {
        closed.open = true;
        if (visible(el)) return el;
      }
    }
  }
  return null;
}

// Inside something fixed or sticky (the tab bar, the spine, the header): scrolling won't move it.
function pinned(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

function scrollIntoBand(el: HTMLElement, card: HTMLElement | null) {
  if (pinned(el)) return;
  const head = document.querySelector<HTMLElement>(".lg-head");
  const headPos = head ? getComputedStyle(head).position : "";
  const viewTop = (head && (headPos === "sticky" || headPos === "fixed") ? head.getBoundingClientRect().bottom : 0) + 8;
  // On a phone the card is a sheet at the bottom: the control goes in the space above it.
  const viewBottom = matches(PHONE) && card ? card.getBoundingClientRect().top - 8 : window.innerHeight - 8;
  const r = el.getBoundingClientRect();
  const top = scrollTarget({ top: r.top, height: r.height, scrollY: window.scrollY, viewTop, viewBottom });
  if (top !== null) window.scrollTo({ top, behavior: matches(REDUCED) ? "auto" : "smooth" });
}

// Typed-in text the person hasn't saved: the tour then won't leave the page on its own. Only
// fields people type into count; a select or a checkbox drawn on the client looks "changed" to the
// DOM even when nobody touched it.
function hasUnsavedInput(): boolean {
  const main = document.getElementById("main");
  if (!main) return false;
  for (const field of main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    if (isEditable(field) && field.value !== field.defaultValue) return true;
  }
  return false;
}

// ?tour= off the address, without a round trip (Next keeps its router in step with replaceState).
function dropTourParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("tour")) return;
  url.searchParams.delete("tour");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function Tour(props: TourProps) {
  const { workspaceId, workspaceName, role, empty, aiConfigured, aiOn, mcpOn, claimWindowDays, request } = props;
  const router = useRouter();
  const pathname = usePathname();
  const notify = useNotify();
  const titleId = useId();
  const bodyId = useId();

  const [progress, setProgress] = useState<TourProgress>(props.progress);
  const [autoStart] = useState(props.autoStart);
  const upgrade = progress.basicsDone && progress.basicsRole === "member" && role === "owner";
  const basicsList = useMemo(
    () => basicsSteps({ role, empty, basicsRole: progress.basicsDone ? progress.basicsRole : null, claimWindowDays }),
    [role, empty, progress.basicsDone, progress.basicsRole, claimWindowDays],
  );
  const aiList = useMemo(() => aiSteps({ role, aiConfigured, aiOn, mcpOn }), [role, aiConfigured, aiOn, mcpOn]);

  const [run, setRun] = useState<Run | null>(() =>
    autoStart ? { tour: "basics", index: resumeIndex(basicsList, upgrade ? 0 : progress.basicsStep), replay: false, nav: 0 } : null,
  );
  const [view, setView] = useState<View>(autoStart ? "waiting" : "closed");
  const [handled, setHandled] = useState(0);
  const [companyId, setCompanyId] = useState<string | null | undefined>(undefined);
  const [found, setFound] = useState<{ key: string; el: HTMLElement | null } | null>(null);

  // A tour asked for from the account menu (adjusting state while rendering, not in an effect).
  if (request && request.id !== handled) {
    setHandled(request.id);
    if (request.tour === "basics") {
      const pending = basicsPending({ basicsDoneAt: progress.basicsDone || null, basicsRole: progress.basicsRole }, role);
      const firstCoach = Math.max(0, basicsList.findIndex((s) => s.kind === "coach"));
      const index = pending ? resumeIndex(basicsList, upgrade ? 0 : progress.basicsStep) : firstCoach;
      setRun({ tour: "basics", index, replay: !pending, nav: -request.id, fromRequest: true });
    } else {
      setRun({ tour: "ai", index: progress.aiDone ? 0 : resumeIndex(aiList, progress.aiStep), replay: progress.aiDone, nav: -request.id, fromRequest: true });
    }
    setView("card");
  }

  const steps = run?.tour === "ai" ? aiList : basicsList;
  const index = run ? Math.min(run.index, steps.length - 1) : 0;
  const step: TourStep | null = run ? steps[index] : null;
  const stepKey = run && step ? `${run.tour}:${index}:${step.key}` : "";
  const firstCoach = steps.findIndex((s) => s.kind === "coach");

  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const welcomeRef = useRef<HTMLDialogElement>(null);
  const navDone = useRef(0);
  const opened = useRef("");

  const base = `/${workspaceId}`;
  const onRoute = useCallback(
    (route: TourRoute): boolean => {
      const rest = pathname.slice(base.length).replace(/\/+$/, "");
      if (route === "queue") return rest === "";
      if (route === "company") return rest.startsWith("/companies/") && rest !== "/companies/new";
      return rest === `/${route}`;
    },
    [pathname, base],
  );
  const hrefOf = useCallback(
    (route: TourRoute): string | null => {
      if (route === "queue") return base;
      if (route === "company") return companyId ? `${base}/companies/${companyId}` : null;
      return `${base}/${route}`;
    },
    [base, companyId],
  );

  // ----- Saving -----

  const save = useCallback(
    async (tour: TourName, at: number, event: "step" | "done" | "later") => {
      try {
        const result = await saveTourProgress({ workspaceId, tour, step: at, event });
        if (!result.ok) notify(result.error, "error");
        // The account menu's "AI tour · recommended" dot goes once the AI tour is finished.
        else if (tour === "ai" && event === "done") router.refresh();
      } catch {
        notify("Could not save your place in the tour.", "error");
      }
    },
    [workspaceId, notify, router],
  );

  const record = (tour: TourName, at: number, event: "step" | "done" | "later") => {
    setProgress((p) => {
      if (event === "later") return { ...p, aiDismissed: true };
      if (tour === "basics") return { ...p, basicsStep: Math.max(p.basicsStep, at), ...(event === "done" ? { basicsDone: true, basicsRole: role } : {}) };
      return { ...p, aiStep: Math.max(p.aiStep, at), ...(event === "done" ? { aiDone: true } : {}) };
    });
    void save(tour, at, event);
  };

  // ----- Moving through the cards -----

  const close = () => {
    const inCard = !!document.activeElement?.closest("[data-tour-card]");
    setView("closed");
    setRun(null);
    // Focus never falls to <body>: back to the page's heading.
    if (inCard) focusSoon("#main h1");
  };

  const hide = () => {
    setView("pill");
    focusSoon(".lg-tour-pill");
  };

  const goTo = (i: number) => {
    if (!run) return;
    const nav = nextNav();
    setRun({ ...run, index: i, nav, fromRequest: false });
  };

  const next = () => {
    if (!run || !step) return;
    const i = index + 1;
    if (i >= steps.length) {
      // The last card was a coach card (an owner's one-card invite step): that finishes the basics.
      if (!run.replay) record(run.tour, index, "done");
      close();
      return;
    }
    const target = steps[i];
    if (target.kind === "done") {
      // Reaching the last card finishes the tour. A replay of the basics writes nothing; a replay of
      // the AI tour only records that it was finished.
      if (!run.replay || run.tour === "ai") record(run.tour, i, "done");
    } else if (!run.replay) record(run.tour, i, "step");
    goTo(i);
  };

  const back = () => {
    if (index > firstCoach) goTo(index - 1);
  };

  const startAi = () => {
    const nav = nextNav();
    setRun({ tour: "ai", index: progress.aiDone ? 0 : resumeIndex(aiList, progress.aiStep), replay: progress.aiDone, nav });
    setView("card");
  };

  const later = () => {
    if (!progress.aiDone && !progress.aiDismissed && !run?.replay) record("ai", 0, "later");
    close();
  };

  const endAi = () => {
    if (run && !run.replay && !progress.aiDone && !progress.aiDismissed) record("ai", index, "later");
    close();
  };

  const escape = () => {
    if (!run || !step || step.kind === "welcome") return;
    if (step.kind === "done") return run.tour === "basics" && !progress.aiDone ? later() : close();
    if (run.tour === "ai") return endAi();
    return run.replay ? close() : hide();
  };

  // ----- Effects -----

  // The first full load: open the card, or wait as the pill if something has the person's attention.
  useEffect(() => {
    if (!autoStart) return;
    const raf = requestAnimationFrame(() => {
      const editableFocused = isEditable(document.activeElement as HTMLElement | null);
      const dialogOpen = !!document.querySelector("dialog[open]");
      setView((v) => (v === "waiting" ? autoOpenView({ editableFocused, dialogOpen }) : v));
    });
    return () => cancelAnimationFrame(raf);
  }, [autoStart]);

  // The company page the tour shows, asked for once, the first time a card needs one.
  useEffect(() => {
    if (view !== "card" || step?.route !== "company" || companyId !== undefined || empty) return;
    let live = true;
    loadTourCompany(workspaceId).then(
      (result) => live && setCompanyId(result.ok ? result.data.companyId : null),
      () => live && setCompanyId(null),
    );
    return () => {
      live = false;
    };
  }, [view, step?.route, companyId, empty, workspaceId]);

  // A card reached by a tour button goes to its page, unless typed-in input would be lost. A tour
  // asked for with ?tour= makes one move that also takes ?tour= off the address.
  useEffect(() => {
    if (view !== "card" || !run || !run.nav || !step || navDone.current === run.nav) return;
    if (step.route === "company" && companyId === undefined && !empty) return;
    navDone.current = run.nav;
    const href = step.route && !onRoute(step.route) ? hrefOf(step.route) : null;
    const go = href && !hasUnsavedInput() ? href : null;
    if (run.fromRequest) {
      if (go) router.replace(go, { scroll: false });
      else dropTourParam();
    } else if (go) router.push(go, { scroll: false });
  }, [view, run, step, companyId, empty, onRoute, hrefOf, router]);

  // Find the card's control, and keep finding it as the page changes (a route arriving, a claim
  // redrawing the row). Done on the next frame, outside rendering.
  useEffect(() => {
    if (view !== "card" || !step || step.kind !== "coach") return;
    const here = !step.route || onRoute(step.route);
    let raf = 0;
    const find = () => {
      raf = 0;
      if (here && step.open && opened.current !== stepKey) {
        const toggle = document.querySelector<HTMLButtonElement>(`${anchorSelector(step.open)} > button[aria-expanded="false"]`);
        if (toggle) {
          opened.current = stepKey;
          toggle.click();
        }
      }
      const el = here ? pickAnchor(step) : null;
      setFound((prev) => (prev && prev.key === stepKey && prev.el === el ? prev : { key: stepKey, el }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(find);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "aria-expanded"] });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [view, step, stepKey, onRoute]);

  const anchor = view === "card" && step?.kind === "coach" && found?.key === stepKey ? found.el : null;

  // The highlight: an attribute the stylesheet draws as the moss outline.
  useEffect(() => {
    if (!anchor) return;
    anchor.setAttribute("data-tour-focus", "");
    return () => anchor.removeAttribute("data-tour-focus");
  }, [anchor]);

  // Bring the control into view once per card (and again if it is redrawn as a new element).
  useEffect(() => {
    if (!anchor) return;
    const raf = requestAnimationFrame(() => scrollIntoBand(anchor, cardRef.current));
    return () => cancelAnimationFrame(raf);
  }, [anchor, stepKey]);

  // Place the coach card beside its control (desktop), through the CSSOM (the style policy allows it).
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || view !== "card" || !step || step.kind === "welcome") return;
    const place = () => {
      const r = anchor && step.kind === "coach" ? anchor.getBoundingClientRect() : null;
      const at = placeCard({
        anchor: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
        card: { width: card.offsetWidth, height: card.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        phone: matches(PHONE),
      });
      card.dataset.place = at.place;
      if (at.place === "beside") {
        card.style.setProperty("left", `${Math.round(at.left)}px`);
        card.style.setProperty("top", `${Math.round(at.top)}px`);
      } else {
        card.style.removeProperty("left");
        card.style.removeProperty("top");
      }
    };
    place();
    let raf = 0;
    const replace = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          place();
        });
    };
    window.addEventListener("scroll", replace, { passive: true, capture: true });
    window.addEventListener("resize", replace);
    const resize = new ResizeObserver(replace);
    resize.observe(card);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", replace, { capture: true });
      window.removeEventListener("resize", replace);
      resize.disconnect();
    };
  }, [view, step, anchor, stepKey]);

  // Each card takes focus on its title, without scrolling, unless the person is typing somewhere.
  useEffect(() => {
    if (view !== "card" || !stepKey) return;
    const active = document.activeElement as HTMLElement | null;
    if (isEditable(active) && !active?.closest("[data-tour-card]")) return;
    const raf = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [view, stepKey]);

  // The welcome card is a real modal: opened with showModal, never closed by Escape. Browsers that
  // close a dialog anyway after repeated Escapes get it opened again.
  const welcome = view === "card" && step?.kind === "welcome";
  useEffect(() => {
    const dialog = welcomeRef.current;
    if (!welcome || !dialog) return;
    dialog.setAttribute("closedby", "none");
    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus({ preventScroll: true });
    const reopen = () => {
      if (dialog.isConnected && !dialog.open) dialog.showModal();
    };
    dialog.addEventListener("close", reopen);
    return () => dialog.removeEventListener("close", reopen);
  }, [welcome]);

  if (!run || !step || view === "closed" || view === "waiting") return null;

  if (view === "pill") {
    const label = step.kind === "welcome" ? "Basics · Start" : `${run.tour === "ai" ? "AI tour" : "Basics"} ${index + 1} of ${steps.length} · Resume`;
    return (
      <button type="button" className="lg-tour-pill" onClick={() => setView("card")}>
        {label}
      </button>
    );
  }

  if (step.kind === "welcome") {
    return (
      <dialog
        ref={welcomeRef}
        className="lg-tour-welcome"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-tour-card=""
        onCancel={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // Start is the only control: Tab stays on it rather than leaving for the browser's toolbar.
          if (event.key === "Tab") {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="lg-tour-title">
          Welcome to {workspaceName}.
        </h2>
        <p id={bodyId} className="lg-tour-body">
          {step.body}
        </p>
        <div className="lg-tour-actions">
          <button type="button" className="lg-btn lg-btn-primary" onClick={next}>
            Start (2 min)
          </button>
        </div>
      </dialog>
    );
  }

  const here = !step.route || onRoute(step.route);
  const goHref = step.route && !here ? hrefOf(step.route) : null;
  const tourName = run.tour === "ai" ? "AI tour" : "Basics";
  const lastCoachAlone = step.kind === "coach" && index === steps.length - 1;
  const showMe = () => {
    if (!anchor) return;
    const target = anchor.matches(FOCUSABLE) ? anchor : anchor.querySelector<HTMLElement>(FOCUSABLE);
    focusSoon(target ?? anchor);
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="lg-tour-card"
      data-kind={step.kind}
      data-tour-card=""
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          escape();
        }
      }}
    >
      {step.kind === "coach" && (
        <p className="lg-tour-count">
          {tourName} · {index + 1} of {steps.length}
        </p>
      )}
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className="lg-tour-title">
        {step.title}
      </h2>
      <p id={bodyId} className="lg-tour-body">
        {step.kind === "done" && run.tour === "basics" && progress.aiDone ? "Replay either tour from the account menu." : step.body}
      </p>
      {step.kind === "coach" && !anchor && step.illustration && <Drawing kind={step.illustration} />}
      {step.kind === "coach" && (goHref || anchor || step.link) && (
        <p className="lg-tour-go">
          {goHref ? (
            <button type="button" className="lg-btn lg-btn-sm" onClick={() => router.push(goHref)}>
              {ROUTE_LABELS[step.route as TourRoute]}
            </button>
          ) : anchor ? (
            <button type="button" className="lg-linkbtn" onClick={showMe}>
              {step.tryLabel ?? "Show me"}
            </button>
          ) : null}
          {step.link && hrefOf(step.link.route) && (
            <button type="button" className="lg-linkbtn" onClick={() => router.push(hrefOf(step.link!.route)!)}>
              {step.link.label}
            </button>
          )}
        </p>
      )}
      <div className="lg-tour-actions">
        {step.kind === "coach" ? (
          <>
            {index > firstCoach && (
              <button type="button" className="lg-btn lg-btn-sm" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="lg-btn lg-btn-sm lg-btn-primary" onClick={next}>
              {lastCoachAlone ? "Done" : "Next"}
            </button>
            <button type="button" className="lg-btn lg-btn-sm lg-tour-quiet" onClick={run.tour === "ai" ? endAi : run.replay ? close : hide}>
              {run.tour === "ai" || run.replay ? "End tour" : "Hide"}
            </button>
          </>
        ) : run.tour === "basics" && !progress.aiDone ? (
          <>
            <button type="button" className="lg-btn lg-btn-sm lg-btn-primary" onClick={startAi}>
              Start the AI tour
            </button>
            <button type="button" className="lg-btn lg-btn-sm lg-tour-quiet" onClick={later}>
              Later
            </button>
          </>
        ) : (
          <button type="button" className="lg-btn lg-btn-sm lg-btn-primary" onClick={close}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

// Small static drawings of a control the page can't show right now (an empty workspace, or no row
// to claim). Decorative: the sentence above says everything.
function Drawing({ kind }: { kind: Illustration }) {
  return (
    <div className="lg-tour-art" data-art={kind} aria-hidden="true">
      {kind === "queue" &&
        [0, 1, 2].map((i) => (
          <span key={i} className="lg-tour-art-row">
            <span className="lg-tour-art-bar" />
            <span className="lg-tour-art-chip">{i === 0 ? "3d late" : "Due today"}</span>
          </span>
        ))}
      {kind === "claim" && (
        <span className="lg-tour-art-row">
          <span className="lg-tour-art-bar" />
          <span className="lg-tour-art-btn">Claim</span>
        </span>
      )}
      {kind === "log" && (
        <>
          <span className="lg-tour-art-label">Log outreach</span>
          <span className="lg-tour-art-row">
            <span className="lg-tour-art-chip">3 days</span>
            <span className="lg-tour-art-chip" data-on="">
              7 days
            </span>
            <span className="lg-tour-art-chip">Pick</span>
          </span>
        </>
      )}
      {kind === "board" && (
        <span className="lg-tour-art-cols">
          {["Contacted", "Replied", "Talking"].map((label) => (
            <span key={label} className="lg-tour-art-col">
              <span className="lg-tour-art-label">{label}</span>
              <span className="lg-tour-art-slip" />
              <span className="lg-tour-art-slip" />
            </span>
          ))}
        </span>
      )}
      {kind === "check" && (
        <>
          <span className="lg-tour-art-label">Claim check: 1 line to check</span>
          <span className="lg-tour-art-line">
            We have <span className="lg-tour-art-flag">40 members</span> and meet weekly.
          </span>
        </>
      )}
    </div>
  );
}
