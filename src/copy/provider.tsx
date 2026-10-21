"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getCopy } from "./index";
import type { CopyDictionary, SkinKey } from "./types";

interface CopyContextValue {
  skin: SkinKey;
  t: CopyDictionary;
}

const CopyContext = createContext<CopyContextValue | null>(null);

export function CopyProvider({ skin, children }: { skin: SkinKey; children: ReactNode }) {
  return (
    <CopyContext.Provider value={{ skin, t: getCopy(skin) }}>{children}</CopyContext.Provider>
  );
}

export function useCopy(): CopyDictionary {
  const ctx = useContext(CopyContext);
  if (!ctx) throw new Error("useCopy must be used inside <CopyProvider>");
  return ctx.t;
}

export function useSkin(): SkinKey {
  const ctx = useContext(CopyContext);
  if (!ctx) throw new Error("useSkin must be used inside <CopyProvider>");
  return ctx.skin;
}
