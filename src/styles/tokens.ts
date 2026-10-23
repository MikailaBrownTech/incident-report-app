/**
 * Colour tokens per skin. globals.css mirrors these values as CSS variables;
 * a test asserts the two stay in sync and that every pair meets WCAG AA.
 */
export const skinTokens = {
  haunted: {
    ground: "#120b1c",
    surface: "#1b1229",
    raised: "#261a38",
    rule: "#3a2a52",
    text: "#f1e9da",
    textMuted: "#a99bc0",
    accent: "#ff7a1a",
    accentText: "#14090a",
    accentSoft: "rgba(255,122,26,0.14)",
    link: "#b88cff",
    ok: "#8be04a",
    warn: "#ffc83d",
    danger: "#ff3b5c",
    sev1: "#7c8db5",
    sev2: "#8be04a",
    sev3: "#ffc83d",
    sev4: "#ff7a1a",
    sev5: "#ff3b5c",
  },
  professional: {
    ground: "#f6f7f5",
    surface: "#ffffff",
    raised: "#edf0ed",
    rule: "#d6dcd8",
    text: "#1b2420",
    textMuted: "#566660",
    accent: "#1f6f5c",
    accentText: "#ffffff",
    accentSoft: "rgba(31,111,92,0.12)",
    link: "#1f6f5c",
    ok: "#1f6f5c",
    warn: "#9a6300",
    danger: "#b5301f",
    sev1: "#5c7a82",
    sev2: "#2e8068",
    sev3: "#b07a1a",
    sev4: "#c2531a",
    sev5: "#a82a2a",
  },
} as const;

export type TokenName = keyof (typeof skinTokens)["haunted"];

const PAGE: TokenName[] = ["ground", "surface"];
const TEXT_TOKENS: TokenName[] = ["text", "textMuted", "accent", "link", "ok", "warn", "danger"];
const SEVERITY: TokenName[] = ["sev1", "sev2", "sev3", "sev4", "sev5"];

/**
 * [foreground, background, minimum ratio] pairs actually used in the UI. `rule` is a decorative divider and is exempt;
 * input borders use `textMuted` (the `field` token), which is covered by its text pairs. Severity colours tint a badge's
 * border and icon (3:1); the label itself is `text`, so the numeral stays readable.
 */
export const contrastPairs: ReadonlyArray<readonly [TokenName, TokenName, number]> = [
  ...TEXT_TOKENS.flatMap((fg) => PAGE.map((bg) => [fg, bg, 4.5] as const)),
  ["text", "raised", 4.5],
  ["textMuted", "raised", 4.5],
  ["link", "raised", 4.5],
  ["accentText", "accent", 4.5],
  ...SEVERITY.flatMap((fg) => PAGE.map((bg) => [fg, bg, 3] as const)),
];
