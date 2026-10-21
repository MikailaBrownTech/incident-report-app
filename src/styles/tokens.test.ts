import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { contrastPairs, skinTokens, type TokenName } from "./tokens";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const cssVar = (name: TokenName) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function cssBlock(skin: string): string {
  const m = new RegExp(`\\[data-skin="${skin}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`No CSS block for ${skin} in globals.css`);
  return m[1];
}

describe("skin colour tokens", () => {
  for (const skin of ["haunted", "professional"] as const) {
    describe(skin, () => {
      it("meet WCAG AA for every pair used in the UI", () => {
        for (const [fg, bg, min] of contrastPairs) {
          const ratio = contrastRatio(skinTokens[skin][fg], skinTokens[skin][bg]);
          expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
        }
      });

      it("match the CSS variables in globals.css", () => {
        const block = cssBlock(skin);
        for (const [name, value] of Object.entries(skinTokens[skin])) {
          expect(block, name).toContain(`--${cssVar(name as TokenName)}: ${value};`);
        }
      });
    });
  }
});

describe("motion", () => {
  it("only animates inside prefers-reduced-motion: no-preference", () => {
    const outsideMedia = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/, "");
    expect(outsideMedia).not.toMatch(/animation\s*:/);
  });
});
