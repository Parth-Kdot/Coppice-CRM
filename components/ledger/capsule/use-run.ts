"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/validation";

// Calls a Time Capsule server action from a button (not a form), keeping whether it is in flight
// and the last refusal, so a step can write the message where the person is looking. The action's
// own revalidation redraws the page; the result is returned for steps that report what happened.

export const toForm = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

export function useRun<T>(action: (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fields: Record<string, string>): Promise<ActionResult<T> | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await action(null, toForm(fields));
      if (!result.ok) setError(result.error);
      return result;
    } catch {
      setError("That didn't go through. Check your connection and try again.");
      return null;
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error, setError };
}

// ActionForm takes an action that returns no data. For an action that does return some (a count
// the margin note doesn't need), this is the same function seen that way: nothing is wrapped.
export const plain = <T>(action: (prev: ActionResult<T> | null, form: FormData) => Promise<ActionResult<T>>) =>
  action as unknown as (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
