import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/server/auth/context", () => ({ getWorkspaceSkin: vi.fn() }));

import { DEFAULT_SKIN, parseSkin } from "./skin";

describe("parseSkin", () => {
  it("accepts the known skins", () => {
    expect(parseSkin("haunted")).toBe("haunted");
    expect(parseSkin("professional")).toBe("professional");
  });

  it("falls back to the default for anything else", () => {
    expect(DEFAULT_SKIN).toBe("haunted");
    expect(parseSkin(undefined)).toBe(DEFAULT_SKIN);
    expect(parseSkin(null)).toBe(DEFAULT_SKIN);
    expect(parseSkin("")).toBe(DEFAULT_SKIN);
    expect(parseSkin("Haunted")).toBe(DEFAULT_SKIN);
  });
});
