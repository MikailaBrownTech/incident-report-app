import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, checkSlug, slugSchema, slugify, suggestSlug } from "./slug";

describe("checkSlug", () => {
  it("accepts 3-40 lowercase letters, digits and single hyphens", () => {
    for (const ok of ["abc", "acme", "acme-platform", "a1b2", "123", "a-b-c", "x".repeat(40)]) {
      expect(checkSlug(ok), ok).toBeNull();
    }
  });

  it("rejects bad shapes", () => {
    for (const bad of ["", "ab", "x".repeat(41), "Acme", "has space", "-lead", "trail-", "dou--ble", "under_score", "dot.dot", "émile"]) {
      expect(checkSlug(bad), JSON.stringify(bad)).toBe("slug_invalid");
    }
  });

  it("rejects the reserved words", () => {
    expect([...RESERVED_SLUGS]).toEqual(["app", "api", "admin", "settings", "sign-in", "sign-up", "onboarding", "dev"]);
    for (const word of RESERVED_SLUGS) expect(checkSlug(word), word).toBe("slug_reserved");
    expect(checkSlug("app-team")).toBeNull(); // only exact matches are reserved
  });
});

describe("slugSchema", () => {
  it("trims, then reports the problem code as the issue message", () => {
    expect(slugSchema.parse("  acme  ")).toBe("acme");
    expect(slugSchema.safeParse("ab").error?.issues[0].message).toBe("slug_invalid");
    expect(slugSchema.safeParse("admin").error?.issues[0].message).toBe("slug_reserved");
  });
});

describe("slugify / suggestSlug", () => {
  it("makes a slug from a name", () => {
    expect(slugify("Acme Platform Team!")).toBe("acme-platform-team");
    expect(slugify("  Café  Déjà-vu ")).toBe("cafe-deja-vu");
    expect(slugify("***")).toBe("");
    expect(slugify("a".repeat(60)).length).toBe(40);
    expect(slugify("a".repeat(39) + " b c").endsWith("-")).toBe(false);
  });

  it("suggests something always valid", () => {
    for (const name of ["Acme", "A", "", "!!", "Admin", "API", "dev", "Sign In", "x".repeat(80), "日本語"]) {
      const slug = suggestSlug(name);
      expect(checkSlug(slug), `${name} -> ${slug}`).toBeNull();
    }
    expect(suggestSlug("Acme Platform")).toBe("acme-platform");
    expect(suggestSlug("Admin")).toBe("admin-team");
  });
});
