import type { ActionResult } from "@/lib/validation";

// A server action as the company page's forms run it.
export type Action = (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
