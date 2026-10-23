import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Card order within a status column. Positions are fractional-indexing keys compared as plain strings (the column is
 * COLLATE "C" in the database), with the item id as the tie-break, so the order is always total and deterministic.
 */

/** A key longer than this means repeated inserts at one spot have used up the room; the column gets rebalanced. */
export const MAX_KEY_LENGTH = 48;

export interface Positioned {
  id: string;
  position: string;
}

/** The deterministic order everything uses. */
export const byPosition = (a: Positioned, b: Positioned) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const needsRebalance = (items: Positioned[]) => {
  const seen = new Set<string>();
  for (const i of items) {
    if (i.position.length > MAX_KEY_LENGTH || seen.has(i.position)) return true;
    seen.add(i.position);
  }
  return false;
};

/** Fresh, evenly spaced keys for `n` items in order. */
export const rebalancedKeys = (n: number): string[] => (n === 0 ? [] : generateNKeysBetween(null, null, n));

/** A key strictly between `before` and `after` (either may be null for "no limit"). Throws if before >= after. */
export const keyBetween = (before: string | null, after: string | null): string => generateKeyBetween(before, after);

/**
 * Where a dropped card goes, given the column (without the dragged card) in order and the card it was dropped after
 * and/or before. The neighbours are re-read from the current column, so if someone else changed the column since the
 * drag began the card still lands next to what it was dropped beside, and never gets a key another card already has.
 */
export function slotFor(
  column: Positioned[],
  afterId: string | null,
  beforeId: string | null,
): [string | null, string | null] {
  const sorted = [...column].sort(byPosition);
  const afterIndex = afterId ? sorted.findIndex((i) => i.id === afterId) : -1;
  const beforeIndex = beforeId ? sorted.findIndex((i) => i.id === beforeId) : -1;

  if (afterIndex >= 0) {
    // right after `after`, before whatever now follows it
    return [sorted[afterIndex].position, sorted[afterIndex + 1]?.position ?? null];
  }
  if (beforeIndex >= 0) {
    return [sorted[beforeIndex - 1]?.position ?? null, sorted[beforeIndex].position];
  }
  // no (usable) neighbour: the end of the column
  return [sorted.at(-1)?.position ?? null, null];
}
