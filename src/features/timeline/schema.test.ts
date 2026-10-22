import { describe, expect, it } from "vitest";
import {
  BACKFILL_THRESHOLD_MS,
  canModifyNote,
  createNoteBody,
  decodeCursor,
  encodeCursor,
  isBackfilled,
  isManualNote,
  parseTimelineView,
  patchNoteBody,
  timelineQuerySchema,
} from "./schema";

describe("cursors", () => {
  it("round-trip a position and are URL-safe", () => {
    const at = new Date("2026-03-04T05:06:07.089Z");
    const cursor = encodeCursor(at, "cmabc123");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeCursor(cursor)!;
    expect(back.t.toISOString()).toBe(at.toISOString());
    expect(back.i).toBe("cmabc123");
  });

  it("reject anything that isn't one", () => {
    for (const bad of [
      "",
      "abc",
      "!!!",
      btoa("not json"),
      btoa(JSON.stringify({ t: "x", i: "a" })),
      btoa(JSON.stringify({ t: "2026-01-01T00:00:00Z" })),
      btoa(JSON.stringify({ t: 5, i: "a" })),
      btoa(JSON.stringify({ t: "2026-01-01T00:00:00Z", i: "" })),
    ]) {
      expect(decodeCursor(bad), bad).toBeNull();
    }
  });
});

describe("who may change a note", () => {
  const note = { type: "NOTE", source: "USER", actorId: "u1" };
  it("only manual notes are editable at all", () => {
    expect(isManualNote(note)).toBe(true);
    for (const e of [
      { type: "STATUS_CHANGED", source: "USER" },
      { type: "NOTE", source: "SYSTEM" },
      { type: "NOTE", source: "INTEGRATION" },
      { type: "NOTE", source: "SLACK" },
      { type: "ROLE_ASSIGNED", source: "USER" },
    ]) {
      expect(isManualNote(e), JSON.stringify(e)).toBe(false);
      expect(canModifyNote({ ...e, actorId: "u1" }, "u1", true), "even for an admin author").toBe(false);
    }
  });

  it("the author or an admin; nobody else", () => {
    expect(canModifyNote(note, "u1", false)).toBe(true);
    expect(canModifyNote(note, "u2", true)).toBe(true);
    expect(canModifyNote(note, "u2", false)).toBe(false);
    expect(canModifyNote({ ...note, actorId: null }, "u2", false)).toBe(false);
  });
});

describe("backfill marker", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();
  it("flags entries recorded more than 2 minutes from when they happened", () => {
    expect(isBackfilled({ occurredAt: at(0), createdAt: at(0) })).toBe(false);
    expect(isBackfilled({ occurredAt: at(0), createdAt: at(BACKFILL_THRESHOLD_MS) })).toBe(false); // exactly 2 min: not yet
    expect(isBackfilled({ occurredAt: at(0), createdAt: at(BACKFILL_THRESHOLD_MS + 1) })).toBe(true);
    expect(isBackfilled({ occurredAt: at(3_600_000), createdAt: at(0) })).toBe(true);
  });
});

describe("note bodies", () => {
  it("trims, requires text, caps at 5000, and defaults the key-moment flag", () => {
    expect(createNoteBody.parse({ body: "  hi  " })).toEqual({ body: "hi", isKeyMoment: false });
    expect(createNoteBody.safeParse({ body: "   " }).success).toBe(false);
    expect(createNoteBody.safeParse({}).success).toBe(false);
    expect(createNoteBody.safeParse({ body: "x".repeat(5000) }).success).toBe(true);
    expect(createNoteBody.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
    expect(createNoteBody.safeParse({ body: "x", occurredAt: "yesterday" }).success).toBe(false);
    expect(createNoteBody.safeParse({ body: "x", occurredAt: "2026-01-01T10:00:00+02:00" }).success).toBe(true);
    expect(createNoteBody.safeParse({ body: "x", isKeyMoment: "yes" }).success).toBe(false);
  });

  it("ignores fields clients must not set", () => {
    const parsed = createNoteBody.parse({
      body: "x",
      createdAt: "2020-01-01T00:00:00Z",
      source: "SYSTEM",
      type: "STATUS_CHANGED",
      actorId: "u9",
    });
    expect(Object.keys(parsed).sort()).toEqual(["body", "isKeyMoment"]);
  });

  it("a patch needs at least one real field", () => {
    expect(patchNoteBody.safeParse({}).success).toBe(false);
    expect(patchNoteBody.safeParse({ createdAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
    expect(patchNoteBody.safeParse({ isKeyMoment: false }).success).toBe(true);
    expect(patchNoteBody.safeParse({ body: "" }).success).toBe(false);
  });
});

describe("timeline query", () => {
  it("has defaults and accepts every documented parameter", () => {
    expect(timelineQuerySchema.parse({})).toEqual({ filter: "all", order: "asc", limit: 50 });
    const cursor = encodeCursor(new Date(), "x1");
    expect(
      timelineQuerySchema.parse({ filter: "key", order: "desc", limit: "25", cursor, after: "2026-01-01T00:00:00Z" }),
    ).toMatchObject({
      filter: "key",
      order: "desc",
      limit: 25,
      cursor,
    });
  });

  it("rejects bad values with codes", () => {
    const err = (raw: object) => {
      const r = timelineQuerySchema.safeParse(raw);
      return r.success ? null : Object.keys(r.error.flatten().fieldErrors).sort();
    };
    expect(err({ filter: "everything" })).toEqual(["filter"]);
    expect(err({ order: "sideways" })).toEqual(["order"]);
    for (const limit of ["0", "101", "x", "2.5", "-1"]) expect(err({ limit }), limit).toEqual(["limit"]);
    expect(err({ cursor: "garbage" })).toEqual(["cursor"]);
    expect(err({ after: "recently" })).toEqual(["after"]);
    expect(timelineQuerySchema.safeParse({ limit: "100" }).success).toBe(true);
  });

  it("the page's lenient parser falls back instead of failing", () => {
    expect(parseTimelineView({})).toEqual({ filter: "all", order: "asc" });
    expect(parseTimelineView({ filter: "notes", order: "desc" })).toEqual({ filter: "notes", order: "desc" });
    expect(parseTimelineView({ filter: "nope", order: ["desc", "asc"] })).toEqual({ filter: "all", order: "desc" });
  });
});
