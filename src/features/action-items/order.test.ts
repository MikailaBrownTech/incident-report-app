import { describe, expect, it } from "vitest";
import { MAX_KEY_LENGTH, byPosition, keyBetween, needsRebalance, rebalancedKeys, slotFor } from "./order";

const col = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
];

describe("byPosition", () => {
  it("orders by position bytes, then id", () => {
    const items = [
      { id: "z", position: "a1" },
      { id: "y", position: "a1" },
      { id: "x", position: "B" },
      { id: "w", position: "a" },
    ];
    expect(items.sort(byPosition).map((i) => i.id)).toEqual(["x", "w", "y", "z"]);
  });
});

describe("needsRebalance", () => {
  it("flags duplicate or overlong keys only", () => {
    expect(needsRebalance(col)).toBe(false);
    expect(needsRebalance([...col, { id: "d", position: "a1" }])).toBe(true);
    expect(needsRebalance([{ id: "d", position: "a".repeat(MAX_KEY_LENGTH + 1) }])).toBe(true);
  });
});

describe("rebalancedKeys", () => {
  it("returns n strictly increasing keys", () => {
    expect(rebalancedKeys(0)).toEqual([]);
    const keys = rebalancedKeys(5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(5);
  });
});

describe("keyBetween", () => {
  it("lands strictly between its neighbours", () => {
    const k = keyBetween("a0", "a1");
    expect(k > "a0" && k < "a1").toBe(true);
  });

  it("throws when the neighbours are equal", () => {
    expect(() => keyBetween("a1", "a1")).toThrow();
  });
});

describe("slotFor", () => {
  it("drops after a card, before whatever now follows it", () => {
    expect(slotFor(col, "a", null)).toEqual(["a0", "a1"]);
    expect(slotFor(col, "c", null)).toEqual(["a2", null]);
  });

  it("drops before a card when there is no after", () => {
    expect(slotFor(col, null, "a")).toEqual([null, "a0"]);
    expect(slotFor(col, null, "c")).toEqual(["a1", "a2"]);
  });

  it("prefers after when both are given", () => {
    expect(slotFor(col, "a", "c")).toEqual(["a0", "a1"]);
  });

  it("falls back to the end when a neighbour has vanished", () => {
    expect(slotFor(col, "gone", null)).toEqual(["a2", null]);
    expect(slotFor([], null, null)).toEqual([null, null]);
  });
});
