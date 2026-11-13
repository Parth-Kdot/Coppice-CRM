import { maskContactDetails, numbersIn } from "@/lib/ai/text";
import { checkRules } from "@/lib/claim-rules";
import { placeholderProblem } from "@/lib/placeholders";
import { TEMPLATE_LIMITS, type VariantKind } from "@/lib/validation";

// The Template Lab's checks on a variant the model proposed. Pure and table-tested
// (tests/template-lab-check.test.ts). The model is never trusted: a variant that fails any check
// is dropped, and a variant that passes them all provably changes exactly one place in the
// template, keeps every placeholder, and says nothing with a number or link the template (or a
// verified fact) didn't already hold.

export type LabVariant = { kind: VariantKind; summary: string; body: string };

export type VariantProblem =
  | "empty"
  | "too_long"
  | "placeholders"
  | "placeholder_syntax"
  | "number"
  | "contact"
  | "link"
  | "claim"
  | "summary"
  | "identical"
  | "not_one_change"
  | "rewrite"
  | "wrong_place"
  | "not_shorter"
  | "duplicate";

// In plain words, for the one place a person might read why a variant was dropped.
export const PROBLEM_TEXT: Record<VariantProblem, string> = {
  empty: "The variant was empty.",
  too_long: "The variant was longer than a template can be.",
  placeholders: "The variant lost, added or changed a placeholder.",
  placeholder_syntax: "The variant broke a placeholder.",
  number: "The variant used a number the template and your verified facts don't have.",
  contact: "The variant held an email address or phone number.",
  link: "The variant added a link.",
  claim: "The variant added a claim about a past relationship.",
  summary: "The variant's summary used a number, link or contact detail it should not.",
  identical: "The variant was the same as the template.",
  not_one_change: "The variant changed more than one place.",
  rewrite: "The variant rewrote too much of the template to be one change.",
  wrong_place: "The variant didn't change the part it said it did.",
  not_shorter: "The variant said it was shorter but wasn't.",
  duplicate: "The variant matched another one.",
};

export type CheckContext = {
  // Every number in a verified fact (factNumbers in lib/claim-rules.ts): a variant may use these.
  factNumbers: readonly string[];
  // The longest a template may be.
  limit?: number;
};

// ----- Placeholders -----

// The {{...}} keys in a text, sorted, with repeats: the multiset a variant must keep exactly.
export const placeholderKeys = (text: string): string[] =>
  [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim()).sort();

// ----- Splitting into units -----

// A paragraph break and a line break are units of their own, so moving or removing one counts as a change.
export const PARAGRAPH = "¶";
export const LINE = "↵";

// Whitespace is collapsed inside a sentence, so spacing alone is never a change.
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// Sentences, then line breaks, then paragraph breaks, as one flat list: "Hi {{firstName}},", ¶,
// "We run a hackathon.", "Come see it.", ¶, ...
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, "\n").trim().split(/\n[ \t]*(?:\n[ \t]*)+/);
  paragraphs.forEach((paragraph, p) => {
    if (p > 0) units.push(PARAGRAPH);
    paragraph.split("\n").forEach((line, l) => {
      if (l > 0) units.push(LINE);
      for (const sentence of squash(line).split(/(?<=[.!?])\s+/)) if (sentence) units.push(sentence);
    });
  });
  return units;
}

// A unit that ends a sentence. A greeting ("Hi {{firstName}},") and a sign-off ("Thanks,",
// "{{senderName}}") do not, so "the first sentence" and "the last" mean the first and last of
// these, and a signature the variant leaves alone can't stop a closing change.
const ENDS_SENTENCE = /[.!?]["')\]]*$/;
const isContent = (unit: string) => ENDS_SENTENCE.test(unit);

// ----- Aligning two texts -----

export type Op = { op: "keep" | "del" | "add"; unit: string; a: number; b: number };

// The most units either text may have before it is refused as too long to compare (a template is
// at most 5,000 characters, so a real one is far below this).
export const MAX_UNITS = 1000;

// Aligns two unit lists as keeps, removals and additions. Among all alignments it takes the one
// with the fewest removals and additions (a longest common subsequence) and, among those, the one
// whose changes form the fewest separate runs, so two texts that differ in one place are never
// read as differing in two just because a repeated unit (a paragraph break) could be matched
// either way.
export function align(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // best[s][i * width + j]: the cheapest way to align a[i..] with b[j..], where s is 1 if the
  // alignment so far ends inside a run of changes. The cost is RUN * changes + runs started.
  const RUN = 10_000;
  const best = [new Int32Array((n + 1) * width), new Int32Array((n + 1) * width)];
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      for (const s of [0, 1]) {
        const start = s === 0 ? 1 : 0;
        let cost = Infinity;
        if (i < n && j < m && a[i] === b[j]) cost = best[0][(i + 1) * width + j + 1];
        if (i < n) cost = Math.min(cost, RUN + start + best[1][(i + 1) * width + j]);
        if (j < m) cost = Math.min(cost, RUN + start + best[1][i * width + j + 1]);
        best[s][i * width + j] = cost;
      }
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let s = 0;
  while (i < n || j < m) {
    const here = best[s][i * width + j];
    const start = s === 0 ? 1 : 0;
    if (i < n && j < m && a[i] === b[j] && here === best[0][(i + 1) * width + j + 1]) {
      ops.push({ op: "keep", unit: a[i], a: i++, b: j++ });
      s = 0;
    } else if (i < n && here === RUN + start + best[1][(i + 1) * width + j]) {
      ops.push({ op: "del", unit: a[i], a: i++, b: j });
      s = 1;
    } else {
      ops.push({ op: "add", unit: b[j], a: i, b: j++ });
      s = 1;
    }
  }
  return ops;
}

// The runs of consecutive removals and additions: each is one "change".
export function runsOf(ops: readonly Op[]): Op[][] {
  const runs: Op[][] = [];
  let open = false;
  for (const op of ops) {
    if (op.op === "keep") open = false;
    else if (open) runs[runs.length - 1].push(op);
    else {
      runs.push([op]);
      open = true;
    }
  }
  return runs;
}

// One change may touch at most this share of the template's sentences (and always at least one
// sentence), so rewriting everything and calling it one contiguous run is refused.
export const MAX_CHANGED_SHARE = 2 / 3;

// ----- The checks -----

const lengthOf = (text: string) => text.trim().length;

// Why a template can't be sent to the AI at all: it holds an email address or phone number, which
// would be masked in the prompt, so the variants could never be compared with it. Null if fine.
export const CONTACT_IN_TEMPLATE = "This template has an email address or phone number in it. Take contact details out of the template first, then try again.";
export function templateProblem(body: string): string | null {
  return maskContactDetails(body) === body && !/\[(?:email|phone)\]/i.test(body) ? null : CONTACT_IN_TEMPLATE;
}

// The first problem with one variant, or null if it passes every check. `original` is the
// template's body as stored.
export function checkVariant(original: string, variant: LabVariant, context: CheckContext): VariantProblem | null {
  const { body, kind, summary } = variant;
  if (!body.trim()) return "empty";
  if (body.length > (context.limit ?? TEMPLATE_LIMITS.body)) return "too_long";

  // Placeholders: the same ones, the same number of times, and no broken one.
  const keys = placeholderKeys(body);
  const before = placeholderKeys(original);
  if (keys.length !== before.length || keys.some((key, i) => key !== before[i])) return "placeholders";
  if (placeholderProblem(body) !== null) return "placeholder_syntax";

  // Contact details: an email address or phone number is never added (the template had none, or
  // the Lab would have refused it, see templateProblem).
  if (maskContactDetails(body) !== body || /\[(?:email|phone)\]/i.test(body)) return "contact";

  // Numbers: only ones the template or a verified fact already holds.
  const allowed = new Set([...numbersIn(original), ...context.factNumbers]);
  if (numbersIn(body).some((n) => !allowed.has(n))) return "number";

  // Links and past-relationship claims the template didn't already make.
  const rules = { factNumbers: [], website: null };
  const known = new Set(checkRules(original, rules).map((f) => `${f.kind}:${f.quote.toLowerCase()}`));
  for (const finding of checkRules(body, rules)) {
    if (finding.kind === "number" || known.has(`${finding.kind}:${finding.quote.toLowerCase()}`)) continue;
    return finding.kind === "link" ? "link" : "claim";
  }

  // The summary is shown to the owner next to the variant, so it can't promise a number either.
  if (numbersIn(summary).some((n) => !allowed.has(n)) || maskContactDetails(summary) !== summary || checkRules(summary, rules).some((f) => f.kind === "link")) {
    return "summary";
  }

  // Exactly one change.
  const was = splitUnits(original);
  const now = splitUnits(body);
  if (was.length > MAX_UNITS || now.length > MAX_UNITS) return "not_one_change";
  const ops = align(was, now);
  const runs = runsOf(ops);
  if (runs.length === 0) return "identical";
  if (runs.length > 1) return "not_one_change";
  const run = runs[0];
  const removed = run.filter((op) => op.op === "del");
  const added = run.filter((op) => op.op === "add");

  // Not most of the template: at most two thirds of its sentences, and always at least one. A
  // sentence is a unit that ends one; a template with none (no full stops at all) counts every line.
  const isSentence = was.some(isContent) ? isContent : (unit: string) => unit !== PARAGRAPH && unit !== LINE;
  const sentences = was.filter(isSentence).length;
  const changed = Math.max(removed.filter((op) => isSentence(op.unit)).length, added.filter((op) => isSentence(op.unit)).length);
  if (changed > Math.max(1, Math.floor(sentences * MAX_CHANGED_SHARE))) return "rewrite";

  // Where it happened, for the kinds that name a place: the run must include the first (opening)
  // or last (closing) sentence, as removed from the template or as added to the variant. An
  // opening may also be a change to the very first line, the greeting.
  if (kind === "opening" || kind === "closing") {
    const pick = (units: readonly string[]) => {
      const found = units.map((unit, index) => ({ unit, index })).filter((u) => isSentence(u.unit));
      const unit = kind === "opening" ? found[0] : found[found.length - 1];
      return unit ? unit.index : -1;
    };
    const wasAt = [pick(was), ...(kind === "opening" ? [0] : [])];
    const nowAt = [pick(now), ...(kind === "opening" ? [0] : [])];
    if (!removed.some((op) => wasAt.includes(op.a)) && !added.some((op) => nowAt.includes(op.b))) return "wrong_place";
  }
  if (kind === "shorter" && lengthOf(body) >= lengthOf(original)) return "not_shorter";
  return null;
}

// The variants that pass every check, in order, and why each of the others was dropped. A variant
// that matches one already kept is dropped too (the first of two copies stays).
export function checkVariants(
  original: string,
  variants: readonly LabVariant[],
  context: CheckContext,
): { kept: LabVariant[]; dropped: { index: number; problem: VariantProblem }[] } {
  const kept: LabVariant[] = [];
  const dropped: { index: number; problem: VariantProblem }[] = [];
  const seen = new Set<string>();
  variants.forEach((variant, index) => {
    const problem = checkVariant(original, variant, context);
    if (problem) return dropped.push({ index, problem });
    const key = splitUnits(variant.body).join("\u0001");
    if (seen.has(key)) return dropped.push({ index, problem: "duplicate" });
    seen.add(key);
    kept.push(variant);
  });
  return { kept, dropped };
}

// A variant as it will be stored: line breaks as \n and no space around it. The checks run on this form.
export const normaliseVariant = (variant: LabVariant): LabVariant => ({
  ...variant,
  summary: variant.summary.trim(),
  body: variant.body.replace(/\r\n?/g, "\n").trim(),
});
