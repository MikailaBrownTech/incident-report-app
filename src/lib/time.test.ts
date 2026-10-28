import { describe, expect, it } from "vitest";
import { formatDuration, formatRelative, toLocalInput } from "./time";

const now = new Date("2026-03-10T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  it("describes the past in the largest sensible unit", () => {
    expect(formatRelative(ago(10_000), now)).toBe("now");
    expect(formatRelative(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(formatRelative(ago(MIN), now)).toBe("1 minute ago");
    expect(formatRelative(ago(3 * HOUR), now)).toBe("3 hours ago");
    expect(formatRelative(ago(DAY), now)).toBe("yesterday");
    expect(formatRelative(ago(3 * DAY), now)).toBe("3 days ago");
    expect(formatRelative(ago(14 * DAY), now)).toBe("2 weeks ago");
    expect(formatRelative(ago(70 * DAY), now)).toBe("2 months ago");
    expect(formatRelative(ago(800 * DAY), now)).toBe("2 years ago");
    expect(formatRelative(ago(364 * DAY), now)).toBe("11 months ago");
  });

  it("describes the future too", () => {
    expect(formatRelative(new Date(now.getTime() + 2 * HOUR), now)).toBe("in 2 hours");
  });
});

describe("formatDuration", () => {
  it("is compact at every scale", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(7 * MIN + 5000)).toBe("7m 05s");
    expect(formatDuration(3 * HOUR + 5 * MIN)).toBe("3h 05m");
    expect(formatDuration(2 * DAY + 4 * HOUR + 30 * MIN)).toBe("2d 4h");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});

describe("toLocalInput", () => {
  it("formats local time to the minute", () => {
    expect(toLocalInput(new Date(2026, 0, 2, 3, 4, 59))).toBe("2026-01-02T03:04");
    expect(toLocalInput(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31T23:59");
  });
});

describe("time helper boundaries", () => {
  it("switches relative units exactly at the threshold", () => {
    expect(formatRelative(ago(MIN - 1), now)).toBe("now");
    expect(formatRelative(ago(HOUR - 1), now)).toBe("59 minutes ago");
    expect(formatRelative(ago(HOUR), now)).toBe("1 hour ago");
    expect(formatRelative(ago(7 * DAY), now)).toBe("last week");
  });

  it("rolls durations over cleanly", () => {
    expect(formatDuration(59_999)).toBe("59s");
    expect(formatDuration(HOUR)).toBe("1h 00m");
    expect(formatDuration(DAY)).toBe("1d 0h");
  });
});
