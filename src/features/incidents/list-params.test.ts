import { describe, expect, it } from "vitest";
import { numberFromQuery, parseListParams } from "./list-params";

describe("parseListParams", () => {
  it("has sensible defaults: open only, newest first", () => {
    expect(parseListParams({})).toEqual({
      q: "",
      status: [],
      severity: [],
      serviceIds: [],
      from: null,
      to: null,
      openOnly: true,
      sort: "started",
      dir: "desc",
      after: null,
    });
  });

  it("reads comma lists and repeated params, dropping invalid values", () => {
    const p = parseListParams({
      status: ["INVESTIGATING,RESOLVED", "bogus"],
      severity: "5, 3,9,x,3,0",
      service: ["a", "b,c", " "],
    });
    expect(p.status).toEqual(["INVESTIGATING", "RESOLVED"]);
    expect(p.severity).toEqual([5, 3]);
    expect(p.serviceIds).toEqual(["a", "b", "c"]);
  });

  it("validates sort, direction and dates", () => {
    expect(parseListParams({ sort: "severity" })).toMatchObject({ sort: "severity", dir: "desc" });
    expect(parseListParams({ sort: "status" })).toMatchObject({ sort: "status", dir: "asc" });
    expect(parseListParams({ sort: "number", dir: "asc" })).toMatchObject({ sort: "number", dir: "asc" });
    expect(parseListParams({ sort: "drop table", dir: "sideways" })).toMatchObject({ sort: "started", dir: "desc" });
    expect(parseListParams({ from: "2026-01-02", to: "2026-02-30" })).toMatchObject({ from: "2026-01-02", to: null });
    expect(parseListParams({ from: "yesterday", to: "2026-1-2" })).toMatchObject({ from: null, to: null });
  });

  it("open=0 turns the open-only default off; anything else keeps it", () => {
    expect(parseListParams({ open: "0" }).openOnly).toBe(false);
    expect(parseListParams({ open: "1" }).openOnly).toBe(true);
    expect(parseListParams({ open: "false" }).openOnly).toBe(true);
  });

  it("trims and caps the search text", () => {
    expect(parseListParams({ q: "  checkout  " }).q).toBe("checkout");
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("numberFromQuery", () => {
  it("recognises the ways people type an incident number", () => {
    for (const q of ["42", "#42", "INC-42", "inc42", "Haunting #42", "haunting 42", " 42 "]) {
      expect(numberFromQuery(q), q).toBe(42);
    }
  });

  it("ignores text that isn't just a number", () => {
    for (const q of ["checkout 42", "42 checkout", "", "abc", "4.2", "1234567890"]) {
      expect(numberFromQuery(q), q).toBeNull();
    }
  });
});
