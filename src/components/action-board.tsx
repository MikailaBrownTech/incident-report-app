"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionCard } from "@/components/action-card";
import { canChange, ReasonDialog, useToday } from "@/components/action-item-bits";
import { ActionItemPanel, type PanelChanges } from "@/components/action-item-panel";
import { ActionQuickAdd, type QuickIncident } from "@/components/action-quick-add";
import { EmptyState } from "@/components/empty-state";
import { secondaryButton } from "@/components/form";
import { useToast } from "@/components/toast";
import { emptyMessage } from "@/copy";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import {
  STATUSES,
  type ActionItemView,
  type ActionStatus,
  type BoardPayload,
  type ItemsPayload,
} from "@/features/action-items/schema";
import { api } from "@/lib/api-client";

type Cols = Record<ActionStatus, ActionItemView[]>;
interface BoardState {
  cols: Cols;
  counts: Record<ActionStatus, number>;
  cursors: Record<ActionStatus, string | null>;
}

const colId = (s: ActionStatus) => `col:${s}`;
const isCol = (id: unknown): id is string => typeof id === "string" && id.startsWith("col:");
const statusOfCol = (id: string) => id.slice(4) as ActionStatus;

function fromPayload(p: BoardPayload): BoardState {
  const state: BoardState = {
    cols: { OPEN: [], IN_PROGRESS: [], DONE: [], WONT_DO: [] },
    counts: { OPEN: 0, IN_PROGRESS: 0, DONE: 0, WONT_DO: 0 },
    cursors: { OPEN: null, IN_PROGRESS: null, DONE: null, WONT_DO: null },
  };
  for (const c of p.columns) {
    state.cols[c.status] = c.items;
    state.counts[c.status] = c.count;
    state.cursors[c.status] = c.nextCursor;
  }
  return state;
}

const clone = (b: BoardState): BoardState => ({
  cols: {
    OPEN: [...b.cols.OPEN],
    IN_PROGRESS: [...b.cols.IN_PROGRESS],
    DONE: [...b.cols.DONE],
    WONT_DO: [...b.cols.WONT_DO],
  },
  counts: { ...b.counts },
  cursors: { ...b.cursors },
});

const containerOf = (b: BoardState, id: string): ActionStatus | null =>
  isCol(id) ? statusOfCol(id) : (STATUSES.find((s) => b.cols[s].some((i) => i.id === id)) ?? null);

/** `item` moved to `status`, placed after `afterId` (or at the end), with counts adjusted. */
function moved(
  b: BoardState,
  item: ActionItemView,
  status: ActionStatus,
  afterId: string | null,
  beforeId: string | null = null,
): BoardState {
  const next = clone(b);
  const from = containerOf(b, item.id);
  if (from) {
    next.cols[from] = next.cols[from].filter((i) => i.id !== item.id);
    if (from !== status) next.counts[from] = Math.max(0, next.counts[from] - 1);
  }
  const target = next.cols[status];
  const afterAt = afterId ? target.findIndex((i) => i.id === afterId) : -1;
  const beforeAt = beforeId ? target.findIndex((i) => i.id === beforeId) : -1;
  const at = afterAt >= 0 ? afterAt + 1 : beforeAt >= 0 ? beforeAt : target.length;
  target.splice(at, 0, { ...item, status });
  if (from !== status) next.counts[status] += 1;
  return next;
}

const neighbours = (list: ActionItemView[], id: string) => {
  const i = list.findIndex((x) => x.id === id);
  return { afterId: list[i - 1]?.id ?? null, beforeId: list[i + 1]?.id ?? null };
};

interface Props {
  slug: string;
  initial: BoardPayload;
  /** The current filters as a query string (no cursor), reused for refreshes and "load more". */
  queryString: string;
  hasFilters: boolean;
  members: PersonView[];
  incidents: QuickIncident[];
  currentUserId: string;
  isAdmin: boolean;
  refreshMs?: number;
}

export function ActionBoard({
  slug,
  initial,
  queryString,
  hasFilters,
  members,
  incidents,
  currentUserId,
  isAdmin,
  refreshMs = 15_000,
}: Props) {
  const t = useCopy();
  const r = t.ritual;
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = useToday(initial.today);

  const [board, setBoard] = useState<BoardState>(() => fromPayload(initial));
  const [people, setPeople] = useState(initial.people);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<ActionStatus>("OPEN");
  const [openId, setOpenId] = useState<string | null>(null);
  const [needReason, setNeedReason] = useState<{
    item: ActionItemView;
    afterId: string | null;
    beforeId: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState<ActionStatus | null>(null);

  // What the async code reads lives in refs, so a timer or a promise never sees stale state.
  const boardRef = useRef(board);
  const inFlight = useRef(0);
  const dragging = useRef(false);
  const snapshot = useRef<{ board: BoardState; from: ActionStatus; id: string } | null>(null);
  useEffect(() => {
    boardRef.current = board;
  });
  const set = (b: BoardState) => {
    boardRef.current = b;
    setBoard(b);
  };

  const mergePeople = useCallback((p: Record<string, PersonView>) => setPeople((cur) => ({ ...cur, ...p })), []);
  const find = (id: string) => STATUSES.flatMap((s) => boardRef.current.cols[s]).find((i) => i.id === id) ?? null;
  const editable = (item: ActionItemView) => canChange(item, currentUserId, isAdmin);

  // ---- refresh ----------------------------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (dragging.current || inFlight.current > 0) return;
    if (document.visibilityState === "hidden") return;
    const loaded = Math.max(25, ...STATUSES.map((s) => boardRef.current.cols[s].length));
    const qs = new URLSearchParams(queryString);
    qs.set("limit", String(Math.min(100, loaded)));
    const result = await api<BoardPayload>(`/api/w/${slug}/action-items/board?${qs.toString()}`);
    // a drag or a move may have started while the request was out; theirs wins
    if (!result.ok || dragging.current || inFlight.current > 0) return;
    set(fromPayload(result.data));
    mergePeople(result.data.people);
  }, [mergePeople, queryString, slug]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => void refresh(), refreshMs);
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshMs]);

  // ---- moving -----------------------------------------------------------------------------------------------
  /**
   * Send a move. `before` is what to restore if the server refuses; the board already shows the new arrangement.
   * The server works out the position from the neighbours, so nothing here ever sends a raw position.
   */
  async function send(
    item: ActionItemView,
    to: ActionStatus,
    afterId: string | null,
    beforeId: string | null,
    before: BoardState,
    reason?: string,
    undoable = true,
  ): Promise<void> {
    const from = item.status;
    const prevList = before.cols[from];
    const prev = neighbours(prevList, item.id);
    inFlight.current += 1;
    const result = await api<ItemsPayload>(`/api/w/${slug}/action-items/${item.id}`, {
      method: "PATCH",
      body: {
        ...(to !== from ? { status: to } : {}),
        afterId,
        beforeId,
        ...(reason ? { wontDoReason: reason } : {}),
      },
    });
    inFlight.current -= 1;
    if (!result.ok) {
      set(before);
      toast.error(result.code === "forbidden" ? r.readOnlyHint : r.toasts.moveFailed);
      return;
    }
    const saved = result.data.items[0];
    mergePeople(result.data.people);
    const b = clone(boardRef.current);
    for (const s of STATUSES) b.cols[s] = b.cols[s].map((i) => (i.id === saved.id ? saved : i));
    set(b);
    if (to === "DONE" && from !== "DONE" && undoable) {
      toast.success(r.toasts.completed(saved.title), {
        label: r.toasts.undo,
        onClick: () => {
          const current = find(saved.id);
          if (!current) return;
          const snap = clone(boardRef.current);
          set(moved(snap, current, from, prev.afterId, prev.beforeId));
          void send({ ...current, status: "DONE" }, from, prev.afterId, prev.beforeId, snap, undefined, false);
        },
      });
    }
  }

  /** A move from the menu (or an undo): no drag, so arrange it locally first. */
  function moveTo(item: ActionItemView, status: ActionStatus, reason?: string) {
    if (status === "WONT_DO" && !reason) {
      setNeedReason({ item, afterId: null, beforeId: null });
      return;
    }
    const before = clone(boardRef.current);
    const target = before.cols[status];
    set(moved(before, item, status, target.at(-1)?.id ?? null));
    void send(item, status, target.at(-1)?.id ?? null, null, before, reason);
  }

  // ---- drag and drop ----------------------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    const id = String(e.active.id);
    setActiveId(id);
    snapshot.current = { board: clone(boardRef.current), from: containerOf(boardRef.current, id)!, id };
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const b = boardRef.current;
    const from = containerOf(b, String(active.id));
    const to = containerOf(b, String(over.id));
    if (!from || !to || from === to) return;
    const item = find(String(active.id));
    if (!item) return;
    const overIndex = isCol(over.id) ? b.cols[to].length : b.cols[to].findIndex((i) => i.id === over.id);
    const next = clone(b);
    next.cols[from] = next.cols[from].filter((i) => i.id !== item.id);
    next.cols[to].splice(Math.max(0, overIndex), 0, { ...item, status: to });
    set(next);
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false;
    setActiveId(null);
    const snap = snapshot.current;
    snapshot.current = null;
    const { active, over } = e;
    if (!snap) return;
    if (!over) {
      set(snap.board);
      return;
    }
    const b = clone(boardRef.current);
    const to = containerOf(b, String(active.id));
    if (!to) return set(snap.board);
    const list = b.cols[to];
    const from = snap.from;
    // dropped on another card in the same column: put it at that card's place
    if (to === from && !isCol(over.id) && over.id !== active.id) {
      const oldIndex = list.findIndex((i) => i.id === active.id);
      const newIndex = list.findIndex((i) => i.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        const [item] = list.splice(oldIndex, 1);
        list.splice(newIndex, 0, item);
      }
    }
    const item = snap.board.cols[from].find((i) => i.id === active.id)!;
    const n = neighbours(list, item.id);
    const unchanged = to === from && neighbours(snap.board.cols[from], item.id).afterId === n.afterId;
    if (unchanged) return set(snap.board);
    if (to === "WONT_DO" && from !== "WONT_DO") {
      set(snap.board); // nothing is committed until a reason is given
      setNeedReason({ item, afterId: n.afterId, beforeId: n.beforeId });
      return;
    }
    set(b);
    void send(item, to, n.afterId, n.beforeId, snap.board);
  }

  function onDragCancel() {
    dragging.current = false;
    setActiveId(null);
    if (snapshot.current) set(snapshot.current.board);
    snapshot.current = null;
  }

  function confirmReason(reason: string) {
    const pending = needReason;
    setNeedReason(null);
    if (!pending) return;
    const before = clone(boardRef.current);
    const after = pending.afterId ?? before.cols.WONT_DO.at(-1)?.id ?? null;
    set(moved(before, pending.item, "WONT_DO", after));
    void send(pending.item, "WONT_DO", after, pending.afterId ? pending.beforeId : null, before, reason);
  }

  // ---- panel, load more, quick add --------------------------------------------------------------------------
  async function savePanel(item: ActionItemView, changes: PanelChanges) {
    inFlight.current += 1;
    const result = await api<ItemsPayload>(`/api/w/${slug}/action-items/${item.id}`, {
      method: "PATCH",
      body: changes,
    });
    inFlight.current -= 1;
    if (!result.ok) return false;
    const saved = result.data.items[0];
    mergePeople(result.data.people);
    let b = clone(boardRef.current);
    if (saved.status !== item.status) b = moved(b, item, saved.status, b.cols[saved.status].at(-1)?.id ?? null);
    for (const s of STATUSES) b.cols[s] = b.cols[s].map((i) => (i.id === saved.id ? saved : i));
    set(b);
    toast.success(r.toasts.saved);
    setOpenId(null);
    return true;
  }

  async function deleteItem(item: ActionItemView) {
    inFlight.current += 1;
    const result = await api(`/api/w/${slug}/action-items/${item.id}`, { method: "DELETE" });
    inFlight.current -= 1;
    if (!result.ok) return false;
    const b = clone(boardRef.current);
    b.cols[item.status] = b.cols[item.status].filter((i) => i.id !== item.id);
    b.counts[item.status] = Math.max(0, b.counts[item.status] - 1);
    set(b);
    toast.success(r.toasts.deleted);
    setOpenId(null);
    return true;
  }

  async function loadMore(status: ActionStatus) {
    const cursor = boardRef.current.cursors[status];
    if (!cursor) return;
    setLoadingMore(status);
    const qs = new URLSearchParams(queryString);
    qs.set("column", status);
    qs.set("cursor", cursor);
    const result = await api<BoardPayload>(`/api/w/${slug}/action-items/board?${qs.toString()}`);
    setLoadingMore(null);
    if (!result.ok) {
      toast.error(r.board.loadFailed);
      return;
    }
    const col = result.data.columns[0];
    mergePeople(result.data.people);
    const b = clone(boardRef.current);
    const have = new Set(b.cols[status].map((i) => i.id));
    b.cols[status] = [...b.cols[status], ...col.items.filter((i) => !have.has(i.id))];
    b.cursors[status] = col.nextCursor;
    b.counts[status] = col.count;
    set(b);
  }

  function created(item: ActionItemView, p: Record<string, PersonView>) {
    mergePeople(p);
    const b = clone(boardRef.current);
    b.cols.OPEN.push(item);
    b.counts.OPEN += 1;
    set(b);
    toast.success(r.toasts.created);
  }

  function toggleAll() {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get("all") === "1") next.delete("all");
    else next.set("all", "1");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const showingAll = searchParams.get("all") === "1";
  const total = STATUSES.reduce((n, s) => n + board.counts[s], 0);
  const everyItem = STATUSES.flatMap((s) => board.cols[s]);
  const openItem = openId ? (everyItem.find((i) => i.id === openId) ?? null) : null;
  const activeItem = activeId ? (everyItem.find((i) => i.id === activeId) ?? null) : null;

  const columnName = (id: unknown) => {
    const s = containerOf(board, String(id));
    return s ? r.statusLabel[s] : "";
  };
  const titleOf = (id: unknown) => everyItem.find((i) => i.id === String(id))?.title ?? "";

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ActionQuickAdd
          slug={slug}
          incidents={incidents}
          members={members}
          currentUserId={currentUserId}
          onCreated={created}
        />
      </div>

      {total === 0 ? (
        <div className="space-y-3 text-center">
          <EmptyState message={hasFilters ? r.board.noMatches : emptyMessage(t, "rituals")} />
          {hasFilters && (
            <button type="button" className={secondaryButton} onClick={() => router.push(pathname)}>
              {r.board.clearFilters}
            </button>
          )}
        </div>
      ) : (
        <>
          <div role="tablist" aria-label={r.board.tabsLabel} className="flex gap-1 overflow-x-auto md:hidden">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                id={`tab-${s}`}
                aria-selected={tab === s}
                aria-controls={`column-${s}`}
                onClick={() => setTab(s)}
                className={`shrink-0 rounded-tag border px-3 py-1 text-sm ${tab === s ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface"}`}
              >
                {`${r.statusLabel[s]} (${board.counts[s]})`}
              </button>
            ))}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            accessibility={{
              screenReaderInstructions: { draggable: r.board.dragInstructions },
              announcements: {
                onDragStart: ({ active }) => r.board.announce.start(titleOf(active.id)),
                onDragOver: ({ active, over }) =>
                  over ? r.board.announce.over(titleOf(active.id), columnName(over.id)) : undefined,
                onDragEnd: ({ active, over }) =>
                  over
                    ? r.board.announce.drop(titleOf(active.id), columnName(over.id))
                    : r.board.announce.cancel(titleOf(active.id)),
                onDragCancel: ({ active }) => r.board.announce.cancel(titleOf(active.id)),
              },
            }}
          >
            <div className="grid gap-4 md:grid-cols-4">
              {STATUSES.map((s) => (
                <Column
                  key={s}
                  status={s}
                  items={board.cols[s]}
                  count={board.counts[s]}
                  hasMore={Boolean(board.cursors[s])}
                  loading={loadingMore === s}
                  visibleOnPhone={tab === s}
                  recentOnly={(s === "DONE" || s === "WONT_DO") && !showingAll}
                  onToggleAll={toggleAll}
                  onLoadMore={() => void loadMore(s)}
                  renderCard={(item) => (
                    <ActionCard
                      key={item.id}
                      item={item}
                      slug={slug}
                      people={people}
                      today={today}
                      editable={editable(item)}
                      onOpen={(i) => setOpenId(i.id)}
                      onMoveTo={(i, status) => moveTo(i, status)}
                    />
                  )}
                />
              ))}
            </div>
            <DragOverlay>
              {activeItem ? (
                <ul>
                  <ActionCard
                    item={activeItem}
                    slug={slug}
                    people={people}
                    today={today}
                    editable={false}
                    overlay
                    onOpen={() => {}}
                    onMoveTo={() => {}}
                  />
                </ul>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <ReasonDialog open={needReason !== null} onConfirm={confirmReason} onCancel={() => setNeedReason(null)} />
      <ActionItemPanel
        slug={slug}
        item={openItem}
        people={people}
        members={members}
        canEdit={openItem ? editable(openItem) : false}
        canDelete={isAdmin}
        onClose={() => setOpenId(null)}
        onSave={savePanel}
        onDelete={deleteItem}
      />
    </div>
  );
}

function Column({
  status,
  items,
  count,
  hasMore,
  loading,
  visibleOnPhone,
  recentOnly,
  onToggleAll,
  onLoadMore,
  renderCard,
}: {
  status: ActionStatus;
  items: ActionItemView[];
  count: number;
  hasMore: boolean;
  loading: boolean;
  visibleOnPhone: boolean;
  recentOnly: boolean;
  onToggleAll: () => void;
  onLoadMore: () => void;
  renderCard: (item: ActionItemView) => React.ReactNode;
}) {
  const r = useCopy().ritual;
  const { setNodeRef, isOver } = useDroppable({ id: colId(status) });
  const showToggle = status === "DONE" || status === "WONT_DO";
  return (
    <section
      id={`column-${status}`}
      role="tabpanel"
      aria-labelledby={`heading-${status}`}
      className={`${visibleOnPhone ? "block" : "hidden"} min-w-0 space-y-3 md:block`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`heading-${status}`} className="font-semibold">
          {r.statusLabel[status]}
        </h2>
        <span className="text-sm text-muted" data-testid={`count-${status}`}>
          {r.board.columnCount(count)}
        </span>
        {showToggle && (
          <button type="button" className="text-xs text-muted underline" onClick={onToggleAll}>
            {recentOnly ? r.board.showAll : r.board.showRecent}
          </button>
        )}
      </header>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          aria-label={r.statusLabel[status]}
          className={`min-h-24 space-y-2 rounded border border-dashed p-2 ${isOver ? "border-accent bg-surface/50" : "border-border"}`}
        >
          {items.map(renderCard)}
          {items.length === 0 && <li className="p-2 text-center text-sm text-muted">{r.board.emptyColumn}</li>}
        </ul>
      </SortableContext>
      {hasMore && (
        <button type="button" className={`${secondaryButton} w-full`} onClick={onLoadMore} disabled={loading}>
          {r.board.loadMore}
        </button>
      )}
    </section>
  );
}
