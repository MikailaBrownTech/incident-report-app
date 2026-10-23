"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useCopy } from "@/copy/provider";

type Kind = "success" | "error";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  action?: ToastAction;
}

const ToastContext = createContext<((kind: Kind, message: string, action?: ToastAction) => void) | null>(null);

/** Success/error toasts in a polite live region; each disappears after a few seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useCopy();
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: Kind, message: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, kind, message, action }]);
    setTimeout(() => setItems((current) => current.filter((i) => i.id !== id)), kind === "error" ? 8000 : 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="region"
        aria-label={t.a11y.toastRegion}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full rounded-pop border bg-surface px-4 py-3 text-sm shadow-pop ${
              item.kind === "error" ? "border-danger text-danger" : "border-success text-success"
            }`}
          >
            {item.message}
            {item.action && (
              <button
                type="button"
                className="ml-3 font-semibold underline"
                onClick={() => {
                  item.action!.onClick();
                  setItems((current) => current.filter((i) => i.id !== item.id));
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside <ToastProvider>");
  return useMemo(
    () => ({
      success: (message: string, action?: ToastAction) => push("success", message, action),
      error: (message: string) => push("error", message),
    }),
    [push],
  );
}
