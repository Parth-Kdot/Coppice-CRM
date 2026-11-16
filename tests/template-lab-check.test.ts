import { describe, expect, it, test } from "vitest";
import { factNumbers } from "@/lib/claim-rules";
import {
  align,
  checkContext,
  checkVariant,
  checkVariants,
  CONTACT_IN_TEMPLATE,
  LINE,
  normaliseVariant,
  PARAGRAPH,
  placeholderKeys,
  plain,
  runsOf,
  splitUnits,
  templateProblem,
  visible,
  type LabVariant,
  type VariantProblem,
} from "@/lib/template-lab/check";
import { describeChange } from "@/lib/template-lab/change";
import { TEMPLATE_LIMITS, type VariantKind } from "@/lib/validation";

// The Template Lab's checks, pure: a table of variants that must be dropped (each for its own
// reason) and of variants that must pass.

const ORIGINAL = `Hi {{firstName}},

I'm {{senderName}} from {{orgName}}. We run an annual hackathon for 600 students and we are looking for sponsors.

Would you be open to a 10 minute call this month?

Thanks,
{{senderName}}
{{orgName}}`;

const OPENER = "I'm {{senderName}} from {{orgName}}.";
const PITCH = "We run an annual hackathon for 600 students and we are looking for sponsors.";
const ASK = "Would you be open to a 10 minute call this month?";

// The original with one piece of its text replaced.
function swap(from: string, to: string, text = ORIGINAL): string {
  if (!text.includes(from)) throw new Error(`test text is missing: ${from}`);
  return text.replace(from, to);
}
const variant = (kind: VariantKind, body: string, summary = "Changes one place."): LabVariant => ({ kind, summary, body });
const FACTS = factNumbers([{ text: "The hackathon draws 1,200 attendees." }]);
const context = { factNumbers: FACTS };

describe("splitUnits", () => {
  it("splits into sentences, line breaks and paragraph breaks", () => {
    expect(splitUnits(ORIGINAL)).toEqual([
      "Hi {{firstName}},",
      PARAGRAPH,
      OPENER,
      PITCH,
      PARAGRAPH,
      ASK,
      PARAGRAPH,
      "Thanks,",
      LINE,
      "{{senderName}}",
      LINE,
      "{{orgName}}",
    ]);
  });

  it("ignores spacing inside a sentence and the kind of line ending", () => {
    expect(splitUnits("One   sentence.\r\n\r\n\r\nTwo\tsentences  here.  Three!")).toEqual(["One sentence.", PARAGRAPH, "Two sentences here.", "Three!"]);
    expect(splitUnits("  padded.  ")).toEqual(["padded."]);
  });

  it("treats a line break and a paragraph break as different units", () => {
    expect(splitUnits("a\nb")).toEqual(["a", LINE, "b"]);
    expect(splitUnits("a\n\nb")).toEqual(["a", PARAGRAPH, "b"]);
  });
});

describe("align and runsOf", () => {
  const ops = (a: string[], b: string[]) => align(a, b).map((o) => `${o.op === "keep" ? "=" : o.op === "del" ? "-" : "+"}${o.unit}`);

  it("aligns by the longest common subsequence", () => {
    expect(ops(["a", "b", "c"], ["a", "x", "c"])).toEqual(["=a", "-b", "+x", "=c"]);
    expect(ops(["a", "b"], ["a", "b"])).toEqual(["=a", "=b"]);
    expect(ops([], ["a"])).toEqual(["+a"]);
    expect(ops(["a"], [])).toEqual(["-a"]);
  });

  it("counts the runs of change", () => {
    expect(runsOf(align(["a", "b", "c"], ["a", "x", "c"]))).toHaveLength(1);
    expect(runsOf(align(["a", "b", "c", "d", "e"], ["a", "x", "c", "y", "e"]))).toHaveLength(2);
    expect(runsOf(align(["a", "b"], ["a", "b"]))).toHaveLength(0);
    // A replacement and a removal next to each other are one run.
    expect(runsOf(align(["a", "b", "c", "d"], ["a", "x"]))).toHaveLength(1);
  });
});

describe("placeholderKeys", () => {
  it("lists the keys with repeats, sorted, ignoring spaces inside the braces", () => {
    expect(placeholderKeys("Hi {{ firstName }}, {{senderName}} {{orgName}} {{senderName}}")).toEqual(["firstName", "orgName", "senderName", "senderName"]);
    expect(placeholderKeys("none")).toEqual([]);
  });
});

describe("checkVariant: variants that pass", () => {
  test.each<[string, LabVariant]>([
    ["an opening that replaces the first sentence", variant("opening", swap(OPENER, "I'm {{senderName}} from {{orgName}}, writing about our hackathon."))],
    ["an opening that adds a new first sentence", variant("opening", swap(OPENER, `Thanks for reading.\n\n${OPENER}`).replace("Thanks for reading.\n\n", "Thanks for reading. "))],
    ["an opening that changes only the greeting", variant("opening", swap("Hi {{firstName}},", "Hello {{firstName}},"))],
    ["an ask that replaces the question", variant("ask", swap(ASK, "Could we set up a short call?"))],
    ["a closing that replaces the last sentence", variant("closing", swap(ASK, "Reply to this email if you would like the sponsorship packet."))],
    ["a closing that adds a last sentence", variant("closing", swap(ASK, `${ASK} We would love to hear from you.`))],
    ["a shorter version that cuts one sentence", variant("shorter", swap(`${PITCH}\n\n`, "").replace("from {{orgName}}. ", "from {{orgName}}.\n\n"))],
    ["a number from the original, repeated", variant("ask", swap(ASK, "Do you have 10 minutes this month to talk?"))],
    ["a number from a verified fact", variant("opening", swap(OPENER, "I'm {{senderName}} from {{orgName}}, where 1,200 attendees come to our hackathon."))],
  ])("%s", (_name, v) => {
    // The test texts are built carefully; every one must end up changed in exactly one place.
    const problem = checkVariant(ORIGINAL, v, context);
    expect(problem).toBeNull();
  });

  test.each([
    ["a place written in capitals", "Could we talk about students in DC?"],
    ["a document abbreviation", "Could we talk? Send your CV first."],
    ["a sentence in another script on its own", "Могли бы мы поговорить?"],
    ["a name in another script next to English words", "Could we talk about the Привет team?"],
  ])("passes %s", (_name, text) => {
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, text)), context)).toBeNull();
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk soon?"), "Mentions DC and a CV."), context)).toBeNull();
  });

  it("allows a mixed-alphabet word the template already holds", () => {
    const original = ORIGINAL.replace("hackathon", "hackathon b\u0435st");
    expect(checkVariant(original, variant("ask", swap(ASK, "Could we talk soon?", original)), context)).toBeNull();
  });

  it("passes a shorter version that really is shorter by condensing one sentence", () => {
    const body = swap(PITCH, "We run a hackathon and need sponsors.");
    expect(checkVariant(ORIGINAL, variant("shorter", body), context)).toBeNull();
  });

  it("allows a link that was already in the template", () => {
    const original = `${ORIGINAL}\n\nSee www.riverbend.org/packet for details.`;
    const body = swap(ASK, "Could we talk soon?", original);
    expect(checkVariant(original, variant("ask", body), context)).toBeNull();
  });

  it("allows a change that spans two of three sentences, but nothing wider", () => {
    const two = swap(`${OPENER} ${PITCH}`, "I'm {{senderName}}, and {{orgName}} is a student group that runs a hackathon.");
    expect(checkVariant(ORIGINAL, variant("opening", two), context)).toBeNull();
  });
});

describe("checkVariant: numbers written in words and in other scripts", () => {
  it("allows a number word the template already has, and refuses the ones it lacks", () => {
    const original = ORIGINAL.replace("an annual hackathon", "a two day hackathon");
    expect(checkVariant(original, variant("ask", swap(ASK, "Could we talk for a bit? The hackathon runs two days.", original)), context)).toBeNull();
    expect(checkVariant(original, variant("ask", swap(ASK, "Could we talk for a bit? The hackathon runs three days.", original)), context)).toBe("number");
  });

  it("allows a number word a verified fact has, and not otherwise", () => {
    const ctx = checkContext([{ text: "Over a thousand students attend each year." }, { text: "The hackathon draws 1,200 attendees." }]);
    expect(ctx).toMatchObject({ factNumbers: ["1200"], factWords: ["thousand"] });
    const v = variant("ask", swap(ASK, "Could we talk about our thousand students?"));
    expect(checkVariant(ORIGINAL, v, ctx)).toBeNull();
    expect(checkVariant(ORIGINAL, v, context)).toBe("number");
    // A different number word from the same fact is not allowed.
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk about our million students?")), ctx)).toBe("number");
  });

  it("reads a fact's digits in any script, and the template's, as the numbers they are", () => {
    expect(checkContext([{ text: "Draws １，２００ attendees and ٣٠ teams." }]).factNumbers).toEqual(["1200", "30"]);
    // The same number in another script is the number the template holds: it is not an invented one.
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Do you have １０ minutes this month to talk?")), context)).toBeNull();
  });

  it("applies the same check to the summary: words, fullwidth and Arabic-Indic digits", () => {
    const ok = (summary: string) => checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk soon?"), summary), context);
    expect(ok("Asks in a plainer way, which may feel less like a sales pitch.".replace("less", "lighter"))).toBeNull();
    expect(ok("Reaches ten readers")).toBe("summary");
    expect(ok("Reaches 10 readers")).toBeNull();
    // "one" is an ordinary word in a summary ("swaps one sentence") and is not counted.
    expect(ok("Swaps one sentence for a softer one.")).toBeNull();
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk about one idea?")), context)).toBeNull();
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk about one thousand ideas?")), context)).toBe("number");
  });
});

describe("plain and visible", () => {
  it("read a text the way a person does", () => {
    expect(visible("a\u200bb\u00adc\u200dd\ufeffe")).toBe("abcde");
    expect(plain("５０００ ٥٠٠٠ ५००० 𝟓 ² ① ½ Ⅳ ｆｉｖｅ")).toBe("5000 5000 5000 5 2 1 1⁄2 IV five");
    expect(plain("Plain 123, and 4.5")).toBe("Plain 123, and 4.5");
  });
});

describe("a change that is one sentence swapped for a long unpunctuated block in a long template", () => {
  // Thirty sentences: twelve lines is under two thirds of them, so only the added length catches it.
  const long = `Hi {{firstName}},\n\n${Array.from({ length: 30 }, (_, i) => `Sentence ${String.fromCharCode(97 + (i % 26))}${"z".repeat(i)} is here.`).join(" ")}\n\n{{senderName}}\n{{orgName}}`;
  const sentence = "Sentence bz is here.";
  const lines = Array.from({ length: 12 }, (_, i) => `Another invented line number ${"w".repeat(i + 1)} about nothing at all in here`).join("\n");

  it("is a rewrite, and a plain one-sentence swap in the same template still passes", () => {
    expect(long).toContain(sentence);
    expect(checkVariant(long, variant("ask", long.replace(sentence, lines)), context)).toBe("rewrite");
    expect(checkVariant(long, variant("ask", long.replace(sentence, "Sentence replaced by a short one.")), context)).toBeNull();
  });
});

describe("describeChange", () => {
  it("shows the same text for a template that holds invisible characters as for one that doesn't", () => {
    expect(describeChange(ORIGINAL.replace(ASK, `${ASK}\u200b`), swap(ASK, "Could we talk soon?"))).toEqual(describeChange(ORIGINAL, swap(ASK, "Could we talk soon?")));
    expect(describeChange(ORIGINAL, ORIGINAL.replace(ASK, `${ASK}\u200b`))).toBeNull();
  });
});

describe("checkVariant: variants that are dropped", () => {
  const cases: [string, LabVariant, VariantProblem][] = [
    ["a lost placeholder", variant("closing", swap("{{orgName}}", "Riverbend", swap(ASK, "Could we talk?"))), "placeholders"],
    ["a placeholder written twice as many times", variant("ask", swap(ASK, "Could we talk, {{firstName}}?")), "placeholders"],
    ["an added placeholder", variant("ask", swap(ASK, "Could we talk, {{firstName}}? Reply to {{orgName}}.")), "placeholders"],
    ["a different placeholder", variant("ask", swap(ASK, "Could we talk, {{name}}?")), "placeholders"],
    ["a stray closing brace", variant("ask", swap(ASK, `Could we talk? }}`)), "placeholder_syntax"],
    ["an invented number", variant("opening", swap(OPENER, "I'm {{senderName}} from {{orgName}}, and 800 students came last year.")), "number"],
    ["a number changed in place", variant("ask", swap(ASK, "Would you be open to a 15 minute call this month?")), "number"],
    ["a number that only a different fact would allow", variant("ask", swap(ASK, "Could we talk about our 1,300 attendees?")), "number"],
    ["number words in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our five thousand students?")), "number"],
    ["number words in capitals in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our FIVE THOUSAND students?")), "number"],
    ["a Roman numeral in the body", variant("ask", swap(ASK, "Would your team sponsor the prize for edition IV?")), "number"],
    ["fullwidth digits in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our ５０００ students?")), "number"],
    ["Arabic-Indic digits in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our ٥٠٠٠ students?")), "number"],
    ["Devanagari digits in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our ५००० students?")), "number"],
    ["a mathematical bold digit in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our 𝟓𝟎𝟎𝟎 students?")), "number"],
    ["a superscript digit in the body", variant("ask", swap(ASK, "Would your team sponsor a prize for our 5² students?")), "number"],
    ["fullwidth letters spelling a number", variant("ask", swap(ASK, "Would your team sponsor a prize for our ｆｉｖｅ students?")), "number"],
    ["a number word the model hid with a zero-width space, once normalised", normaliseVariant(variant("ask", swap(ASK, "Would your team sponsor a prize for our fi\u200bve students?"))), "number"],
    ["a number word in a fraction of the pitch", variant("ask", swap(ASK, "Would you give half of a minute to talk?")), "number"],
    ["a Cyrillic look-alike inside a word in the body", variant("ask", swap(ASK, "Could we talk about the b\u0435st way to help?")), "mixed_script"],
    ["a Greek look-alike inside a word in the body", variant("ask", swap(ASK, "Could we talk about the b\u03b5st way to help?")), "mixed_script"],
    ["a fullwidth number word thrice", variant("ask", swap(ASK, "Could we talk about it ｔｈｒｉｃｅ?")), "number"],
    ["the number word single in the body", variant("ask", swap(ASK, "Could we talk about every single student?")), "number"],
    ["a Cyrillic look-alike inside a word in the summary", variant("ask", swap(ASK, "Could we talk soon?"), "Asks in a b\u0435tter way."), "summary"],
    ["an email address", variant("ask", swap(ASK, "Could you email dana@riverbend.org?")), "contact"],
    ["a phone number", variant("ask", swap(ASK, "Could you call 765-555-0142?")), "contact"],
    ["a masked contact token", variant("ask", swap(ASK, "Could you write to [email]?")), "contact"],
    ["a new link", variant("ask", swap(ASK, "Could we talk? See www.riverbend.org.")), "link"],
    ["a new domain written plainly", variant("ask", swap(ASK, "Could we talk? Look at riverbend.org.")), "link"],
    ["a claim about a past relationship", variant("opening", swap(OPENER, "Since you sponsored us before, I'm {{senderName}} from {{orgName}}.")), "claim"],
    ["a summary with an invented number", variant("ask", swap(ASK, "Could we talk soon?"), "Cuts the ask so replies rise by 40 percent."), "summary"],
    ["a summary with a link", variant("ask", swap(ASK, "Could we talk soon?"), "Based on www.example.com research."), "summary"],
    ["a summary with number words", variant("ask", swap(ASK, "Could we talk soon?"), "Doubles replies for five thousand readers"), "summary"],
    ["a summary with a number word alone", variant("ask", swap(ASK, "Could we talk soon?"), "Asks for a call twice as politely."), "summary"],
    ["a summary with fullwidth digits", variant("ask", swap(ASK, "Could we talk soon?"), "Reaches ５０００ readers."), "summary"],
    ["a summary with Arabic-Indic digits", variant("ask", swap(ASK, "Could we talk soon?"), "Reaches ٥٠٠٠ readers."), "summary"],
    ["a summary with a Roman numeral", variant("ask", swap(ASK, "Could we talk soon?"), "Follows the IV step plan."), "summary"],
    ["two separate changes", variant("ask", swap(ASK, "Could we talk soon?", swap(OPENER, "I'm {{senderName}} of {{orgName}}."))), "not_one_change"],
    ["a change in the middle and a change at the end", variant("ask", swap(ASK, "Could we talk soon?", swap(PITCH, "We run a hackathon."))), "not_one_change"],
    ["a paragraph break moved elsewhere", variant("ask", ORIGINAL.replace(`${OPENER} `, `${OPENER}\n\n`).replace("\n\nWould", " Would")), "not_one_change"],
    ["a full rewrite", variant("opening", "Hi {{firstName}},\n\nThis is {{senderName}}. Students from {{orgName}} put on a hackathon this spring. Sponsors get a table and a talk slot. Want to help? Reply to me.\n\nThanks,\n{{senderName}}\n{{orgName}}"), "rewrite"],
    ["a rewrite of every sentence, paragraph by paragraph", variant("opening", swap(ASK, "Interested?", swap(PITCH, "We host a hackathon.", swap(OPENER, "We are {{orgName}} and I am {{senderName}}.")))), "not_one_change"],
    ["a short rewrite that keeps only the greeting and signature", variant("shorter", "Hi {{firstName}},\n\nI'm {{senderName}} from {{orgName}}, short note.\n\nThanks,\n{{senderName}}\n{{orgName}}"), "rewrite"],
    ["one sentence replaced by twelve unpunctuated lines", variant("ask", swap(ASK, Array.from({ length: 12 }, (_, i) => `Line ${"x".repeat(50)} ${"y".repeat(i)}`.replace(/\d/g, "")).join("\n"))), "rewrite"],
    ["one sentence replaced by a long unpunctuated paragraph", variant("ask", swap(ASK, `${"word ".repeat(120)}`.trim())), "rewrite"],
    ["an identical variant", variant("ask", ORIGINAL), "identical"],
    ["a variant that only adds a zero-width space, once normalised", normaliseVariant(variant("ask", ORIGINAL.replace(ASK, `${ASK}\u200b`))), "identical"],
    ["a variant that only adds a zero-width space, not normalised", variant("ask", ORIGINAL.replace(ASK, `${ASK}\u200b`)), "hidden"],
    ["a variant that only adds a soft hyphen and a joiner, once normalised", normaliseVariant(variant("ask", ORIGINAL.replace("hackathon", "hack\u00adathon\u200d"))), "identical"],
    ["a variant that only changes spacing", variant("ask", ORIGINAL.replace("We run an annual", "We   run an annual").replace("\n\nWould", "\n\n\n\nWould") + "\n"), "identical"],
    ["an empty variant", variant("ask", "   "), "empty"],
    ["a variant that says shorter but is longer", variant("shorter", swap(ASK, `${ASK} We would be glad to tell you more about the event.`)), "not_shorter"],
    ["a variant that says shorter and is the same length", variant("shorter", swap(ASK, "Would you be open to a 10 minute call next month?")), "not_shorter"],
    ["an opening that changes only the ask", variant("opening", swap(ASK, "Could we talk soon?")), "wrong_place"],
    ["a closing that changes only the greeting", variant("closing", swap("Hi {{firstName}},", "Hello {{firstName}},")), "wrong_place"],
    ["a closing that changes only the opener", variant("closing", swap(OPENER, "I'm {{senderName}} of {{orgName}}.")), "wrong_place"],
  ];

  test.each(cases)("%s", (_name, v, problem) => {
    expect(checkVariant(ORIGINAL, v, context)).toBe(problem);
  });

  it("drops a variant over the template limit", () => {
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, `Could we talk? ${"x".repeat(120)}`)), { factNumbers: [], limit: 300 })).toBe("too_long");
    expect(checkVariant(ORIGINAL, variant("ask", swap(ASK, "Could we talk?")), { factNumbers: [], limit: 300 })).toBeNull();
    expect(TEMPLATE_LIMITS.body).toBe(5000);
  });
});

describe("a template with no full stops", () => {
  const original = "Hi {{firstName}},\n\nCan we talk about sponsoring {{orgName}}\n\nThanks\n{{senderName}}";

  it("counts every line as a sentence, so a one-line change still passes", () => {
    expect(checkVariant(original, variant("ask", swap("Can we talk about sponsoring {{orgName}}", "Could we chat about {{orgName}}", original)), context)).toBeNull();
    expect(checkVariant(original, variant("closing", swap("{{senderName}}", "{{senderName}}\nDana", original).replace("\nDana", "")), context)).toBe("identical");
  });
});

describe("checkVariants", () => {
  const good = (text: string) => variant("ask", swap(ASK, text));

  it("keeps the ones that pass and says why each of the others was dropped", () => {
    const result = checkVariants(ORIGINAL, [good("Could we talk soon?"), good("Could we talk, {{firstName}}? {{orgName}}."), variant("ask", ORIGINAL), good("Could we meet?")], context);
    expect(result.kept.map((v) => v.body)).toEqual([good("Could we talk soon?").body, good("Could we meet?").body]);
    expect(result.dropped).toEqual([
      { index: 1, problem: "placeholders" },
      { index: 2, problem: "identical" },
    ]);
  });

  it("keeps the first of two variants that match", () => {
    const a = good("Could we talk soon?");
    const b = variant("closing", a.body.replace("\r\n", "\n"), "A different note.");
    const result = checkVariants(ORIGINAL, [a, b, good("Could we meet?")], context);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toEqual([{ index: 1, problem: "duplicate" }]);
  });

  it("drops two that differ only in spacing", () => {
    const a = good("Could we talk soon?");
    const result = checkVariants(ORIGINAL, [a, { ...a, body: a.body.replace("Could we", "Could  we") }], context);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped.map((d) => d.problem)).toEqual(["duplicate"]);
  });

  it("keeps nothing when every variant fails", () => {
    expect(checkVariants(ORIGINAL, [variant("ask", ORIGINAL)], context)).toEqual({ kept: [], dropped: [{ index: 0, problem: "identical" }] });
  });
});

describe("templateProblem", () => {
  test.each([
    ["an email address", "Write to dana@riverbend.org."],
    ["a phone number", "Call 765-555-0142 any time."],
    ["a masked email", "Write to [email]."],
  ])("refuses a template with %s", (_name, body) => {
    expect(templateProblem(body)).toBe(CONTACT_IN_TEMPLATE);
  });

  it("accepts the ordinary template", () => {
    expect(templateProblem(ORIGINAL)).toBeNull();
  });
});

describe("normaliseVariant", () => {
  it("takes invisible characters out of the body and the summary", () => {
    expect(normaliseVariant({ kind: "ask", summary: " Sh\u200bort. ", body: "a\u200bb\u00ad\ufeff\r\nc\u200d" })).toEqual({ kind: "ask", summary: "Short.", body: "ab\nc" });
  });

  it("turns line endings into line feeds and trims", () => {
    expect(normaliseVariant({ kind: "ask", summary: "  Short.  ", body: "  a\r\nb\r\n\r\nc  \n" })).toEqual({ kind: "ask", summary: "Short.", body: "a\nb\n\nc" });
  });
});
