"use client";

import { useEffect, useRef } from "react";
import { focusSoon } from "./focus";

const SHORTCUTS: [string, string][] = [
  ["Tab", "Next column"],
  ["Up, Down", "Previous or next company in a column"],
  ["Left, Right", "The column beside it"],
  ["Enter", "Open the company"],
  ["m", "Move it to another stage, or claim it"],
  ["c", "Claim it"],
  ["Drag", "Drop a slip on another stage to move it"],
];

// "Keyboard shortcuts" from the More menu: a small dialog, so the keys are never a permanent line on
// the board. Escape or Close shuts it and focus goes back to the More button.
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => {
      el?.close();
      focusSoon('[data-tour="board-more"]');
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="lg-dialog lg-bkeys"
      aria-labelledby="board-keys-h"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="lg-bkeys-body">
        <h2 id="board-keys-h" className="lg-h3">
          Keyboard shortcuts
        </h2>
        <p className="lg-hint">On a focused company slip:</p>
        <dl className="lg-bkeys-list">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <div className="lg-bkeys-acts">
          <button type="button" className="lg-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
