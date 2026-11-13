"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { CONTACT_LIMITS } from "@/lib/limits";
import { Disclosure, LazyDisclosure, useLazyDisclosure } from "../disclosure";
import { focusSoon } from "../focus";
import { CopyLinkIcon } from "../icons";
import { OverflowMenu } from "../overflow-menu";
import { useNotify } from "../providers";
import { ShowMore } from "../show-more";
import type { Action } from "./types";
import "../company.css";
import "../templates.css";

type ContactData = { id: string; name: string; title: string | null; email: string | null };

function ContactInputs({ name, email, title }: { name?: string; email?: string | null; title?: string | null }) {
  return (
    <div className="lg-row3">
      <label className="lg-label">
        Name
        <input name="name" required maxLength={CONTACT_LIMITS.name} defaultValue={name} className="lg-input mt-1" />
      </label>
      <label className="lg-label">
        Title
        <input name="title" maxLength={CONTACT_LIMITS.title} defaultValue={title ?? ""} className="lg-input mt-1" />
      </label>
      <label className="lg-label">
        Email
        <input name="email" type="email" maxLength={254} defaultValue={email ?? ""} className="lg-input mt-1" />
      </label>
    </div>
  );
}

type ContactActions = { add: Action; update: Action; remove: Action };

function ContactRow({ contact, ids, actions, readOnly }: { contact: ContactData; ids: { workspaceId: string; companyId: string }; actions: ContactActions; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const notify = useNotify();
  const rowId = `contact-${contact.id}`;
  const copy = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      notify(`Copied ${email}.`);
    } catch {
      notify("Could not copy. Select the address and copy it yourself.", "error");
    }
  };
  return (
    <li id={rowId} className="lg-contact">
      <div className="lg-contact-line">
        <p className="lg-contact-who">
          <strong className="lg-trunc" title={contact.name}>
            {contact.name}
          </strong>
          {contact.title && (
            <span className="lg-trunc lg-muted" title={contact.title}>
              {contact.title}
            </span>
          )}
        </p>
        {contact.email ? (
          <span className="lg-contact-mail">
            <a href={`mailto:${contact.email}`} className="lg-link lg-trunc" title={contact.email}>
              {contact.email}
            </a>
            <button type="button" className="lg-copybtn" aria-label={`Copy ${contact.name}'s email`} title="Copy email" onClick={() => copy(contact.email as string)}>
              <CopyLinkIcon size={16} />
            </button>
          </span>
        ) : (
          <span className="lg-muted lg-contact-mail">No email</span>
        )}
        {!readOnly && (
          <OverflowMenu
            label={`More actions for ${contact.name}`}
            items={[
              {
                key: "edit",
                label: "Edit",
                onSelect: () => {
                  setEditing(true);
                  focusSoon(`#${rowId} .lg-contactedit input[name="name"]`);
                },
              },
              {
                key: "remove",
                label: "Remove",
                danger: true,
                action: actions.remove,
                fields: { ...ids, contactId: contact.id },
                confirmMessage: `Remove ${contact.name}? Their name and email are deleted.`,
                successMessage: `${contact.name} removed.`,
                focusAfter: "#contacts-h",
              },
            ]}
          />
        )}
      </div>
      {editing && (
        <div className="lg-contactedit">
          <ActionForm
            action={actions.update}
            submitLabel="Save contact"
            successMessage="Saved."
            onSuccess={() => setEditing(false)}
            focusAfter={`#${rowId} .lg-omenu-btn`}
            className="lg-contactform"
          >
            <input type="hidden" name="workspaceId" value={ids.workspaceId} />
            <input type="hidden" name="companyId" value={ids.companyId} />
            <input type="hidden" name="contactId" value={contact.id} />
            <ContactInputs name={contact.name} email={contact.email} title={contact.title} />
          </ActionForm>
          <button
            type="button"
            className="lg-btn lg-btn-sm lg-contactcancel"
            onClick={() => {
              setEditing(false);
              focusSoon(`#${rowId} .lg-omenu-btn`);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function AddContactForm({ ids, add }: { ids: { workspaceId: string; companyId: string }; add: Action }) {
  const lazy = useLazyDisclosure();
  return (
    <ActionForm action={add} submitLabel="Add contact" successMessage="Contact added." onSuccess={() => lazy?.close()} className="lg-contactform">
      <input type="hidden" name="workspaceId" value={ids.workspaceId} />
      <input type="hidden" name="companyId" value={ids.companyId} />
      <ContactInputs />
    </ActionForm>
  );
}

export function ContactsBlock({
  workspaceId,
  companyId,
  contacts,
  readOnly,
  actions,
}: {
  workspaceId: string;
  companyId: string;
  contacts: ContactData[];
  readOnly: boolean;
  actions: ContactActions;
}) {
  const ids = { workspaceId, companyId };
  const list =
    contacts.length === 0 ? (
      <p className="lg-muted">No contacts yet.</p>
    ) : (
      <ShowMore initial={3} label="contacts" as="ul" listClassName="lg-contacts">
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c} ids={ids} actions={actions} readOnly={readOnly} />
        ))}
      </ShowMore>
    );
  return (
    <section className="lg-block" aria-labelledby="contacts-h">
      <h2 id="contacts-h" className="lg-bh" tabIndex={-1}>
        Contacts
        {contacts.length > 0 && <span className="lg-bh-count">{contacts.length.toLocaleString("en-US")}</span>}
      </h2>
      {list}
      {!readOnly && (
        <LazyDisclosure summary="Add contact" variant="inline" className="lg-addcontact" data-tour="add-contact">
          <AddContactForm ids={ids} add={actions.add} />
        </LazyDisclosure>
      )}
    </section>
  );
}

// Contacts of an archived company: read-only, collapsed with the count.
export function ArchivedContacts({ contacts }: { contacts: ContactData[] }) {
  return (
    <Disclosure summary="Contacts" count={contacts.length} className="lg-codisc">
      {contacts.length === 0 ? (
        <p className="lg-muted">No contacts.</p>
      ) : (
        <ShowMore initial={3} label="contacts" as="ul" listClassName="lg-contacts">
          {contacts.map((c) => (
            <li key={c.id} className="lg-contact">
              <div className="lg-contact-line">
                <p className="lg-contact-who">
                  <strong className="lg-trunc" title={c.name}>
                    {c.name}
                  </strong>
                  {c.title && (
                    <span className="lg-trunc lg-muted" title={c.title}>
                      {c.title}
                    </span>
                  )}
                </p>
                <span className="lg-trunc lg-muted lg-contact-mail" title={c.email ?? undefined}>
                  {c.email ?? "No email"}
                </span>
              </div>
            </li>
          ))}
        </ShowMore>
      )}
    </Disclosure>
  );
}
