"use client";

import { primaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";

/** Error boundary for everything inside a workspace. */
export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  const t = useCopy();
  return (
    <div role="alert" className="space-y-3 rounded border border-danger p-6">
      <p className="text-lg font-semibold text-danger">{t.errors.somethingWrong}</p>
      <button type="button" onClick={reset} className={primaryButton}>
        {t.errors.tryAgain}
      </button>
    </div>
  );
}
