// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionBoard } from "@/components/action-board";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import type { ActionItemView, ActionStatus, BoardPayload } from "@/features/action-items/schema";
import { addDays, localDay } from "@/features/action-items/state";
import { polyfillDialog } from "@/test/dialog-polyfill";

const apiMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => "/app/acme/action-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const R = getCopy("professional").ritual;
const TODAY = localDay();
const people = {
  me: { userId: "me", name: "Maya Member", email: "maya@x.test", image: null },
  other: { userId: "other", name: "Omar Other", email: "omar@x.test", image: null },
};

let n = 0;
function item(over: Partial<ActionItemView> = {}): ActionItemView {
  n += 1;
  return {
    id: `it${n}`,
    title: `Item ${n}`,
    description: "",
    status: "OPEN",
    wontDoReason: null,
    dueDate: null,
    completedAt: null,
    ownerId: "me",
    createdById: "me",
    position: `a${n}`,
    postmortemId: "pm1",
    incident: { id: "inc1", number: 12, title: "Checkout down", severity: 4 },
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    ...over,
  };
}
const payload = (
  by: Partial<Record<ActionStatus, ActionItemView[]>>,
  over: { cursors?: Partial<Record<ActionStatus, string>>; counts?: Partial<Record<ActionStatus, number>> } = {},
): BoardPayload => ({
  columns: (["OPEN", "IN_PROGRESS", "DONE", "WONT_DO"] as const).map((status) => ({
    status,
    items: by[status] ?? [],
    count: over.counts?.[status] ?? (by[status] ?? []).length,
    nextCursor: over.cursors?.[status] ?? null,
  })),
  people,
  today: TODAY,
});

beforeAll(polyfillDialog);
beforeEach(() => {
  n = 0;
  apiMock.mockReset();
  nav.push.mockReset();
  nav.search = "";
});
afterEach(cleanup);

function setup(
  p: BoardPayload,
  o: {
    me?: string;
    admin?: boolean;
    skin?: SkinKey;
    hasFilters?: boolean;
    refreshMs?: number;
    queryString?: string;
  } = {},
) {
  return render(
    <CopyProvider skin={o.skin ?? "professional"}>
      <ToastProvider>
        <ActionBoard
          slug="acme"
          initial={p}
          queryString={o.queryString ?? ""}
          hasFilters={o.hasFilters ?? false}
          members={Object.values(people)}
          incidents={[{ number: 12, title: "Checkout down", severity: 4 }]}
          currentUserId={o.me ?? "me"}
          isAdmin={o.admin ?? false}
          refreshMs={o.refreshMs ?? 0}
        />
      </ToastProvider>
    </CopyProvider>,
  );
}
const column = (status: ActionStatus) => screen.getByRole("list", { name: R.statusLabel[status] });
const titles = (status: ActionStatus) =>
  within(column(status))
    .queryAllByTestId(/^card-/)
    .map((c) => c.querySelector("button.flex-1")?.textContent);
const moveSelect = (title: string) => screen.getByLabelText(`${R.moveTo}: ${title}`) as HTMLSelectElement;
const ok = (item: ActionItemView) => ({ ok: true, data: { items: [item], people } });

describe("reading the board", () => {
  it("shows the four columns with counts and each card's details", () => {
    const overdue = item({
      title: "Item overdue",
      dueDate: addDays(TODAY, -3),
      description: "has details",
      ownerId: "other",
    });
    setup(payload({ OPEN: [overdue, item()], IN_PROGRESS: [item()], DONE: [item({ status: "DONE" })] }));
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Open",
      "In progress",
      "Done",
      "Won't do",
    ]);
    expect(screen.getByTestId("count-OPEN")).toHaveTextContent(R.board.columnCount(2));
    expect(screen.getByTestId("count-WONT_DO")).toHaveTextContent(R.board.columnCount(0));
    const card = screen.getByTestId(`card-${overdue.id}`);
    expect(card).toHaveAttribute("data-state", "OVERDUE");
    expect(within(card).getByText(R.daysLate(3))).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "INC-12" })).toHaveAttribute("href", "/app/acme/incidents/12");
    expect(within(card).getByText("Omar Other")).toBeInTheDocument();
    expect(within(card).getByText(R.hasDescription)).toBeInTheDocument();
    expect(within(screen.getByTestId(`card-${overdue.id}`)).queryByText(R.noDate)).toBeNull();
  });

  it("styles due-soon cards and shows no-date ones plainly", () => {
    const soon = item({ title: "Item soon", dueDate: addDays(TODAY, 2) });
    const none = item({ title: "Item none" });
    setup(payload({ OPEN: [soon, none] }));
    expect(screen.getByTestId(`card-${soon.id}`)).toHaveAttribute("data-state", "DUE_SOON");
    expect(within(screen.getByTestId(`card-${none.id}`)).getByText(R.noDate)).toBeInTheDocument();
  });

  it("says so per column and for the whole board", () => {
    setup(payload({ OPEN: [item()] }));
    expect(within(column("DONE")).getByText(R.board.emptyColumn)).toBeInTheDocument();
    cleanup();
    setup(payload({}));
    expect(screen.queryByRole("list", { name: R.statusLabel.OPEN })).toBeNull();
    cleanup();
    setup(payload({}), { hasFilters: true });
    expect(screen.getByText(R.board.noMatches)).toBeInTheDocument();
  });

  it("offers status tabs for phones", () => {
    setup(payload({ OPEN: [item()], DONE: [item({ status: "DONE" })] }));
    const tabs = screen.getByRole("tablist", { name: R.board.tabsLabel });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(4);
    expect(within(tabs).getByRole("tab", { name: "Open (1)" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(tabs).getByRole("tab", { name: "Done (1)" }));
    expect(within(tabs).getByRole("tab", { name: "Done (1)" })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("column-DONE")).toHaveClass("block");
    expect(document.getElementById("column-OPEN")).toHaveClass("hidden");
  });

  it("speaks the haunted skin's words", () => {
    setup(payload({ OPEN: [item()] }), { skin: "haunted" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "To perform",
      "Underway",
      "Complete",
      "Abandoned",
    ]);
  });
});

describe("who can move what", () => {
  it("disables the drag handle and the menu on someone else's card, with the reason in a tooltip", () => {
    const mine = item({ title: "Item mine" });
    const theirs = item({ title: "Item theirs", ownerId: "other" });
    setup(payload({ OPEN: [mine, theirs] }));
    expect(moveSelect("Item mine")).toBeEnabled();
    expect(moveSelect("Item theirs")).toBeDisabled();
    expect(moveSelect("Item theirs")).toHaveAttribute("title", R.readOnlyHint);
    const grip = (id: string) =>
      within(screen.getByTestId(`card-${id}`)).getByRole("button", { name: new RegExp(`^${R.board.dragCard}`) });
    expect(grip(mine.id)).toBeEnabled();
    expect(grip(theirs.id)).toBeDisabled();
  });

  it("lets an admin move anyone's card", () => {
    setup(payload({ OPEN: [item({ title: "Item theirs", ownerId: "other" })] }), { admin: true });
    expect(moveSelect("Item theirs")).toBeEnabled();
  });

  it("opens the panel read-only for a card you can't change", () => {
    const theirs = item({ title: "Item theirs", ownerId: "other" });
    setup(payload({ OPEN: [theirs] }));
    fireEvent.click(within(screen.getByTestId(`card-${theirs.id}`)).getByRole("button", { name: "Item theirs" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("note")).toHaveTextContent(R.readOnlyHint);
    expect(within(dialog).getByLabelText(R.fields.title)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: R.delete })).toBeDisabled();
  });
});

describe("moving with the menu", () => {
  it("moves the card at once, sends the status, and keeps the server's version", async () => {
    const a = item({ title: "Item a" });
    const b = item({ title: "Item b" });
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (finish = r)));
    setup(payload({ OPEN: [a, b] }));
    fireEvent.change(moveSelect("Item a"), { target: { value: "IN_PROGRESS" } });
    expect(titles("OPEN")).toEqual(["Item b"]); // optimistic
    expect(titles("IN_PROGRESS")).toEqual(["Item a"]);
    expect(screen.getByTestId("count-IN_PROGRESS")).toHaveTextContent(R.board.columnCount(1));
    expect(apiMock).toHaveBeenCalledWith(`/api/w/acme/action-items/${a.id}`, {
      method: "PATCH",
      body: { status: "IN_PROGRESS", afterId: null, beforeId: null },
    });
    await act(async () => finish(ok({ ...a, status: "IN_PROGRESS", position: "z9" })));
    expect(titles("IN_PROGRESS")).toEqual(["Item a"]);
  });

  it("puts it back and says so when the server refuses", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup(payload({ OPEN: [a] }));
    await act(async () => fireEvent.change(moveSelect("Item a"), { target: { value: "IN_PROGRESS" } }));
    expect(titles("OPEN")).toEqual(["Item a"]);
    expect(titles("IN_PROGRESS")).toEqual([]);
    expect(screen.getByTestId("count-OPEN")).toHaveTextContent(R.board.columnCount(1));
    expect(screen.getByRole("alert")).toHaveTextContent(R.toasts.moveFailed);
  });

  it("says the item is read-only when the server says forbidden", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 403, code: "forbidden", message: "x" });
    setup(payload({ OPEN: [item({ title: "Item a" })] }));
    await act(async () => fireEvent.change(moveSelect("Item a"), { target: { value: "DONE" } }));
    expect(screen.getByRole("alert")).toHaveTextContent(R.readOnlyHint);
  });

  it("confirms completion with a toast, and undo puts the card back where it was", async () => {
    const a = item({ title: "Item a", status: "IN_PROGRESS" });
    const b = item({ title: "Item b", status: "IN_PROGRESS" });
    apiMock.mockImplementation(async (_url: string, init: { body: { status?: string } }) =>
      ok({
        ...a,
        status: (init.body.status as ActionStatus) ?? "OPEN",
        completedAt: init.body.status === "DONE" ? "2026-06-20T10:00:00.000Z" : null,
      }),
    );
    setup(payload({ IN_PROGRESS: [a, b] }));
    await act(async () => fireEvent.change(moveSelect("Item a"), { target: { value: "DONE" } }));
    expect(titles("DONE")).toEqual(["Item a"]);
    const toast = screen.getByText(R.toasts.completed("Item a"));
    expect(toast).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: R.toasts.undo })));
    expect(titles("DONE")).toEqual([]);
    expect(titles("IN_PROGRESS")).toEqual(["Item a", "Item b"]); // back in its old place
    const undo = apiMock.mock.calls.at(-1)!;
    expect(undo[1].body).toEqual({ status: "IN_PROGRESS", afterId: null, beforeId: b.id });
  });

  it("asks for a reason before moving to won't do, and sends nothing until it has one", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockImplementation(async (_u: string, init: { body: { wontDoReason: string } }) =>
      ok({ ...a, status: "WONT_DO", wontDoReason: init.body.wontDoReason }),
    );
    setup(payload({ OPEN: [a] }));
    fireEvent.change(moveSelect("Item a"), { target: { value: "WONT_DO" } });
    const dialog = screen.getByRole("dialog", { name: R.reasonTitle });
    expect(apiMock).not.toHaveBeenCalled();
    expect(titles("OPEN")).toEqual(["Item a"]); // not moved yet
    fireEvent.click(within(dialog).getByRole("button", { name: R.reasonConfirm })); // empty
    expect(within(dialog).getByRole("alert")).toHaveTextContent(R.reasonRequired);
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(R.fields.reason), { target: { value: "Superseded" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: R.reasonConfirm })));
    expect(apiMock.mock.calls[0][1].body).toMatchObject({ status: "WONT_DO", wontDoReason: "Superseded" });
    expect(titles("WONT_DO")).toEqual(["Item a"]);
  });

  it("leaves the card where it was when the reason is cancelled", () => {
    setup(payload({ OPEN: [item({ title: "Item a" })] }));
    fireEvent.change(moveSelect("Item a"), { target: { value: "WONT_DO" } });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: getCopy("professional").actions.cancel }),
    );
    expect(apiMock).not.toHaveBeenCalled();
    expect(titles("OPEN")).toEqual(["Item a"]);
  });
});

describe("the side panel", () => {
  it("edits fields and saves only what changed, moving the card if the status changed", async () => {
    const a = item({ title: "Item a", dueDate: addDays(TODAY, 10) });
    apiMock.mockImplementation(async (_u: string, init: { body: Record<string, unknown> }) =>
      ok({ ...a, ...init.body } as ActionItemView),
    );
    setup(payload({ OPEN: [a] }), { admin: true });
    fireEvent.click(within(screen.getByTestId(`card-${a.id}`)).getByRole("button", { name: "Item a" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(R.fields.title), { target: { value: "Item a renamed" } });
    fireEvent.change(within(dialog).getByLabelText(R.fields.owner), { target: { value: "other" } });
    fireEvent.change(within(dialog).getByLabelText(R.fields.status), { target: { value: "IN_PROGRESS" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: R.save })));
    expect(apiMock.mock.calls[0][1].body).toEqual({ title: "Item a renamed", ownerId: "other", status: "IN_PROGRESS" });
    expect(titles("IN_PROGRESS")).toEqual(["Item a renamed"]);
    expect(titles("OPEN")).toEqual([]);
  });

  it("needs a reason for won't do, and links to the incident and the postmortem", async () => {
    const a = item({ title: "Item a" });
    setup(payload({ OPEN: [a] }));
    fireEvent.click(within(screen.getByTestId(`card-${a.id}`)).getByRole("button", { name: "Item a" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: R.card.viewPostmortem })).toHaveAttribute(
      "href",
      "/app/acme/incidents/12/postmortem",
    );
    fireEvent.change(within(dialog).getByLabelText(R.fields.status), { target: { value: "WONT_DO" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: R.save })));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(R.reasonRequired);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("deletes after confirming, for admins only", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockResolvedValue({ ok: true, data: { deleted: true } });
    setup(payload({ OPEN: [a] }), { admin: true });
    fireEvent.click(within(screen.getByTestId(`card-${a.id}`)).getByRole("button", { name: "Item a" }));
    const dialog = screen.getByRole("dialog", { name: R.panel.title });
    fireEvent.click(within(dialog).getByRole("button", { name: R.delete }));
    expect(apiMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: R.deleteConfirmTitle });
    await act(async () => fireEvent.click(within(confirm).getByRole("button", { name: R.delete })));
    expect(apiMock).toHaveBeenCalledWith(`/api/w/acme/action-items/${a.id}`, { method: "DELETE" });
    expect(screen.queryByTestId(`card-${a.id}`)).toBeNull();
  });

  it("explains why delete is disabled for non-admins", () => {
    const a = item({ title: "Item a" });
    setup(payload({ OPEN: [a] }));
    fireEvent.click(within(screen.getByTestId(`card-${a.id}`)).getByRole("button", { name: "Item a" }));
    const del = within(screen.getByRole("dialog")).getByRole("button", { name: R.delete });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute("title", R.deleteOnlyAdmins);
  });
});

describe("loading more and the recent-only toggle", () => {
  it("loads the next page of one column with the filters and cursor, and appends without repeats", async () => {
    const first = item({ title: "Item first" });
    const next = item({ title: "Item next" });
    apiMock.mockResolvedValue({
      ok: true,
      data: { columns: [{ status: "OPEN", items: [first, next], count: 2, nextCursor: null }], people, today: TODAY },
    });
    setup(payload({ OPEN: [first] }, { cursors: { OPEN: "c1" }, counts: { OPEN: 2 } }), { queryString: "owner=me" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: R.board.loadMore })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/action-items/board?owner=me&column=OPEN&cursor=c1");
    expect(titles("OPEN")).toEqual(["Item first", "Item next"]);
    expect(screen.queryByRole("button", { name: R.board.loadMore })).toBeNull();
  });

  it("toggles between the last 14 days and everything for Done and Won't do", () => {
    setup(payload({ DONE: [item({ status: "DONE" })] }));
    const buttons = screen.getAllByRole("button", { name: R.board.showAll });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(nav.push).toHaveBeenCalledWith("/app/acme/action-items?all=1", { scroll: false });
    cleanup();
    nav.search = "all=1";
    setup(payload({ DONE: [item({ status: "DONE" })] }));
    expect(screen.getAllByRole("button", { name: R.board.showRecent })).toHaveLength(2);
  });
});

describe("staying fresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tick = (ms = 15_000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("refetches every 15 seconds with the same filters and shows other people's changes", async () => {
    const a = item({ title: "Item a" });
    const moved = { ...a, status: "IN_PROGRESS" as const };
    apiMock.mockResolvedValue({
      ok: true,
      data: payload({ IN_PROGRESS: [moved], OPEN: [item({ title: "Item new" })] }),
    });
    setup(payload({ OPEN: [a] }), { refreshMs: 15_000, queryString: "owner=me" });
    await tick(14_999);
    expect(apiMock).not.toHaveBeenCalled();
    await tick(1);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toBe("/api/w/acme/action-items/board?owner=me&limit=25");
    expect(titles("IN_PROGRESS")).toEqual(["Item a"]);
    expect(titles("OPEN")).toEqual(["Item new"]);
  });

  it("doesn't refresh while a move is in flight, and its result isn't overwritten", async () => {
    const a = item({ title: "Item a" });
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValueOnce(new Promise((r) => (finish = r)));
    setup(payload({ OPEN: [a] }), { refreshMs: 15_000 });
    fireEvent.change(moveSelect("Item a"), { target: { value: "DONE" } });
    await tick(30_000);
    expect(apiMock).toHaveBeenCalledTimes(1); // only the move; the refreshes waited
    await act(async () => finish(ok({ ...a, status: "DONE" })));
    expect(titles("DONE")).toEqual(["Item a"]);
  });

  it("keeps quiet when a refresh fails", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup(payload({ OPEN: [item({ title: "Item a" })] }), { refreshMs: 15_000 });
    await tick();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(titles("OPEN")).toEqual(["Item a"]);
  });
});

describe("quick add", () => {
  it("searches incidents that have a postmortem, then uses the create form and adds the card", async () => {
    const created = item({ title: "Brand new", ownerId: "me" });
    apiMock.mockResolvedValue({ ok: true, data: { items: [created], people } });
    setup(payload({ OPEN: [item({ title: "Item a" })] }));
    fireEvent.click(screen.getByRole("button", { name: R.board.quickAdd }));
    const dialog = screen.getByRole("dialog", { name: R.board.quickAddTitle });
    fireEvent.change(within(dialog).getByLabelText(R.board.chooseIncident), { target: { value: "zzz" } });
    expect(within(dialog).getByText(R.board.noIncidentMatch)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(R.board.chooseIncident), { target: { value: "check" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Checkout down/ }));
    fireEvent.change(within(dialog).getByLabelText(R.fields.title), { target: { value: "Brand new" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: R.add })));
    expect(apiMock.mock.calls[0][0]).toBe("/api/w/acme/incidents/12/action-items");
    expect(apiMock.mock.calls[0][1].body).toMatchObject({ title: "Brand new", ownerId: "me", dueDate: null });
    expect(titles("OPEN")).toEqual(["Item a", "Brand new"]);
    expect(screen.getByTestId("count-OPEN")).toHaveTextContent(R.board.columnCount(2));
  });
});
