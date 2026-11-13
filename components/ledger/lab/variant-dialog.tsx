"use client";

import { useActionState, useId, useRef, useState } from "react";
import { proposeVariants, startExperiment, type ProposalView, type ProposedVariant } from "@/app/(app)/[workspaceId]/stats/actions";
import { Disclosure } from "@/components/ledger/disclosure";
import { focusSoon } from "@/components/ledger/focus";
import { QuillWait } from "@/components/ledger/marks";
import { completeStamp, removeAway } from "@/components/ledger/motion-kit";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import type { StartedExperiment } from "@/lib/template-lab/lab";
import type { ActionResult } from "@/lib/validation";
import "../templates.css";
import "./lab.css";

// "Try a variant": the panel that asks for 2 or 3 one-change variants of a template, shows the ones
// that passed Coppice's checks read-only (editing one would break the proof that it changes one
// thing), and starts an experiment with the one or two the owner picks. A plain dialog over the page,
// like "Which outreach got the reply?": Escape or Close leaves, and nothing is saved until Start.
//
// The AI is asked on a click of "Write variants", never on open. Starting stamps the button before
// the panel closes; a discarded variant leaves through the motion kit.

const KIND_LABEL: Record<string, string> = { opening: "Opening", ask: "The ask", closing: "Closing", shorter: "Shorter" };
const MAX_PICKS = 2;

type Props = { workspaceId: string; templateId: string; templateName: string; onClose: () => void };

export function VariantDialog({ workspaceId, templateId, templateName, onClose }: Props) {
  const id = useId();
  const notify = useNotify();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const opener = useRef<Element | null>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const askButton = useRef<HTMLButtonElement>(null);
  // After every variant was discarded: back to the ask, for a fresh set.
  const [again, setAgain] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [gone, setGone] = useState<Set<number>>(new Set());

  const [proposal, ask, asking] = useActionState(async (prev: ActionResult<ProposalView> | null, form: FormData) => {
    const result = await proposeVariants(prev, form);
    setPicked(new Set());
    setGone(new Set());
    setAgain(false);
    // The button was disabled while asking, which drops focus to the page: it goes to the first variant, or back to the button.
    focusSoon(result.ok ? () => dialog.current?.querySelector<HTMLElement>(".lg-variants input") ?? null : () => askButton.current);
    return result;
  }, null);
  const variants = proposal?.ok ? proposal.data.variants : [];
  const shown = variants.map((v, i) => ({ v, i })).filter(({ i }) => !gone.has(i));
  const chosen = shown.filter(({ i }) => picked.has(i)).map(({ v }) => ({ kind: v.kind, summary: v.summary, body: v.body }));

  const finish = () => {
    const before = opener.current;
    onClose();
    focusSoon(() => (before instanceof HTMLElement && before.isConnected ? before : document.querySelector<HTMLElement>("#main h1")));
  };

  const [started, start, starting] = useActionState(async (prev: ActionResult<StartedExperiment> | null, form: FormData) => {
    const result = await startExperiment(prev, form);
    if (result.ok) {
      // The finish moment: the button is stamped, then the panel closes on the running experiment.
      await completeStamp(startButton.current);
      dialog.current?.close();
      finish();
      notify("Experiment started. The log form now suggests the arm with the fewest sends.");
    }
    return result;
  }, null);

  const busy = asking || starting;
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    finish();
  };

  const toggle = (i: number) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(i)) next.delete(i);
      else if (next.size < MAX_PICKS) next.add(i);
      return next;
    });

  const discard = async (i: number, li: HTMLElement | null) => {
    await removeAway(li);
    setGone((now) => new Set(now).add(i));
    setPicked((now) => {
      const next = new Set(now);
      next.delete(i);
      return next;
    });
  };

  return (
    <dialog
      className="lg-dialog lg-variantdlg"
      aria-labelledby={`${id}-h`}
      ref={(el) => {
        dialog.current = el;
        if (el && !el.open) {
          opener.current = document.activeElement;
          el.showModal();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="lg-variantdlg-body">
        <h2 id={`${id}-h`} className="lg-h3 lg-wrap-any">
          Try a variant of {templateName}
        </h2>

        {(!proposal?.ok || again) && (
          <form action={ask} className="lg-variantdlg-ask">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="templateId" value={templateId} />
            <p>
              Coppice asks Google&apos;s AI for two or three versions of this template. Each changes one thing and nothing else, and code checks that before
              you see it. Nothing is saved until you start an experiment.
            </p>
            <p className="lg-hint">Sends Google this template&apos;s text and your verified facts. Uses an AI call.</p>
            {!asking && !again && proposal && !proposal.ok && <ErrorLine>{proposal.error}</ErrorLine>}
            {asking && <QuillWait label="Writing variants. This usually takes under a minute." />}
            <div className="lg-variantdlg-acts">
              <button type="button" className="lg-btn" onClick={close} disabled={asking}>
                Close
              </button>
              <button ref={askButton} type="submit" className="lg-btn lg-btn-primary" disabled={asking}>
                {asking ? "Writing..." : proposal && !proposal.ok ? "Try again" : again ? "Write new variants" : "Write variants"}
              </button>
            </div>
          </form>
        )}

        {proposal?.ok && !again && (
          <form action={start} className="lg-variantdlg-review">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="templateId" value={templateId} />
            <input type="hidden" name="variants" value={JSON.stringify(chosen)} />
            <p className="lg-hint">
              {proposal.data.dropped > 0
                ? `${proposal.data.dropped === 1 ? "One more" : `${proposal.data.dropped} more`} didn't pass Coppice's checks and ${proposal.data.dropped === 1 ? "was" : "were"} left out. `
                : ""}
              Each one below keeps your placeholders, adds no new numbers or links, and changes one place only. Pick one or two to run against your
              original.
            </p>
            {shown.length === 0 ? (
              <p className="lg-muted">You discarded all of them.</p>
            ) : (
              <ul className="lg-variants" aria-label="Variants">
                {shown.map(({ v, i }) => (
                  <VariantCard
                    key={i}
                    variant={v}
                    picked={picked.has(i)}
                    full={!picked.has(i) && picked.size >= MAX_PICKS}
                    disabled={busy}
                    onPick={() => toggle(i)}
                    onDiscard={(li) => void discard(i, li)}
                  />
                ))}
              </ul>
            )}
            {started && !started.ok && <ErrorLine>{started.error}</ErrorLine>}
            <div className="lg-variantdlg-acts">
              <button type="button" className="lg-btn" onClick={close} disabled={starting}>
                Close
              </button>
              {shown.length === 0 && (
                <button type="button" className="lg-btn" onClick={() => setAgain(true)}>
                  Ask for new ones
                </button>
              )}
              <button ref={startButton} type="submit" className="lg-btn lg-btn-primary" disabled={starting || chosen.length === 0}>
                {starting ? "Starting..." : chosen.length > 1 ? "Start experiment with 2" : "Start experiment"}
              </button>
            </div>
            <p className="lg-hint lg-variantdlg-note" role="status">
              {chosen.length === 0
                ? "Pick one or two."
                : `${chosen.length} picked. They run against the original, and the log form suggests whichever has the fewest sends.`}
            </p>
          </form>
        )}
      </div>
    </dialog>
  );
}

function VariantCard({
  variant,
  picked,
  full,
  disabled,
  onPick,
  onDiscard,
}: {
  variant: ProposedVariant;
  picked: boolean;
  full: boolean;
  disabled: boolean;
  onPick: () => void;
  onDiscard: (li: HTMLElement | null) => void;
}) {
  const id = useId();
  const li = useRef<HTMLLIElement>(null);
  const { change } = variant;
  return (
    <li ref={li} className="lg-variant" data-picked={picked || undefined}>
      <div className="lg-variant-head">
        <label className="lg-variant-pick">
          <input type="checkbox" className="lg-check" checked={picked} disabled={disabled || (full && !picked)} onChange={onPick} aria-describedby={`${id}-sum`} />
          <span className="lg-variant-title">
            <span className="lg-badge">{KIND_LABEL[variant.kind] ?? variant.kind}</span>
            <span className="lg-variant-run">Run this one</span>
          </span>
        </label>
        <button type="button" className="lg-btn lg-btn-sm lg-btn-quiet" onClick={() => onDiscard(li.current)} disabled={disabled}>
          Discard<span className="lg-sr"> the {KIND_LABEL[variant.kind] ?? variant.kind} variant</span>
        </button>
      </div>
      <p id={`${id}-sum`} className="lg-variant-summary">
        {variant.summary}
      </p>
      {change ? (
        <div className="lg-change" aria-label="What changed">
          <div className="lg-change-row" data-side="was">
            <span className="lg-change-tag">Was</span>
            <p className="lg-change-text">{change.was || "Nothing here. This sentence is new."}</p>
          </div>
          <div className="lg-change-row" data-side="now">
            <span className="lg-change-tag">Now</span>
            <p className="lg-change-text">{change.now || "Removed."}</p>
          </div>
        </div>
      ) : null}
      <Disclosure variant="inline" summary="Read the whole variant">
        <p className="lg-tpltext">{variant.body}</p>
      </Disclosure>
    </li>
  );
}
