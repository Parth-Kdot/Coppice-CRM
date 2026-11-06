import { z } from "zod";

// Turns a Zod schema into the JSON Schema subset Gemini's structured output accepts
// (responseJsonSchema). Gemini rejects or silently drops keywords outside its list, so anything
// else is stripped here, and the model's reply is always re-checked with the same Zod schema
// (lib/ai/client.ts): limits like .max() on strings are enforced there, not by the model.

// Keywords Gemini documents for responseJsonSchema.
const ALLOWED = new Set([
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "properties",
  "additionalProperties",
  "required",
]);
// The only string formats Gemini documents.
const FORMATS = new Set(["date-time", "date", "time"]);
// The bounds Zod puts on every z.number().int(), which only add noise for the model.
const SAFE_INT = Number.MAX_SAFE_INTEGER;
// Gemini refuses a schema whose maxItems is large ("400 invalid argument", no detail): tested
// 2026-10-26, 60 works and 100 fails on 3.6 Flash and 3.5 Flash-Lite. Bigger caps are left out
// and enforced only by the Zod re-check.
const MAX_ITEMS_SENT = 50;

type Json = { [key: string]: unknown };

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== "object") return node;
  const source = node as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "oneOf") out.anyOf = clean(value);
    else if (key === "type" && Array.isArray(value)) {
      // Zod writes some unions as a list of types; Gemini documents anyOf instead.
      out.anyOf = value.map((type) => ({ type }));
    } else if (key === "const") {
      // A constant becomes a one-value enum, but Gemini only allows strings and numbers there.
      if (typeof value === "string" || typeof value === "number") out.enum = [value];
    } else if (key === "enum") {
      const values = (value as unknown[]).filter((v) => typeof v === "string" || typeof v === "number");
      if (values.length > 0) out.enum = values;
    } else if (key === "format") {
      if (FORMATS.has(value as string)) out.format = value;
    } else if ((key === "minimum" || key === "maximum") && Math.abs(value as number) >= SAFE_INT) {
      continue;
    } else if (key === "maxItems" && (value as number) > MAX_ITEMS_SENT) {
      continue;
    } else if (key === "properties") {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, clean(v)]));
    } else if (ALLOWED.has(key)) {
      out[key] = clean(value);
    }
  }
  // Objects never allow fields the schema doesn't name.
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function toGeminiSchema(schema: z.ZodType): Json {
  // io: "input" describes what the model must send; reused: "inline" avoids $ref/$defs.
  return clean(z.toJSONSchema(schema, { io: "input", reused: "inline", cycles: "throw" })) as Json;
}

// The same for Groq's strict structured output: every property required, every object closed,
// optional values as a union with null, and only the basic keywords it documents (types,
// properties, items, enum, anyOf, description). Length and count limits are left to the Zod
// re-check, like Gemini's.
const GROQ_ALLOWED = new Set(["type", "description", "enum", "items", "anyOf", "properties", "additionalProperties", "required"]);

function cleanForGroq(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanForGroq);
  if (node === null || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (key === "oneOf") out.anyOf = cleanForGroq(value);
    else if (key === "const") out.enum = [value];
    else if (key === "properties") out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, cleanForGroq(v)]));
    else if (GROQ_ALLOWED.has(key)) out[key] = cleanForGroq(value);
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    out.required = Object.keys((out.properties as Json | undefined) ?? {});
  }
  return out;
}

export function toGroqSchema(schema: z.ZodType): Json {
  return cleanForGroq(z.toJSONSchema(schema, { io: "input", reused: "inline", cycles: "throw" })) as Json;
}
