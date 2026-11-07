"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/validation";
import { useFocusAfterCommit } from "./focus";
import { ChevronDownIcon, MoreIcon } from "./icons";
import { menuIndex, popoverPortal, usePopover, type MenuKey } from "./popover";
import { useConfirm, useNotify } from "./providers";

// The one "⋯ More" menu per object (company header, contact row, member row, board toolbar,
// template row, fact): secondary links, actions and destructive items.
//
//   <OverflowMenu label={`More actions for ${name}`} items={[
//     { key: "edit", label: "Edit details", onSelect: () => setEditing(true) },
//     { key: "stats", label: "Template stats", href: `/${ws}/stats` },
//     { key: "archive", label: "Archive", danger: true, action: archiveCompany, fields: { workspaceId, companyId },
//       confirmMessage: `Archive ${name}?`, successMessage: `${name} archived.`, focusAfter: "#archived-banner" },
//   ]} />
//
// Items: `href` (a link), `onSelect` (runs in the page; focus is handed back to the ⋯ button first,
// so onSelect may move it on), or `action` + `fields` (a server action posted with those fields as
// FormData, in a transition). An action item asks confirmMessage first (useConfirm); a `danger`
// action without one still confirms, with "<label>?". Success writes successMessage (useNotify) and
// then focuses `focusAfter` once the new render is in; a refusal is written as an error note. Danger
// items are rust text, set below a rule, never filled. `hint` is a muted second line. Disabled items
// stay focusable with aria-disabled and read their disabledReason (shown in place of the hint).
//
// Keyboard: the button opens on click, Enter, Space or ArrowDown (first enabled item) and ArrowUp
// (last enabled item). In the menu ArrowUp/Down move (wrapping), Home/End go to the first/last
// enabled item, Enter/Space activate, Escape closes and refocuses the button, Tab closes and moves
// on from the button. It also closes on focusout, a click outside, or a scroll that carries the
// button away. role=menu / menuitem; positioning is usePopover (popover.ts).
//
// The button shows MoreIcon alone unless `buttonText` is given; `label` is its accessible name, so
// when there is visible text, start `label` with it ("More actions for Acme" for "More"). `icon`
// replaces MoreIcon (the queue's "+ Add" menu passes PlusIcon) and `caret` adds a small chevron.

type ActionFields = {
  action: (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  confirmMessage?: string;
  successMessage?: string;
  focusAfter?: string;
};

export type OverflowItem = { key: string; label: string; hint?: string; danger?: boolean; disabled?: boolean; disabledReason?: string } & ({ href: string } | { onSelect: () => void } | ActionFields);

export function OverflowMenu({
  label,
  items,
  align = "right",
  buttonText,
  icon,
  caret = false,
  "data-tour": dataTour,
}: {
  label: string;
  items: OverflowItem[];
  align?: "left" | "right";
  buttonText?: string;
  icon?: ReactNode;
  caret?: boolean;
  "data-tour"?: string;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [pending, startTransition] = useTransition();
  const notify = useNotify();
  const confirm = useConfirm();
  const scheduleFocus = useFocusAfterCommit();
  const refs = useRef<(HTMLElement | null)[]>([]);
  // Which item takes focus when the menu opens.
  const openAt = useRef<"Home" | "End">("Home");

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) anchor?.focus();
  };

  const card = usePopover(anchor, open, { align, onDismiss: () => setOpen(false) });
  const disabled = items.map((item) => Boolean(item.disabled));

  useEffect(() => {
    if (!open) return;
    refs.current[menuIndex(disabled, -1, openAt.current)]?.focus();
    // Only when it opens: a re-render of the items must not move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openMenu = (at: "Home" | "End") => {
    if (pending || items.length === 0) return;
    openAt.current = at;
    setOpen(true);
  };

  const run = (item: ActionFields & { label: string; danger?: boolean }) => {
    const go = () =>
      startTransition(async () => {
        const data = new FormData();
        for (const [k, v] of Object.entries(item.fields)) data.set(k, v);
        const result = await item.action(null, data);
        if (result.ok) {
          if (item.successMessage) notify(item.successMessage);
          startTransition(() => scheduleFocus(item.focusAfter));
        } else {
          notify(result.error, "error");
        }
      });
    const message = item.confirmMessage ?? (item.danger ? `${item.label}?` : undefined);
    if (!message) return go();
    void confirm({ message, confirmLabel: item.label }).then((ok) => {
      if (ok) go();
    });
  };

  const activate = (item: OverflowItem) => {
    if (item.disabled) return;
    // Focus goes back to the button before the menu (and the focused item) leave the page.
    close(true);
    if ("onSelect" in item) item.onSelect();
    else if ("action" in item) run(item);
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      refs.current[menuIndex(disabled, current, event.key as MenuKey)]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // Focus the button now, so the browser's own Tab moves on from it, not from the end of <body>.
      close(true);
    } else if (event.key === " " && current >= 0 && refs.current[current]?.tagName === "A") {
      // Space does not follow a link on its own.
      event.preventDefault();
      refs.current[current]?.click();
    }
  };

  const onMenuBlur = () => {
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return;
      const active = document.activeElement;
      if (card.current?.contains(active) || anchor?.contains(active)) return;
      setOpen(false);
    });
  };

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="lg-btn lg-omenu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        data-tour={dataTour}
        data-pending={pending || undefined}
        onClick={() => (open ? close(false) : openMenu("Home"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? "End" : "Home");
          }
        }}
      >
        {icon ?? <MoreIcon size={18} />}
        {buttonText && <span>{buttonText}</span>}
        {caret && <ChevronDownIcon size={14} />}
        {pending && <span className="lg-sr">Working...</span>}
      </button>
      {open &&
        popoverPortal(
          <div ref={card} id={menuId} className="lg-omenu" role="menu" aria-label={label} onKeyDown={onMenuKey} onBlur={onMenuBlur}>
            {items.map((item, i) => {
              const note = item.disabled ? item.disabledReason : item.hint;
              const noteId = note ? `${id}-note-${i}` : undefined;
              const common = {
                ref: (el: HTMLElement | null) => {
                  refs.current[i] = el;
                },
                role: "menuitem",
                tabIndex: -1,
                className: `lg-omenu-item${item.danger ? " lg-omenu-danger" : ""}`,
                "aria-disabled": item.disabled || undefined,
                "aria-describedby": noteId,
              } as const;
              const body = (
                <>
                  <span className="lg-omenu-label">{item.label}</span>
                  {note && (
                    <span id={noteId} className="lg-omenu-hint">
                      {note}
                    </span>
                  )}
                </>
              );
              if ("href" in item && !item.disabled) {
                return (
                  <Link key={item.key} href={item.href} {...common} onClick={() => close(true)}>
                    {body}
                  </Link>
                );
              }
              return (
                <button key={item.key} type="button" {...common} onClick={() => activate(item)}>
                  {body}
                </button>
              );
            })}
          </div>,
          anchor,
        )}
    </>
  );
}
