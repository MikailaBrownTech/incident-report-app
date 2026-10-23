import { describe, expect, it } from "vitest";
import { bucketIncidents, granularityOf, parseRange, rangeStart } from "./range";

const now = new Date("2026-03-18T12:00:00Z"); // a Wednesday
const at = (iso: string) => new Date(iso);

describe("parseRange", () => {
  it("defaults to 30 days for anything unknown", () => {
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange("forever")).toBe("30d");
    expect(parseRange(["all", "7d"])).toBe("all");
  });
});

describe("rangeStart", () => {
  it("is null for all time and N days back otherwise", () => {
    expect(rangeStart("all", now)).toBeNull();
    expect(rangeStart("7d", now)?.toISOString()).toBe("2026-03-11T12:00:00.000Z");
  });
});

describe("bucketIncidents", () => {
  it("fills every day of a 7 day window, zeros included", () => {
    const b = bucketIncidents(
      [at("2026-03-18T01:00:00Z"), at("2026-03-18T09:00:00Z"), at("2026-03-12T09:00:00Z")],
      "7d",
      now,
    );
    expect(granularityOf("7d")).toBe("day");
    expect(b).toHaveLength(8);
    expect(b[0]).toEqual({ start: "2026-03-11", count: 0 });
    expect(b.find((x) => x.start === "2026-03-12")?.count).toBe(1);
    expect(b.at(-1)).toEqual({ start: "2026-03-18", count: 2 });
  });

  it("groups 90 days by Monday-first week", () => {
    const b = bucketIncidents(
      [at("2026-03-16T10:00:00Z"), at("2026-03-18T10:00:00Z"), at("2026-03-15T10:00:00Z")],
      "90d",
      now,
    );
    expect(b.at(-1)).toEqual({ start: "2026-03-16", count: 2 });
    expect(b.at(-2)).toEqual({ start: "2026-03-09", count: 1 });
  });

  it("runs all time by month from the oldest incident, and is one bucket when empty", () => {
    const b = bucketIncidents([at("2025-12-20T00:00:00Z"), at("2026-03-02T00:00:00Z")], "all", now);
    expect(b.map((x) => x.start)).toEqual(["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(b.map((x) => x.count)).toEqual([1, 0, 0, 1]);
    expect(bucketIncidents([], "all", now)).toEqual([{ start: "2026-03-01", count: 0 }]);
  });
});
