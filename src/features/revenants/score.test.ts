import { describe, expect, it } from "vitest";
import { getCopy } from "@/copy";
import { humanizeEvent } from "@/features/timeline/humanize";
import {
  MIN_SCORE,
  MIN_TITLE_SCORE,
  SERVICE_WEIGHT,
  TITLE_WEIGHT,
  jaccard,
  matchStrength,
  normalizeTitle,
  scorePair,
  titleSimilarity,
  trigramSimilarity,
} from "./score";

describe("normalizeTitle", () => {
  it.each([
    ["Checkout API timeouts", "checkout api timeouts"],
    ["Checkout API timeouts #2 (again!)", "checkout api timeouts again"],
    ["  Payment--webhook_failures 404  ", "payment webhook failures"],
    ["", ""],
    ["12345 !!!", ""],
    ["Café déjà vu", "café déjà vu"],
  ])("%j -> %j", (input, expected) => expect(normalizeTitle(input)).toBe(expected));
});

describe("trigramSimilarity (pg_trgm's rules)", () => {
  it("is 1 for equal text and 0 for nothing in common or empty text", () => {
    expect(trigramSimilarity("checkout", "checkout")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("", "abc")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });
  it("matches pg_trgm's known value for 'word' vs 'two words'", () => {
    // pg_trgm: similarity('word', 'two words') = 0.363636
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.363636, 5);
  });
  it("is symmetric and case-insensitive", () => {
    expect(trigramSimilarity("Checkout API", "api checkout")).toBeCloseTo(
      trigramSimilarity("api checkout", "CHECKOUT api"),
      10,
    );
  });
});

describe("titleSimilarity", () => {
  it("pairs look-alike titles and separates unrelated ones", () => {
    expect(titleSimilarity("Checkout API timeouts", "Checkout API timeout spike")).toBeGreaterThan(0.5);
    expect(titleSimilarity("Checkout API timeouts", "Invoice dates shown in wrong timezone")).toBeLessThan(0.2);
    expect(titleSimilarity("", "")).toBe(0);
  });
});

describe("jaccard", () => {
  it.each([
    [[], [], 0],
    [["a"], [], 0],
    [[], ["a"], 0],
    [["a", "b"], ["a", "b"], 1],
    [["a", "b"], ["b", "c"], 1 / 3],
    [["a", "a", "b"], ["b"], 1 / 2],
    [["a"], ["b"], 0],
  ])("%j vs %j = %d", (a, b, expected) =>
    expect(jaccard(a as string[], b as string[])).toBeCloseTo(expected as number, 10),
  );
});

describe("scorePair", () => {
  it("weights the title 65% and the services 35%", () => {
    expect(TITLE_WEIGHT + SERVICE_WEIGHT).toBeCloseTo(1, 10);
    expect(scorePair(0.4, 1).score).toBeCloseTo(0.65 * 0.4 + 0.35, 10);
  });
  it("qualifies at the combined threshold, or on a strong title alone", () => {
    expect(scorePair(0, 1).qualifies).toBe(true); // 0.35: exactly the threshold
    expect(scorePair(0.1, 0.9).qualifies).toBe(true);
    expect(scorePair(0.2, 0.5).qualifies).toBe(false); // 0.13 + 0.175 = 0.305
    expect(scorePair(MIN_TITLE_SCORE, 0).qualifies).toBe(true); // title alone
    expect(scorePair(MIN_TITLE_SCORE - 0.01, 0).qualifies).toBe(false);
    expect(MIN_SCORE).toBe(0.35);
  });
  it("labels matches strong from 0.5", () => {
    expect(matchStrength(0.5)).toBe("strong");
    expect(matchStrength(0.49)).toBe("possible");
  });
});

describe("timeline sentences for linking", () => {
  const sentence = (skin: "haunted" | "professional", type: string, payload: unknown) =>
    humanizeEvent({ type, payload }, { t: getCopy(skin), nameOf: () => "x", severityLabel: String });

  it("names the incidents involved, in both skins", () => {
    expect(sentence("professional", "REVENANT_LINKED", { role: "revenant", rootNumber: 12 })).toBe(
      "Linked as a recurrence of INC-12",
    );
    expect(sentence("professional", "REVENANT_LINKED", { role: "root", revenantNumber: 31 })).toBe(
      "INC-31 recorded as a recurrence",
    );
    expect(sentence("professional", "REVENANT_UNLINKED", { role: "revenant", rootNumber: 12 })).toBe(
      "Unlinked from INC-12",
    );
    expect(sentence("professional", "REVENANT_UNLINKED", { role: "root", revenantNumber: 31 })).toBe(
      "INC-31 unlinked as a recurrence",
    );
    expect(sentence("haunted", "REVENANT_LINKED", { role: "revenant", rootNumber: 12 })).toBe(
      "Bound as a revenant of Haunting #12",
    );
    expect(sentence("haunted", "REVENANT_UNLINKED", { role: "root", revenantNumber: 31 })).toBe(
      "Haunting #31 was freed from this haunting's chain",
    );
  });

  it("falls back to a plain sentence for old or malformed events", () => {
    expect(sentence("professional", "REVENANT_LINKED", {})).toBe("Linked to an earlier incident");
    expect(sentence("professional", "REVENANT_LINKED", null)).toBe("Linked to an earlier incident");
    expect(sentence("professional", "REVENANT_UNLINKED", "oops")).toBe("Unlinked from an earlier incident");
    expect(sentence("haunted", "REVENANT_UNLINKED", { role: "root" })).toBe(
      "The binding to an earlier haunting was broken",
    );
  });
});
