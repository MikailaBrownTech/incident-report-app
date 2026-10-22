import { describe, expect, it } from "vitest";
import { numberFromQuery, parseListParams, parseListQuery, rawFromSearchParams } from "./list-params";

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
      limit: 25,
      cursor: null,
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

describe("parseListParams limit and cursor", () => {
  it("defaults to 25 per page, clamps to 100 and ignores nonsense", () => {
    expect(parseListParams({}).limit).toBe(25);
    expect(parseListParams({ limit: "10" }).limit).toBe(10);
    expect(parseListParams({ limit: "5000" }).limit).toBe(100);
    for (const bad of ["0", "-3", "abc", "2.5"]) expect(parseListParams({ limit: bad }).limit).toBe(25);
    expect(parseListParams({ cursor: " abc " }).cursor).toBe("abc");
  });
});

describe("parseListQuery (the API's strict parser)", () => {
  const ok = (raw: Record<string, string | string[] | undefined>) => {
    const r = parseListQuery(raw);
    if (!r.ok) throw new Error("expected ok: " + JSON.stringify(r.fieldErrors));
    return r.params;
  };
  const errors = (raw: Record<string, string | string[] | undefined>) => {
    const r = parseListQuery(raw);
    if (r.ok) throw new Error("expected errors");
    return r.fieldErrors;
  };

  it("accepts the same inputs as the page and produces the same params", () => {
    expect(ok({})).toEqual(parseListParams({}));
    const raw = {
      q: " slow ",
      status: "INVESTIGATING,RESOLVED",
      severity: ["5", "3"],
      service: "a,b",
      from: "2026-01-02",
      to: "2026-02-03",
      open: "0",
      sort: "severity",
      dir: "asc",
      limit: "10",
      cursor: "abc",
    };
    expect(ok(raw)).toEqual(parseListParams(raw));
    expect(ok(raw)).toMatchObject({ q: "slow", severity: [5, 3], serviceIds: ["a", "b"], openOnly: false, limit: 10 });
  });

  it("works from a real query string", () => {
    const raw = rawFromSearchParams(new URLSearchParams("status=MITIGATING&status=RESOLVED&severity=2&from="));
    expect(ok(raw)).toMatchObject({ status: ["MITIGATING", "RESOLVED"], severity: [2], from: null }); // blank date = not set
  });

  it("rejects invalid values instead of ignoring them, naming each field", () => {
    const e = errors({
      status: "DONE",
      severity: "9",
      from: "2026-02-30",
      to: "yesterday",
      open: "maybe",
      sort: "color",
      dir: "sideways",
      limit: "101",
    });
    expect(Object.keys(e).sort()).toEqual(["dir", "from", "limit", "open", "severity", "sort", "status", "to"]);
    expect(e.status).toContain("invalid_status");
    expect(e.severity).toContain("invalid_severity");
    expect(e.from).toContain("invalid_date");
    expect(e.limit).toContain("invalid_limit");
  });

  it("bounds the limit and text length", () => {
    expect(ok({ limit: "1" }).limit).toBe(1);
    expect(ok({ limit: "100" }).limit).toBe(100);
    for (const bad of ["0", "-1", "101", "1.5", "x"]) expect(errors({ limit: bad }).limit).toBeTruthy();
    expect(errors({ q: "x".repeat(101) }).q).toContain("too_long");
    expect(errors({ service: Array.from({ length: 26 }, (_, i) => "s" + i) }).service).toBeTruthy();
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
