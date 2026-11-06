"use client";

import { useState } from "react";
import { TEMPLATE_LIMITS } from "@/lib/validation";

// A template's name and text boxes. They hold their own values, so a refused save (an unknown
// placeholder, a name already taken) leaves what was typed in place instead of clearing the form.

const PLACEHOLDER_HINT = "Use {{firstName}}, {{senderName}} and {{orgName}} for the names. No other {{...}} is allowed.";

export function TemplateInputs({ idPrefix, name = "", body = "" }: { idPrefix: string; name?: string; body?: string }) {
  const [nameValue, setName] = useState(name);
  const [bodyValue, setBody] = useState(body);
  return (
    <>
      <div>
        <label className="lg-label" htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={TEMPLATE_LIMITS.name}
          value={nameValue}
          onChange={(e) => setName(e.target.value)}
          className="lg-input"
        />
      </div>
      <div>
        <label className="lg-label" htmlFor={`${idPrefix}-body`}>
          Text
        </label>
        <textarea
          id={`${idPrefix}-body`}
          name="body"
          required
          maxLength={TEMPLATE_LIMITS.body}
          rows={6}
          value={bodyValue}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={`${idPrefix}-hint`}
          className="lg-textarea"
        />
        <p id={`${idPrefix}-hint`} className="lg-hint mt-1">
          {PLACEHOLDER_HINT}
        </p>
      </div>
    </>
  );
}
