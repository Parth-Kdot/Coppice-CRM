"use client";

import { useId, useState, type ReactNode } from "react";
import { FactsIcon } from "@/components/ledger/icons";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import type { ActionResult } from "@/lib/validation";

// Once a packet has been read, the upload box gives way to one compact line per file: its name,
// pages and who uploaded it, "Replace" (opens the upload right under it) and a ⋯ menu holding
// "Delete file". Deleting a file also deletes every fact read from it.

export type PacketFile = { id: string; fileName: string; line: string };

export function PacketFiles({
  workspaceId,
  files,
  remove,
  upload,
}: {
  workspaceId: string;
  files: PacketFile[];
  remove: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  // The upload form and its notes, rendered by the page.
  upload: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section className="lg-packets" aria-label="Sponsorship packet" data-tour="facts-upload">
      <ul className="lg-packetlist">
        {files.map((file, i) => (
          <li key={file.id} className="lg-packet">
            <FactsIcon size={18} />
            <span className="lg-packet-name lg-wrap-any">{file.fileName}</span>
            <span className="lg-packet-meta">{file.line}</span>
            <span className="lg-packet-acts">
              {i === 0 && (
                <button
                  type="button"
                  className="lg-linkbtn"
                  aria-expanded={open}
                  aria-controls={`${id}-upload`}
                  onClick={() => setOpen(!open)}
                >
                  {open ? "Cancel" : "Replace"}
                </button>
              )}
              <OverflowMenu
                label={`More actions for ${file.fileName}`}
                items={[
                  {
                    key: "delete",
                    label: "Delete file",
                    hint: "And every fact read from it",
                    danger: true,
                    action: remove,
                    fields: { workspaceId, factSheetId: file.id },
                    confirmMessage: `Delete ${file.fileName} and every fact read from it? Facts added by hand stay.`,
                    successMessage: "File and its facts deleted.",
                    focusAfter: ".lg-page-facts .lg-h1",
                  },
                ]}
              />
            </span>
          </li>
        ))}
      </ul>
      <div id={`${id}-upload`} className="lg-packet-upload" hidden={!open}>
        <p className="lg-uploadnote">
          Read a newer packet. Its facts wait here for your check; the old file and the facts you verified from it stay until you delete it from its ⋯ menu.
        </p>
        {upload}
      </div>
    </section>
  );
}
