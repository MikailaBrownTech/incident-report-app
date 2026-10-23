import { describe, expect, it } from "vitest";
import { keyBetween, needsRebalance, rebalancedKeys, slotFor, byPosition } from "./order";
import { parseListParams, parseListQuery, patchItemBody } from "./schema";
import { addDays, getActionItemState, isDay, localDay, utcDay } from "./state";

const TODAY = "2026-06-15";

describe("getActionItemState", () => {
  const open = (dueDate: string | null, status = "OPEN") => getActionItemState({ status, dueDate }, TODAY);

  it.each([
    ["due yesterday", "2026-06-14", "OVERDUE", 1],
    ["due long ago", "2026-05-15", "OVERDUE", 31],
    ["due today", "2026-06-15", "DUE_SOON", 0],
    ["due tomorrow", "2026-06-16", "DUE_SOON", 1],
    ["due in 3 days", "2026-06-18", "DUE_SOON", 3],
    ["due in 4 days", "2026-06-19", "ON_TRACK", 4],
    ["due next year", "2027-06-15", "ON_TRACK", 365],
  ])("%s", (_name, due, state, days) => {
    const r = open(due);
    expect(r.state).toBe(state);
    expect(r.daysUntil).toBe(state === "OVERDUE" ? -days : days);
    expect(r.daysLate).toBe(state === "OVERDUE" ? days : 0);
  });

  it("says no date for open and in-progress items without one", () => {
    expect(open(null).state).toBe("NO_DATE");
    expect(open(null, "IN_PROGRESS").state).toBe("NO_DATE");
    expect(open(null).daysUntil).toBeNull();
  });

  it("treats in progress like open", () => {
    expect(open("2026-06-01", "IN_PROGRESS").state).toBe("OVERDUE");
    expect(open("2026-06-16", "IN_PROGRESS").state).toBe("DUE_SOON");
  });

  it("never calls a finished item overdue, whatever its date", () => {
    expect(open("2026-01-01", "DONE").state).toBe("DONE");
    expect(open(null, "DONE").state).toBe("DONE");
    expect(open("2026-01-01", "WONT_DO").state).toBe("WONT_DO");
    expect(open("2026-01-01", "DONE").daysLate).toBe(0);
  });

  it("compares dates only, so a time of day can't change the answer", () => {
    const due = new Date("2026-06-15T00:00:00.000Z");
    expect(getActionItemState({ status: "OPEN", dueDate: due }, new Date("2026-06-15T23:59:59.999Z")).state).toBe(
      "DUE_SOON",
    );
    expect(getActionItemState({ status: "OPEN", dueDate: due }, new Date("2026-06-16T00:00:00.000Z")).state).toBe(
      "OVERDUE",
    );
    expect(getActionItemState({ status: "OPEN", dueDate: "2026-06-15T10:00:00.000Z" }, "2026-06-15").state).toBe(
      "DUE_SOON",
    );
  });

  it("handles month and year boundaries", () => {
    expect(getActionItemState({ status: "OPEN", dueDate: "2026-12-31" }, "2027-01-01").daysLate).toBe(1);
    expect(getActionItemState({ status: "OPEN", dueDate: "2026-03-02" }, "2026-02-27").daysUntil).toBe(3); // not a leap year
    expect(getActionItemState({ status: "OPEN", dueDate: "2028-03-01" }, "2028-02-27").daysUntil).toBe(3); // leap year: Feb 29 exists
  });
});

describe("day helpers", () => {
  it("round-trips real days and rejects impossible ones", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "26-06-15", "2026-6-5", "", null, 5, "2026-06-15T00:00:00Z"])
      expect(isDay(bad)).toBe(false);
  });

  it("does date math across month ends", () => {
    expect(addDays("2026-06-28", 7)).toBe("2026-07-05");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(utcDay(new Date("2026-06-15T23:30:00Z"))).toBe("2026-06-15");
  });

  it("reads the viewer's own calendar day for the local date", () => {
    expect(localDay(new Date(2026, 5, 15, 23, 30))).toBe("2026-06-15");
    expect(localDay(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("ordering helpers", () => {
  const col = (...positions: string[]) => positions.map((position, i) => ({ id: `id${i}`, position }));

  it("sorts by position as bytes, then by id", () => {
    const items = [
      { id: "b", position: "a1" },
      { id: "a", position: "a1" },
      { id: "c", position: "a0" },
      { id: "d", position: "aZ" },
      { id: "e", position: "aa" },
    ];
    expect(items.sort(byPosition).map((i) => i.id)).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("makes keys strictly between neighbours, and open-ended at the edges", () => {
    const mid = keyBetween("a0", "a1");
    expect("a0" < mid && mid < "a1").toBe(true);
    expect(keyBetween(null, "a0") < "a0").toBe(true);
    expect(keyBetween("a0", null) > "a0").toBe(true);
    expect(keyBetween(null, null)).toBeTruthy();
  });

  it("finds the slot after a card, before a card, or at the end", () => {
    const c = col("a0", "a1", "a2");
    expect(slotFor(c, "id0", null)).toEqual(["a0", "a1"]);
    expect(slotFor(c, "id2", null)).toEqual(["a2", null]);
    expect(slotFor(c, null, "id0")).toEqual([null, "a0"]);
    expect(slotFor(c, null, "id2")).toEqual(["a1", "a2"]);
    expect(slotFor(c, null, null)).toEqual(["a2", null]);
    expect(slotFor([], null, null)).toEqual([null, null]);
    expect(slotFor(c, "gone", "also-gone")).toEqual(["a2", null]);
    // after wins when both are given, and the "before" is whatever now follows it
    expect(slotFor(c, "id0", "id2")).toEqual(["a0", "a1"]);
  });

  it("asks for a rebalance only when keys collide or grow too long", () => {
    expect(needsRebalance(col("a0", "a1", "a2"))).toBe(false);
    expect(needsRebalance(col("a0", "a0"))).toBe(true);
    expect(needsRebalance(col("a0", "a" + "V".repeat(60)))).toBe(true);
    expect(needsRebalance([])).toBe(false);
  });

  it("makes evenly spaced, strictly increasing keys", () => {
    const keys = rebalancedKeys(40);
    expect(new Set(keys).size).toBe(40);
    expect([...keys].sort()).toEqual(keys);
    expect(rebalancedKeys(0)).toEqual([]);
  });
});

describe("request parsing", () => {
  it("applies defaults", () => {
    const r = parseListQuery({});
    expect(r).toMatchObject({
      ok: true,
      params: {
        owner: "any",
        status: [],
        overdue: false,
        dueThisWeek: false,
        incident: null,
        q: "",
        sort: "due",
        limit: 25,
        cursor: null,
        column: null,
        all: false,
      },
    });
  });

  it("accepts comma lists and repeated keys, and refuses bad values strictly", () => {
    expect(parseListQuery({ status: "OPEN,DONE" })).toMatchObject({ ok: true, params: { status: ["OPEN", "DONE"] } });
    expect(parseListQuery({ status: ["OPEN", "DONE"] })).toMatchObject({
      ok: true,
      params: { status: ["OPEN", "DONE"] },
    });
    for (const bad of [
      { status: "NOPE" },
      { overdue: "yes" },
      { incident: "0" },
      { incident: "x" },
      { limit: "0" },
      { limit: "101" },
      { sort: "random" },
      { column: "ALL" },
    ]) {
      expect(parseListQuery(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("is lenient for pages: it ignores only the bad parts", () => {
    const p = parseListParams({ status: "NOPE", owner: "me", overdue: "1", limit: "9999", q: "  hi  " });
    expect(p).toMatchObject({ status: [], owner: "me", overdue: true, limit: 25, q: "hi" });
  });

  it("validates patch bodies", () => {
    expect(patchItemBody.safeParse({}).success).toBe(false);
    expect(patchItemBody.safeParse({ title: "ok" }).success).toBe(true);
    expect(patchItemBody.safeParse({ dueDate: null }).success).toBe(true);
    expect(patchItemBody.safeParse({ status: "WONT_DO", wontDoReason: "why" }).success).toBe(true);
    expect(patchItemBody.safeParse({ afterId: "a", beforeId: null }).success).toBe(true);
    expect(patchItemBody.safeParse({ dueDate: "2026-02-30" }).success).toBe(false);
    expect(patchItemBody.safeParse({ title: "x".repeat(201) }).success).toBe(false);
  });
});
