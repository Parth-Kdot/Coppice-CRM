import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TemplatesTable } from "@/components/ledger/stats-blocks";
import { rate, type Part, type TemplateLine } from "@/lib/stats-math";

// The templates table rendered on the server: the chance line appears only on the main row of a
// rated template in use that has one, never on the No template row, a split row or a retired row.

const PHRASE = "chance above the other rated templates";

const line = (key: string, replies: number, counted: number, archived = false, parts: Part[] = []): TemplateLine => ({
  key,
  name: key,
  archived,
  stat: rate({ sent: counted, counted, replies }),
  parts,
});

// The table's rows, each as its own markup, so a phrase can be pinned to the row it sits in.
const rowsOf = (html: string) => html.split("<tr").slice(1);
const rowOf = (html: string, name: string) => rowsOf(html).filter((r) => r.includes(`>${name}<`));

const render = (props: Partial<Parameters<typeof TemplatesTable>[0]> & { lines: TemplateLine[] }) =>
  renderToStaticMarkup(
    createElement(TemplatesTable, {
      noTemplate: line("none", 0, 30),
      best: null,
      worst: null,
      split: "none",
      ...props,
    }),
  );

describe("the chance line in the templates table", () => {
  const a = line("Alumni", 12, 20, false, [{ label: "Tech", stat: rate({ sent: 20, counted: 20, replies: 12 }) }]);
  const b = line("Career", 4, 20);
  const old = line("Old pitch", 15, 20, true);
  const thin = line("Thin", 2, 5);

  it("shows on rated templates in use that have a value, beside the standing and in Details", () => {
    const html = render({ lines: [a, b, old, thin], chances: { Alumni: 0.99456, Career: 0.00544 } });
    const [alumni] = rowOf(html, "Alumni");
    expect(alumni).toContain(`&gt;99% ${PHRASE}`);
    // Once beside the standing (wide screens) and once in Details (phones).
    expect(alumni.split(PHRASE)).toHaveLength(3);
    expect(rowOf(html, "Career")[0]).toContain(`&lt;1% ${PHRASE}`);
    expect(rowOf(html, "Thin")[0]).not.toContain(PHRASE);
  });

  it("never shows on a retired row, even if a value were passed for it, or on the No template row", () => {
    const html = render({ lines: [a, b, old], chances: { Alumni: 0.9, Career: 0.1, "Old pitch": 0.8, none: 0.5 } });
    expect(rowOf(html, "Old pitch")[0]).not.toContain(PHRASE);
    expect(rowOf(html, "No template")[0]).not.toContain(PHRASE);
  });

  it("never shows on a split row", () => {
    const html = render({ lines: [a, b], split: "industry", chances: { Alumni: 0.9, Career: 0.1 } });
    const tech = rowsOf(html).filter((r) => r.includes(">Tech<"));
    expect(tech).toHaveLength(1);
    expect(tech[0]).not.toContain(PHRASE);
  });

  it("shows nothing when no chances are given", () => {
    expect(render({ lines: [a, b] })).not.toContain(PHRASE);
  });
});
