"use client";

import { useCallback, useState } from "react";
import { claimCompany, forceRelease, moveStage, releaseClaim, setFollowUp } from "@/app/(app)/[workspaceId]/companies/actions";
import { focusSoon } from "@/components/ledger/focus";
import { completeStamp, removeAway } from "@/components/ledger/motion-kit";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import { STAGE_LABELS } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import type { ActionCard } from "./types";

// Confirming a card. A card changes nothing by itself: Confirm calls the app's own server action for
// its type (claimCompany, releaseClaim or forceRelease, moveStage, setFollowUp), and each of those
// checks the person, the workspace and the claim rules again. Moves that close a pitch, reopen one
// or go backwards ask first, in the page's own dialog, like the company page does. A change that
// went through stamps its card and the card leaves; a refusal is written under the card and the card
// stays. "Apply all" runs the follow-up cards one after another and says how many went through.

const UNSURE = "Coppice couldn't confirm that. Open the company to check before you try again.";

export type CardOutcome = { kind: "done"; replyChoices: boolean } | { kind: "refused"; error: string };

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const cardEl = (key: string) => document.querySelector<HTMLElement>(`[data-card-key="${key}"]`);

// Where focus goes when a card leaves: the next card's button, else the question box.
function nextFocus(li: HTMLElement | null): HTMLElement | null {
  const next = li?.nextElementSibling?.querySelector<HTMLElement>(".lg-askcard-go:not([disabled])");
  return next ?? document.querySelector<HTMLElement>('[data-tour="ask-coppice"]');
}

// If what had focus is gone once the cards have left, focus goes to the question box.
function rescueFocus() {
  focusSoon(() => {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected ? document.querySelector<HTMLElement>('[data-tour="ask-coppice"]') : null;
  });
}

function note(card: ActionCard): string {
  switch (card.type) {
    case "CLAIM":
      return `Claimed ${card.companyName}.`;
    case "RELEASE":
      return card.force ? `Cleared the claim on ${card.companyName}.` : `Released ${card.companyName}.`;
    case "MOVE_STAGE":
      return `${card.companyName} moved to ${card.stage ? STAGE_LABELS[card.stage] : "its new stage"}.`;
    default:
      return `Follow-up set for ${card.companyName}.`;
  }
}

export type CardRunner = {
  busy: (key: string) => boolean;
  error: (key: string) => string | undefined;
  // Confirmed, and staying on screen to say one more thing (which outreach got the reply).
  kept: (key: string) => boolean;
  run: (card: ActionCard) => Promise<void>;
  runAll: (cards: ActionCard[]) => Promise<void>;
  // A card whose log form was saved: it leaves.
  logged: (card: ActionCard) => Promise<void>;
  anyBusy: boolean;
};

export function useCardRunner({ workspaceId, onLeft, onChanged }: { workspaceId: string; onLeft: (card: ActionCard) => void; onChanged: () => void }): CardRunner {
  const confirm = useConfirm();
  const notify = useNotify();
  const [busy, setBusy] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kept, setKept] = useState<string[]>([]);

  const setBusyFor = useCallback((key: string, on: boolean) => setBusy((current) => (on ? [...current, key] : current.filter((k) => k !== key))), []);
  const setErrorFor = useCallback(
    (key: string, error: string | null) =>
      setErrors((current) => {
        const next = { ...current };
        if (error === null) delete next[key];
        else next[key] = error;
        return next;
      }),
    [],
  );

  const perform = useCallback(
    async (card: ActionCard): Promise<CardOutcome> => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("companyId", card.companyId);
      if (card.stage) form.set("stage", card.stage);
      if (card.followUpOn) form.set("followUpOn", card.followUpOn);
      try {
        let result: ActionResult<unknown>;
        let replyChoices = false;
        if (card.type === "CLAIM") result = await claimCompany(null, form);
        else if (card.type === "RELEASE") result = await (card.force ? forceRelease : releaseClaim)(null, form);
        else if (card.type === "SET_FOLLOW_UP") result = await setFollowUp(null, form);
        else if (card.type === "MOVE_STAGE") {
          const moved = await moveStage(null, form);
          replyChoices = moved.ok && (moved.data?.replyChoices.length ?? 0) > 0;
          result = moved;
        } else return { kind: "refused", error: "Use the log form for this one." };
        return result.ok ? { kind: "done", replyChoices } : { kind: "refused", error: result.error };
      } catch {
        return { kind: "refused", error: UNSURE };
      }
    },
    [workspaceId],
  );

  const finish = useCallback(
    async (card: ActionCard, replyChoices: boolean) => {
      const li = cardEl(card.key);
      const button = li?.querySelector(".lg-askcard-go");
      if (replyChoices) {
        // It stays: the link to the company is the next step.
        void completeStamp(button);
        setKept((current) => [...current, card.key]);
        onChanged();
        return;
      }
      await completeStamp(button);
      await removeAway(li, { focus: nextFocus(li) });
      onLeft(card);
      onChanged();
      rescueFocus();
    },
    [onChanged, onLeft],
  );

  const run = useCallback(
    async (card: ActionCard) => {
      // Closing a pitch, reopening one and going backwards ask first, like the company page does.
      if (card.confirm !== null || card.force) {
        const ok = await confirm({ message: card.text, confirmLabel: card.label });
        if (!ok) return;
      }
      setBusyFor(card.key, true);
      setErrorFor(card.key, null);
      const outcome = await perform(card);
      setBusyFor(card.key, false);
      if (outcome.kind === "refused") setErrorFor(card.key, outcome.error);
      if (outcome.kind !== "done") return;
      notify(note(card));
      await finish(card, outcome.replyChoices);
    },
    [perform, finish, confirm, notify, setBusyFor, setErrorFor],
  );

  const runAll = useCallback(
    async (cards: ActionCard[]) => {
      const todo = cards.filter((c) => c.legal && !c.opensForm);
      let done = 0;
      let refused = 0;
      for (const card of todo) {
        setBusyFor(card.key, true);
        setErrorFor(card.key, null);
        const outcome = await perform(card);
        setBusyFor(card.key, false);
        if (outcome.kind === "refused") {
          refused += 1;
          setErrorFor(card.key, outcome.error);
        } else if (outcome.kind === "done") {
          done += 1;
          await finish(card, false);
          await sleep(40);
        }
      }
      const said = done === 1 ? "Set 1 follow-up." : `Set ${done} follow-ups.`;
      notify(refused > 0 ? `${said} ${refused === 1 ? "1 was" : `${refused} were`} refused.` : said, refused > 0 ? "error" : "ok");
      rescueFocus();
    },
    [perform, finish, notify, setBusyFor, setErrorFor],
  );

  const logged = useCallback(
    async (card: ActionCard) => {
      const li = cardEl(card.key);
      await removeAway(li, { focus: nextFocus(li) });
      onLeft(card);
      onChanged();
      rescueFocus();
    },
    [onChanged, onLeft],
  );

  return {
    busy: (key) => busy.includes(key),
    error: (key) => errors[key],
    kept: (key) => kept.includes(key),
    run,
    runAll,
    logged,
    anyBusy: busy.length > 0,
  };
}
