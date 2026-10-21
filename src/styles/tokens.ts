/**
 * Colour tokens per skin. globals.css mirrors these values as CSS variables;
 * a test asserts the two stay in sync and that every pair meets WCAG AA.
 */
export const skinTokens = {
  haunted: {
    bg: "#0d0b14",
    surface: "#171326",
    fg: "#e8e4f3",
    muted: "#b3abc9",
    accent: "#c9a0ff",
    accentFg: "#150f24",
    danger: "#ff8a8a",
    success: "#7fe0a8",
    warning: "#ffc66b",
    border: "#6b5f8a",
  },
  professional: {
    bg: "#ffffff",
    surface: "#f4f5f7",
    fg: "#1a1d23",
    muted: "#4b5361",
    accent: "#2f4fd0",
    accentFg: "#ffffff",
    danger: "#b42318",
    success: "#157347",
    warning: "#8a5a00",
    border: "#7d8594",
  },
} as const;

export type TokenName = keyof (typeof skinTokens)["haunted"];

/** [foreground, background, minimum ratio] pairs actually used in the UI. */
export const contrastPairs: ReadonlyArray<readonly [TokenName, TokenName, number]> = [
  ["fg", "bg", 4.5],
  ["fg", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "surface", 4.5],
  ["accentFg", "accent", 4.5],
  ["danger", "bg", 4.5],
  ["danger", "surface", 4.5],
  ["success", "bg", 4.5],
  ["success", "surface", 4.5],
  ["warning", "bg", 4.5],
  ["warning", "surface", 4.5],
  ["border", "bg", 3],
  ["border", "surface", 3],
];
