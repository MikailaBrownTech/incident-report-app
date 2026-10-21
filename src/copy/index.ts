import { haunted } from "./haunted";
import { professional } from "./professional";
import type { CopyDictionary, EmptyKey, SeverityLevel, SkinKey } from "./types";

export type {
  CopyDictionary,
  SkinKey,
  SeverityLevel,
  EmptyKey,
  IncidentStatusKey,
} from "./types";
export { EMPTY_KEYS } from "./types";

export const dictionaries: Record<SkinKey, CopyDictionary> = {
  haunted,
  professional,
};

export function getCopy(skin: SkinKey): CopyDictionary {
  return dictionaries[skin];
}

/** Workspace override ({"1": "Minor"}) wins over the skin default. */
export type SeverityOverrides = Partial<Record<string, string>> | null | undefined;

export function severityName(
  t: CopyDictionary,
  level: SeverityLevel,
  overrides?: SeverityOverrides,
): string {
  const custom = overrides?.[String(level)]?.trim();
  return custom ? custom : t.severity[level];
}

/**
 * Deterministic pick so SSR and hydration agree; the seed is stable per
 * page (e.g. the route name) rather than random.
 */
export function emptyMessage(t: CopyDictionary, key: EmptyKey, seed = 0): string {
  const options = t.empty[key];
  return options[Math.abs(seed) % options.length];
}
