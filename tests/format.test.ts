import { describe, expect, it, test } from "vitest";
import { formatCount, plural } from "@/lib/format";

describe("formatCount", () => {
  test.for([
    [0, "0"],
    [7, "7"],
    [1000, "1,000"],
    [1248, "1,248"],
    [1234567, "1,234,567"],
  ] as const)("%d reads %j", ([n, text]) => {
    expect(formatCount(n)).toBe(text);
  });
});

describe("plural", () => {
  test.for([
    [0, "facts"],
    [1, "fact"],
    [2, "facts"],
  ] as const)("%d picks the right word", ([n, word]) => {
    expect(plural(n, "fact", "facts")).toBe(`${n} ${word}`);
  });

  it("writes the count with thousands separators", () => {
    expect(plural(1248, "company", "companies")).toBe("1,248 companies");
  });
});
