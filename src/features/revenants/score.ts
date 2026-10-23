/**
 * Revenant similarity: pure, browser-safe. Every threshold lives here so they are easy to find and change.
 */

/** Only incidents that started within this many days are candidates. */
export const LOOKBACK_DAYS = 365;
export const TITLE_WEIGHT = 0.65;
export const SERVICE_WEIGHT = 0.35;
/** A candidate qualifies at this combined score... */
export const MIN_SCORE = 0.35;
/** ...or when its title alone is at least this close, whatever the services. */
export const MIN_TITLE_SCORE = 0.5;
/** At or above this a match is labelled "strong" (and may appear under "Unlinked suspects"). */
export const STRONG_SCORE = 0.5;
export const DEFAULT_LIMIT = 5;
export const SUSPECT_LIMIT = 20;
/** A title shorter than this (after normalising) is too thin to compare. */
export const MIN_TITLE_LENGTH = 3;

/**
 * Lowercase, with digits and punctuation turned into spaces, so "Checkout API timeouts #2" and
 * "checkout api timeout spike" compare on their words. The database applies the same rule (`public.revenant_norm`).
 */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[\p{N}\p{P}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The trigram set pg_trgm builds: each word padded with two spaces in front and one behind. */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm's `similarity()`: shared trigrams over all trigrams, 0 to 1. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export const titleSimilarity = (a: string, b: string) => trigramSimilarity(normalizeTitle(a), normalizeTitle(b));

/** Overlap of two sets of ids: shared over all; 0 when either is empty. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const v of x) if (y.has(v)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export interface Scored {
  score: number;
  titleScore: number;
  serviceScore: number;
  qualifies: boolean;
}

export function scorePair(titleScore: number, serviceScore: number): Scored {
  const score = TITLE_WEIGHT * titleScore + SERVICE_WEIGHT * serviceScore;
  return { score, titleScore, serviceScore, qualifies: score >= MIN_SCORE || titleScore >= MIN_TITLE_SCORE };
}

export type MatchStrength = "strong" | "possible";
export const matchStrength = (score: number): MatchStrength => (score >= STRONG_SCORE ? "strong" : "possible");
