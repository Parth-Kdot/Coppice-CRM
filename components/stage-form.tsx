"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { MoveResult } from "@/app/(app)/[workspaceId]/companies/actions";
import { focusSoon } from "@/components/ledger/focus";
import { ChevronDownIcon } from "@/components/ledger/icons";
import { MoveMenu } from "@/components/ledger/move-menu";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import { ReplyPrompt } from "@/components/ledger/reply-prompt";
import type { Stage } from "@/generated/prisma/enums";
import type { ReplyChoice } from "@/lib/companies";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/validation";
import "@/components/ledger/company.css";
// The stage menu is the board's own (MoveMenu); its look lives with the board.
import "@/components/ledger/board.css";

type MoveAction = (prev: ActionResult<MoveResult> | null, form: FormData) => Promise<ActionResult<MoveResult>>;

// The stage control on the company page. The route map shows the stage; beside it one quiet button,
// "Move to Replied ▾", opens the stage menu (MoveMenu, the board's own) with every stage. A move
// forward runs at once. A move backwards (In conversation to Replied) and a move into Committed or
// Declined ask first: the first undoes progress, the second closes the pitch and releases any claim.
// A move into a reply stage then asks which outreach got the reply (ReplyPrompt). A refusal (someone
// else took the company meanwhile) is a toast.
//
// <StageMover> wraps the page and holds the menu, the move and the reply question. The button
// (<MoveToButton>) and the header's ⋯ items ("Move to…", "Reopen…") both open the same menu
// through useStageMove(), each anchored to itself.

// The line of a pitch, for "next" and "backwards". Declined sits after everything: leaving it is a reopen.
const RANK: Record<Stage, number> = { NOT_CONTACTED: 0, CONTACTED: 1, REPLIED: 2, IN_CONVERSATION: 3, COMMITTED: 4, DECLINED: 5 };
const NEXT: Partial<Record<Stage, Stage>> = { NOT_CONTACTED: "CONTACTED", CONTACTED: "REPLIED", REPLIED: "IN_CONVERSATION", IN_CONVERSATION: "COMMITTED" };

const nextStage = (stage: Stage): Stage | null => NEXT[stage] ?? null;

// What to ask before a move, or null to move at once.
function moveQuestion(companyName: string, from: Stage, to: Stage): { message: string; confirmLabel: string } | null {
  if (TERMINAL_STAGES.includes(to)) {
    return { message: `Move ${companyName} to ${STAGE_LABELS[to]}? This closes the pitch and releases any claim.`, confirmLabel: `Move to ${STAGE_LABELS[to]}` };
  }
  if (RANK[to] < RANK[from]) {
    return TERMINAL_STAGES.includes(from)
      ? { message: `Reopen ${companyName} as ${STAGE_LABELS[to]}?`, confirmLabel: `Reopen as ${STAGE_LABELS[to]}` }
      : { message: `Move ${companyName} back from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}?`, confirmLabel: `Move back to ${STAGE_LABELS[to]}` };
  }
  return null;
}

type Ctx = { open: (anchor: HTMLElement) => void; pending: boolean; stage: Stage; companyName: string };
const StageMoveContext = createContext<Ctx | null>(null);
export const useStageMove = () => useContext(StageMoveContext);

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  stage: Stage;
  action: MoveAction;
  children: ReactNode;
};

export function StageMover({ workspaceId, companyId, companyName, stage, action, children }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [choices, setChoices] = useState<ReplyChoice[] | null>(null);
  const confirm = useConfirm();
  const notify = useNotify();
  // Where focus goes once a move (and its reply question) is done.
  const after = useRef('[data-tour="stage-move"]');

  const open = useCallback((el: HTMLElement) => setAnchor(el), []);
  const close = useCallback(
    (restore: boolean) => {
      const el = anchor;
      setAnchor(null);
      if (restore) el?.focus();
    },
    [anchor],
  );

  const move = async (to: Stage, from: HTMLElement | null) => {
    const ask = moveQuestion(companyName, stage, to);
    if (ask && !(await confirm(ask))) {
      from?.focus();
      return;
    }
    startTransition(async () => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("companyId", companyId);
      form.set("stage", to);
      const result = await action(null, form);
      if (!result.ok) {
        notify(result.error, "error");
        from?.focus();
        return;
      }
      notify(`Moved to ${STAGE_LABELS[to]}.`);
      // Back to the control that opened the menu, if it stays: a closed company has no Move
      // button, so a move into Committed or Declined (or one made from the ⋯ menu) ends on the ⋯ button.
      after.current = !TERMINAL_STAGES.includes(to) && from?.dataset.tour === "stage-move" ? '[data-tour="stage-move"]' : '[data-tour="company-more"]';
      if (result.data?.replyChoices) setChoices(result.data.replyChoices);
      else startTransition(() => focusSoon(after.current));
    });
  };

  const ctx = useMemo(() => ({ open, pending, stage, companyName }), [open, pending, stage, companyName]);

  return (
    <StageMoveContext value={ctx}>
      {children}
      {anchor && (
        <MoveMenu
          anchor={anchor}
          companyName={companyName}
          current={stage}
          onClose={close}
          onPick={(to) => {
            const from = anchor;
            setAnchor(null);
            void move(to, from);
          }}
        />
      )}
      {choices && (
        <ReplyPrompt
          workspaceId={workspaceId}
          companyId={companyId}
          companyName={companyName}
          choices={choices}
          onDone={() => {
            setChoices(null);
            focusSoon(after.current);
          }}
        />
      )}
    </StageMoveContext>
  );
}

// "Move to Replied ▾" beside the route map. Only drawn where a move can work (the page leaves it
// out for an officer on someone else's claim, a closed company and an archived one).
export function MoveToButton() {
  const ctx = useStageMove();
  if (!ctx) return null;
  const next = nextStage(ctx.stage);
  const text = next ? `Move to ${STAGE_LABELS[next]}` : "Move to";
  return (
    <button
      type="button"
      className="lg-btn lg-btn-sm lg-moveto"
      aria-haspopup="menu"
      aria-label={`${text}: choose the stage for ${ctx.companyName}`}
      aria-disabled={ctx.pending || undefined}
      data-tour="stage-move"
      onClick={(event) => {
        if (ctx.pending) return;
        ctx.open(event.currentTarget);
      }}
    >
      <span>{ctx.pending ? "Moving..." : text}</span>
      <ChevronDownIcon size={15} />
    </button>
  );
}
