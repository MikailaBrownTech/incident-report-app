"use client";

import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { primaryButton, secondaryButton } from "@/components/form";
import { PostmortemBadge } from "@/components/postmortem-badge";
import { RichTextEditor } from "@/components/rich-text-editor";
import { useToast } from "@/components/toast";
import type { PostmortemSectionKey } from "@/copy/types";
import { useCopy } from "@/copy/provider";
import { docToMarkdown, emptyDoc, isMeaningful, sectionProgress, type Doc } from "@/features/postmortems/content";
import type { PostmortemPayload } from "@/features/postmortems/schema";
import { api } from "@/lib/api-client";

interface Props {
  slug: string;
  incidentNumber: number;
  initial: PostmortemPayload;
  /** The published payload, once publishing succeeds (or someone else already published it). */
  onPublished: (payload: PostmortemPayload) => void;
  /** Wait this long after the last keystroke before saving. */
  autosaveMs?: number;
  /** The action items panel: beside the sections on a wide screen, below them on a phone. */
  aside?: ReactNode;
  /** When it is 0, publishing asks "No action items yet. Publish anyway?" first. Left out: no question. */
  actionItemCount?: number;
  /** For a recurrence: shows the extra blameless prompt on "what went wrong" (helper text only, never stored). */
  isRevenant?: boolean;
  /** How many action items from earlier occurrences are still open; publishing warns (softly) when it is above 0. */
  earlierOpenItems?: number;
  /** Shown above the sections: what earlier occurrences left behind. */
  above?: ReactNode;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

const MAX_BACKOFF_MS = 30_000;

const scrollToSection = (key: string) =>
  document.getElementById(`section-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });

export function PostmortemEditor({
  slug,
  incidentNumber,
  initial,
  onPublished,
  autosaveMs = 1500,
  aside,
  actionItemCount,
  isRevenant = false,
  earlierOpenItems = 0,
  above,
}: Props) {
  const t = useCopy();
  const p = t.postmortem;
  const toast = useToast();
  const base = `/api/w/${slug}/incidents/${incidentNumber}/postmortem`;
  const defs = [...initial.template.sections].sort((a, b) => a.order - b.order);
  const titleOf = (key: string) => p.sections[key as PostmortemSectionKey]?.title ?? key;

  const [sections, setSections] = useState<Record<string, Doc>>(initial.postmortem.sections);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [conflict, setConflict] = useState<PostmortemPayload | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [askNoItems, setAskNoItems] = useState(false);
  const [askEarlier, setAskEarlier] = useState(false);
  const [promptOpen, setPromptOpen] = useState<Record<string, boolean>>({});

  // What the save logic reads is kept in refs, so a timer or a promise never sees stale values.
  const sectionsRef = useRef(sections);
  const versionRef = useRef(initial.postmortem.version);
  const dirtyRef = useRef(new Set<string>());
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef<PostmortemPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const reloadPublished = useCallback(async () => {
    const result = await api<PostmortemPayload>(base);
    if (result.ok) onPublished(result.data);
  }, [base, onPublished]);

  /** Save whatever is unsaved. Resolves true when nothing is left unsaved afterwards. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) {
      await inFlightRef.current;
      return flushRef.current();
    }
    if (conflictRef.current) return false;
    clearTimer();
    const keys = [...dirtyRef.current];
    if (keys.length === 0) return true;

    const run = async (): Promise<boolean> => {
      setSaveState("saving");
      keys.forEach((k) => dirtyRef.current.delete(k));
      let response: Response | null = null;
      try {
        response = await fetch(base, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: versionRef.current,
            sections: Object.fromEntries(keys.map((k) => [k, sectionsRef.current[k] ?? emptyDoc()])),
          }),
        });
      } catch {
        response = null;
      }
      const restore = () => keys.forEach((k) => dirtyRef.current.add(k));

      if (response?.ok) {
        const data = (await response.json()) as PostmortemPayload;
        versionRef.current = data.postmortem.version;
        attemptsRef.current = 0;
        setSavedAt(Date.now());
        setNow(Date.now());
        if (dirtyRef.current.size > 0) {
          setSaveState("dirty");
          timerRef.current = setTimeout(() => void flushRef.current(), autosaveMs);
          return false;
        }
        setSaveState("saved");
        return true;
      }

      restore();
      if (response?.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string };
          latest?: PostmortemPayload;
        } | null;
        if (body?.error?.code === "version_conflict" && body.latest) {
          conflictRef.current = body.latest;
          setConflict(body.latest);
          setSaveState("conflict");
          return false;
        }
        if (body?.error?.code === "postmortem_published") {
          toast.error(p.toasts.publishedElsewhere);
          dirtyRef.current.clear();
          void reloadPublished();
          return false;
        }
      }
      // network error or server trouble: keep the text, say so, try again with growing pauses
      setSaveState("error");
      attemptsRef.current += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attemptsRef.current - 1));
      timerRef.current = setTimeout(() => void flushRef.current(), delay);
      return false;
    };
    inFlightRef.current = run().finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, [autosaveMs, base, p.toasts.publishedElsewhere, reloadPublished, toast]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  function schedule() {
    clearTimer();
    if (conflictRef.current) return;
    timerRef.current = setTimeout(() => void flushRef.current(), autosaveMs);
  }

  function edit(key: string, doc: Doc) {
    sectionsRef.current = { ...sectionsRef.current, [key]: doc };
    setSections(sectionsRef.current);
    dirtyRef.current.add(key);
    if (!conflictRef.current) setSaveState("dirty");
    // a required section that now has enough text no longer needs flagging
    if (isMeaningful(doc)) setMissing((m) => (m.includes(key) ? m.filter((k) => k !== key) : m));
    schedule();
  }

  // Save on Ctrl/Cmd+S, and warn before leaving with anything unsaved.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushRef.current();
      }
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current.size > 0 || inFlightRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearTimer();
    };
  }, []);

  // "Saved 3s ago" ticks while there is nothing else to say.
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [saveState]);

  // ---- conflict ---------------------------------------------------------------------------------------------
  function takeLatest(latest: PostmortemPayload, keepMine: boolean) {
    const mineKeys = [...dirtyRef.current];
    const next = keepMine
      ? { ...latest.postmortem.sections, ...Object.fromEntries(mineKeys.map((k) => [k, sectionsRef.current[k]])) }
      : latest.postmortem.sections;
    // sections that now read differently get a fresh editor
    const changed = defs
      .filter((def) => JSON.stringify(next[def.key]) !== JSON.stringify(sectionsRef.current[def.key]))
      .map((def) => def.key);
    if (changed.length > 0) {
      setRevisions((r) => {
        const out = { ...r };
        for (const key of changed) out[key] = (out[key] ?? 0) + 1;
        return out;
      });
    }
    sectionsRef.current = next;
    setSections(next);
    versionRef.current = latest.postmortem.version;
    if (!keepMine) dirtyRef.current.clear();
    conflictRef.current = null;
    setConflict(null);
  }

  async function keepMine() {
    if (!conflict) return;
    const text = [...dirtyRef.current]
      .map((k) => `## ${titleOf(k)}\n\n${docToMarkdown(sectionsRef.current[k])}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // the copy is a courtesy; the text stays in the editor either way
    }
    takeLatest(conflict, true);
    void flush();
  }

  function loadTheirs() {
    if (!conflict) return;
    takeLatest(conflict, false);
    setSaveState("saved");
    toast.success(p.toasts.conflictLoaded);
  }

  // ---- timeline snapshot -------------------------------------------------------------------------------------
  async function refreshTimeline() {
    setRefreshing(true);
    const result = await api<{ doc: Doc }>(`${base}/timeline`);
    setRefreshing(false);
    setConfirmRefresh(false);
    if (!result.ok) {
      toast.error(p.toasts.saveFailed);
      return;
    }
    setRevisions((r) => ({ ...r, timeline: (r.timeline ?? 0) + 1 }));
    edit("timeline", result.data.doc);
    toast.success(p.toasts.timelineRefreshed);
  }

  // ---- publish -----------------------------------------------------------------------------------------------
  /** A soft warning, never a block: with no action items, ask once before publishing. */
  function requestPublish() {
    if (actionItemCount === 0) setAskNoItems(true);
    else if (earlierOpenItems > 0) setAskEarlier(true);
    else void publish();
  }

  async function publish() {
    setAskNoItems(false);
    setAskEarlier(false);
    setPublishing(true);
    setMissing([]);
    const saved = await flush();
    if (!saved && dirtyRef.current.size > 0) {
      setPublishing(false);
      toast.error(p.toasts.saveFailed);
      return;
    }
    const result = await api<PostmortemPayload>(`${base}/publish`, { method: "POST" });
    setPublishing(false);
    if (result.ok) {
      toast.success(p.toasts.published);
      onPublished(result.data);
      return;
    }
    if (result.code === "missing_sections") {
      const keys = result.fieldErrors?.sections ?? [];
      setMissing(keys);
      const first = defs.find((d) => keys.includes(d.key));
      if (first) scrollToSection(first.key);
      return;
    }
    if (result.code === "postmortem_published") {
      toast.error(p.toasts.publishedElsewhere);
      void reloadPublished();
      return;
    }
    toast.error(p.toasts.publishFailed);
  }

  const secondsAgo = savedAt === null ? 0 : Math.max(0, Math.round((now - savedAt) / 1000));
  const saveLabel =
    saveState === "saving"
      ? p.save.saving
      : saveState === "error"
        ? p.save.failed
        : saveState === "dirty" || saveState === "conflict"
          ? p.save.unsaved
          : saveState === "saved"
            ? p.save.saved(secondsAgo)
            : "";

  const progressIcon = (key: string) => {
    const progress = sectionProgress(sections[key]);
    const Icon = progress === "complete" ? CircleCheck : progress === "started" ? CircleDot : Circle;
    return (
      <>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">{p.progress[progress]}</span>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/95 py-3 backdrop-blur print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <PostmortemBadge state="DRAFT" label={p.draft} />
          <span
            role="status"
            aria-live="polite"
            className={`text-sm ${saveState === "error" ? "text-danger" : "text-muted"}`}
          >
            {saveLabel}
          </span>
        </div>
        <button type="button" className={primaryButton} onClick={requestPublish} disabled={publishing}>
          {publishing ? p.publishing : p.publish}
        </button>
      </div>

      {above}

      {missing.length > 0 && (
        <p role="alert" className="rounded border border-danger p-3 text-sm text-danger">
          {p.missingSections(defs.filter((d) => missing.includes(d.key)).map((d) => titleOf(d.key)))}
        </p>
      )}

      <div className="md:flex md:flex-wrap md:gap-8 lg:flex-nowrap">
        <div className="md:w-60 md:shrink-0 print:hidden">
          <nav aria-label={p.sectionsNav} className="hidden md:sticky md:top-20 md:block">
            <ol className="space-y-1 text-sm">
              {defs.map((d) => (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(d.key)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface"
                  >
                    {progressIcon(d.key)}
                    <span className="min-w-0 flex-1">{titleOf(d.key)}</span>
                    {d.required && (
                      <span className="shrink-0 text-xs text-muted" title={p.required}>
                        {p.required}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="md:hidden">
            <label htmlFor="section-jump" className="sr-only">
              {p.jumpToSection}
            </label>
            <select
              id="section-jump"
              value=""
              onChange={(e) => e.target.value && scrollToSection(e.target.value)}
              className="w-full rounded border border-border bg-surface px-3 py-2"
            >
              <option value="">{p.jumpToSection}</option>
              {defs.map((d) => (
                <option key={d.key} value={d.key}>
                  {titleOf(d.key)}
                  {d.required ? ` (${p.required})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-w-0 max-w-3xl flex-1 space-y-8">
          {defs.map((d) => {
            const progress = sectionProgress(sections[d.key]);
            const showPrompt = promptOpen[d.key] ?? progress === "empty";
            const flagged = missing.includes(d.key);
            return (
              <section
                key={d.key}
                id={`section-${d.key}`}
                aria-labelledby={`heading-${d.key}`}
                className="scroll-mt-24 space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`heading-${d.key}`} className="text-lg font-semibold">
                    {titleOf(d.key)}
                    <span className="ml-2 text-xs font-normal text-muted">{d.required ? p.required : p.optional}</span>
                  </h2>
                  <div className="flex items-center gap-2 text-sm">
                    {d.key === "timeline" && (
                      <button type="button" className={secondaryButton} onClick={() => setConfirmRefresh(true)}>
                        {p.refreshTimeline}
                      </button>
                    )}
                    {progress !== "empty" && (
                      <button
                        type="button"
                        className="text-muted underline"
                        aria-expanded={showPrompt}
                        onClick={() => setPromptOpen((o) => ({ ...o, [d.key]: !showPrompt }))}
                      >
                        {showPrompt ? p.hidePrompt : p.showPrompt}
                      </button>
                    )}
                  </div>
                </div>
                {showPrompt && (
                  <p className="text-sm text-muted">{p.sections[d.key as PostmortemSectionKey]?.prompt}</p>
                )}
                {isRevenant && d.key === "went_wrong" && (
                  <p className="text-sm text-muted" data-testid="revenant-prompt">
                    {t.revenant.editor.wentWrongPrompt}
                  </p>
                )}
                <RichTextEditor
                  key={`${d.key}-${revisions[d.key] ?? 0}`}
                  doc={sections[d.key]}
                  label={p.editorLabel(titleOf(d.key))}
                  invalid={flagged}
                  onChange={(doc) => edit(d.key, doc)}
                  onBlur={() => void flush()}
                />
              </section>
            );
          })}
        </div>
        {aside && <aside className="w-full shrink-0 print:hidden lg:w-80">{aside}</aside>}
      </div>

      <ConfirmDialog
        open={askNoItems}
        title={t.ritual.editor.publishWarning}
        body={t.ritual.editor.none}
        confirmLabel={t.ritual.editor.publishAnyway}
        pending={publishing}
        onConfirm={() => {
          // the second soft warning, if earlier occurrences also left work undone
          if (earlierOpenItems > 0) {
            setAskNoItems(false);
            setAskEarlier(true);
          } else void publish();
        }}
        onCancel={() => setAskNoItems(false)}
      />
      <ConfirmDialog
        open={askEarlier}
        title={t.revenant.editor.publishWarning(earlierOpenItems)}
        body={t.revenant.accountability.openHeading}
        confirmLabel={t.revenant.editor.publishAnyway}
        pending={publishing}
        onConfirm={() => void publish()}
        onCancel={() => setAskEarlier(false)}
      />
      <ConfirmDialog
        open={confirmRefresh}
        title={p.refreshTimelineTitle}
        body={p.refreshTimelineBody}
        confirmLabel={p.refreshTimeline}
        pending={refreshing}
        onConfirm={() => void refreshTimeline()}
        onCancel={() => setConfirmRefresh(false)}
      />
      <ConflictDialog open={conflict !== null} onKeepMine={() => void keepMine()} onLoadTheirs={loadTheirs} />
    </div>
  );
}

/** Must be answered: Esc doesn't dismiss it, because dismissing would leave the editor in an unclear state. */
function ConflictDialog({
  open,
  onKeepMine,
  onLoadTheirs,
}: {
  open: boolean;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
}) {
  const p = useCopy().postmortem.conflict;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="conflict-title"
      aria-describedby="conflict-body"
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(92vw,28rem)] rounded-pop border shadow-pop border-border bg-surface p-5 text-fg backdrop:bg-ground/70"
    >
      <h2 id="conflict-title" className="text-lg font-semibold">
        {p.title}
      </h2>
      <p id="conflict-body" className="mt-2 text-sm text-muted">
        {p.body}
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <button type="button" className={primaryButton} onClick={onKeepMine}>
            {p.keepMine}
          </button>
          <p className="mt-1 text-xs text-muted">{p.keepMineHelp}</p>
        </div>
        <button type="button" className={secondaryButton} onClick={onLoadTheirs}>
          {p.loadTheirs}
        </button>
      </div>
    </dialog>
  );
}
