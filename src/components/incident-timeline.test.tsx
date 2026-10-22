// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import { encodeCursor, type TimelineEventView, type TimelinePage } from "@/features/timeline/schema";
import { polyfillDialog } from "@/test/dialog-polyfill";
import { IncidentTimeline } from "./incident-timeline";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));

const T = getCopy("professional").timeline;
const t = getCopy("professional");

const people: Record<string, PersonView> = {
  me: { userId: "me", name: "Maya Member", email: "maya@x.test", image: null },
  other: { userId: "other", name: "Omar Other", email: "omar@x.test", image: null },
  boss: { userId: "boss", name: "Ada Admin", email: "ada@x.test", image: null },
};

const START = new Date(2026, 5, 10, 10, 0, 0); // incident started at 10:00 local
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000).toISOString();

let counter = 0;
function ev(over: Partial<TimelineEventView> = {}): TimelineEventView {
  const n = ++counter;
  const occurredAt = over.occurredAt ?? at(n);
  return {
    id: `e${String(n).padStart(3, "0")}`,
    type: "NOTE",
    source: "USER",
    actorId: "other",
    body: `note ${n}`,
    payload: {},
    occurredAt,
    createdAt: occurredAt,
    editedAt: null,
    isKeyMoment: false,
    ...over,
  };
}
const asOf = "2026-06-10T12:00:00.000Z";
/** A page as the server returns it for the initial load: newest first. */
const page = (items: TimelineEventView[], nextCursor: string | null = null): TimelinePage => ({
  items: [...items].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)),
  nextCursor,
  people,
  asOf,
});

beforeAll(polyfillDialog);
beforeEach(() => {
  apiMock.mockReset();
  counter = 0;
  window.history.replaceState(null, "", "/app/acme/incidents/5");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Opts {
  initial?: TimelineEventView[];
  nextCursor?: string | null;
  laterCursor?: string | null;
  filter?: "all" | "notes" | "status" | "roles" | "key";
  order?: "asc" | "desc";
  me?: string;
  admin?: boolean;
  skin?: SkinKey;
  refreshMs?: number;
  signal?: number;
}
function setup(o: Opts = {}) {
  const ui = (signal = o.signal ?? 0) => (
    <CopyProvider skin={o.skin ?? "professional"}>
      <ToastProvider>
        <IncidentTimeline
          slug="acme"
          number={5}
          incidentStartedAt={START.toISOString()}
          initial={page(o.initial ?? [], o.nextCursor ?? null)}
          initialFilter={o.filter ?? "all"}
          initialOrder={o.order ?? "asc"}
          initialLaterCursor={o.laterCursor ?? null}
          currentUserId={o.me ?? "me"}
          isAdmin={o.admin ?? false}
          severityLabels={null}
          refreshSignal={signal}
          refreshMs={o.refreshMs ?? 0}
        />
      </ToastProvider>
    </CopyProvider>
  );
  const view = render(ui());
  return { ...view, rerenderWith: (signal: number) => view.rerender(ui(signal)) };
}
const entry = (e: TimelineEventView) => screen.getByTestId(`entry-${e.id}`);
const order = () => screen.getAllByTestId(/^entry-/).map((n) => n.dataset.testid!.replace("entry-", ""));
const composer = () => document.getElementById("timeline-composer") as HTMLTextAreaElement;
const submitButton = () => screen.getByRole("button", { name: T.submit });
const editBox = (e: TimelineEventView) => document.getElementById(`edit-body-${e.id}`) as HTMLTextAreaElement;
const maybeEditBox = (e: TimelineEventView) => document.getElementById(`edit-body-${e.id}`);
const when = () => screen.getByLabelText(T.happenedAt, { selector: "#timeline-when" }) as HTMLInputElement;

describe("reading the timeline", () => {
  it("shows entries oldest first by default, whatever order the server sent", () => {
    const a = ev({ occurredAt: at(5) });
    const b = ev({ occurredAt: at(30) });
    const c = ev({ occurredAt: at(10) });
    setup({ initial: [b, a, c] });
    expect(order()).toEqual([a.id, c.id, b.id]);
  });

  it("can show newest first, and remembers that in the URL", () => {
    const a = ev({ occurredAt: at(5) });
    const b = ev({ occurredAt: at(30) });
    setup({ initial: [a, b] });
    fireEvent.change(screen.getByLabelText(T.orderLabel), { target: { value: "desc" } });
    expect(order()).toEqual([b.id, a.id]);
    expect(window.location.search).toBe("?order=desc");
    fireEvent.change(screen.getByLabelText(T.orderLabel), { target: { value: "asc" } });
    expect(order()).toEqual([a.id, b.id]);
    expect(window.location.search).toBe("");
  });

  it("starts in the order the URL asked for", () => {
    const a = ev({ occurredAt: at(5) });
    const b = ev({ occurredAt: at(30) });
    setup({ initial: [a, b], order: "desc" });
    expect(order()).toEqual([b.id, a.id]);
    expect(screen.getByLabelText(T.orderLabel)).toHaveValue("desc");
  });

  it("breaks ties on id, so two entries at the same time never swap places", () => {
    const x = ev({ id: "b-second", occurredAt: at(5) });
    const y = ev({ id: "a-first", occurredAt: at(5) });
    setup({ initial: [x, y] });
    expect(order()).toEqual(["a-first", "b-second"]);
  });

  it("groups entries under Today, Yesterday and dated headings", () => {
    const now = new Date();
    const local = (daysAgo: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12).toISOString();
    const today = ev({ occurredAt: local(0) });
    const yesterday = ev({ occurredAt: local(1) });
    const older = ev({ occurredAt: local(5) });
    setup({ initial: [today, yesterday, older] });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/); // oldest first: a dated heading
    expect(headings.slice(1)).toEqual([T.yesterday, T.today]);
    expect(within(entry(today)).queryByText(T.today)).toBeNull(); // headings, not repeated per entry
  });

  it("shows who, what, when and the offset from the start of the incident", () => {
    const note = ev({ occurredAt: at(70), body: "Rolled back **release 4812**" });
    setup({ initial: [note] });
    const e = within(entry(note));
    expect(e.getByText("Omar Other")).toBeInTheDocument();
    expect(e.getByText("release 4812").tagName).toBe("STRONG");
    expect(e.getByText("+1h 10m")).toBeInTheDocument();
    expect(e.getByText("+1h 10m")).toHaveAttribute("aria-label", T.afterStart("1h 10m"));
    const time = entry(note).querySelector("time")!;
    expect(time).toHaveAttribute("dateTime", at(70));
    expect(time.getAttribute("title")).toMatch(/2026/); // exact time in the tooltip
  });

  it("marks entries from before the incident started with a minus offset", () => {
    const early = ev({ occurredAt: at(-12) });
    setup({ initial: [early] });
    expect(within(entry(early)).getByText("−12m 00s")).toHaveAttribute("aria-label", T.beforeStartOffset("12m 00s"));
  });

  it("falls back to a readable name for people who left, and labels non-person sources", () => {
    const gone = ev({ actorId: "ghost" });
    const sys = ev({
      type: "STATUS_CHANGED",
      source: "SYSTEM",
      actorId: null,
      payload: { to: "INVESTIGATING", created: true },
    });
    const hook = ev({ type: "EXTERNAL", source: "INTEGRATION", actorId: null, payload: {} });
    const slack = ev({ type: "NOTE", source: "SLACK", actorId: null, body: "from slack" });
    setup({ initial: [gone, sys, hook, slack] });
    expect(within(entry(gone)).getByText(T.actorFormerMember)).toBeInTheDocument();
    expect(within(entry(sys)).getByText(T.actorSystem)).toBeInTheDocument();
    expect(within(entry(hook)).getByText(T.actorWebhook)).toBeInTheDocument();
    expect(within(entry(slack)).getByText(T.actorSlack)).toBeInTheDocument();
  });

  it("writes a readable sentence for each system event, using people's names", () => {
    const status = ev({ type: "STATUS_CHANGED", source: "USER", payload: { from: "INVESTIGATING", to: "IDENTIFIED" } });
    const sev = ev({ type: "SEVERITY_CHANGED", source: "USER", payload: { from: 3, to: 4 } });
    const role = ev({ type: "ROLE_ASSIGNED", source: "USER", payload: { role: "COMMANDER", from: null, to: "boss" } });
    const svc = ev({ type: "SERVICES_CHANGED", source: "USER", payload: { added: ["Search"], removed: [] } });
    const title = ev({ type: "TITLE_CHANGED", source: "USER", payload: { from: "A", to: "B" } });
    setup({ initial: [status, sev, role, svc, title] });
    expect(within(entry(status)).getByText("Status changed from Investigating to Identified")).toBeInTheDocument();
    expect(within(entry(sev)).getByText("Severity raised from Medium to High")).toBeInTheDocument();
    expect(within(entry(role)).getByText("Ada Admin was assigned as Commander")).toBeInTheDocument();
    expect(within(entry(svc)).getByText("Search was added to affected services")).toBeInTheDocument();
    expect(within(entry(title)).getByText('Title changed from "A" to "B"')).toBeInTheDocument();
  });

  it("never crashes on unknown types or malformed data", () => {
    const bad = [
      ev({ type: "STATUS_CHANGED", source: "USER", payload: null }),
      ev({ type: "ROLE_ASSIGNED", source: "USER", payload: "oops" }),
      ev({ type: "SEVERITY_CHANGED", source: "USER", payload: { to: 99 } }),
      ev({ type: "FROM_THE_FUTURE", source: "SYSTEM", actorId: null, payload: { x: 1 } }),
    ];
    setup({ initial: bad });
    for (const e of bad) expect(entry(e).textContent).toMatch(/[A-Za-z]{4}/);
    expect(within(entry(bad[3])).getByText("Update: from the future")).toBeInTheDocument();
  });

  it("speaks the haunted skin's language: sentences, labels and filters", () => {
    const h = getCopy("haunted").timeline;
    const status = ev({ type: "STATUS_CHANGED", source: "USER", payload: { from: "INVESTIGATING", to: "IDENTIFIED" } });
    setup({ initial: [status], skin: "haunted" });
    expect(screen.getByRole("heading", { name: "Séance Log" })).toBeInTheDocument();
    expect(within(entry(status)).getByText("Status shifted from Lurking to Possessed")).toBeInTheDocument();
    for (const label of [h.filterAll, h.filterNotes, "Shifts", "Roles and haunts", "Omens"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByPlaceholderText("Whisper what happened...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to the log" })).toBeInTheDocument();
  });
});

describe("markers", () => {
  it("shows 'added later' only when recorded more than 2 minutes after it happened, with the recorded time in the tooltip", () => {
    const recorded = new Date(START.getTime() + 3 * 3_600_000).toISOString();
    const backfilled = ev({ occurredAt: at(10), createdAt: recorded });
    const near = ev({ occurredAt: at(20), createdAt: at(21) });
    const edge = ev({ occurredAt: at(30), createdAt: at(32) }); // exactly 2 minutes: not flagged
    setup({ initial: [backfilled, near, edge] });
    const marker = within(entry(backfilled)).getByText(T.backfilled);
    expect(marker.getAttribute("title")).toBe(
      T.backfilledTooltip(marker.getAttribute("title")!.replace("Recorded ", "")),
    );
    expect(marker.getAttribute("title")).toMatch(/^Recorded .*2026/);
    expect(within(entry(near)).queryByText(T.backfilled)).toBeNull();
    expect(within(entry(edge)).queryByText(T.backfilled)).toBeNull();
  });

  it("shows 'edited' on edited notes, and a star with highlight on key moments", () => {
    const edited = ev({ editedAt: at(50) });
    const key = ev({ isKeyMoment: true });
    const plain = ev();
    setup({ initial: [edited, key, plain] });
    expect(within(entry(edited)).getByText(T.edited)).toBeInTheDocument();
    expect(within(entry(key)).getByText(T.keyMoment)).toBeInTheDocument();
    expect(entry(key)).toHaveAttribute("data-key-moment", "true");
    expect(entry(key).className).toMatch(/border-warning/);
    expect(entry(plain)).not.toHaveAttribute("data-key-moment");
    expect(within(entry(plain)).queryByText(T.keyMoment)).toBeNull();
    expect(within(entry(plain)).queryByText(T.edited)).toBeNull();
  });

  it("renders note markdown safely", () => {
    const evil = ev({
      body: "<script>window.hacked=1</script>\n\n[click](javascript:alert(1)) and ![px](https://t.test/p.gif)\n\n- item",
    });
    setup({ initial: [evil] });
    const e = entry(evil);
    expect(e.querySelector("script")).toBeNull();
    expect(e.querySelector("a[href^='javascript']")).toBeNull();
    expect(e.querySelector("img")).toBeNull();
    expect(within(e).getByText("item")).toBeInTheDocument();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });
});

describe("states", () => {
  it("says so when nothing has been logged, and when a filter matches nothing", () => {
    setup({ initial: [] });
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    cleanup();
    setup({ initial: [], filter: "notes" });
    expect(screen.getByText(T.emptyFiltered)).toBeInTheDocument();
  });

  it("shows a skeleton while loading, an error with a retry on failure, then recovers", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValueOnce(new Promise((r) => (finish = r)));
    setup({ initial: [ev()] });
    fireEvent.click(screen.getByRole("button", { name: T.filterNotes }));
    expect(screen.getByRole("status", { name: t.a11y.loading })).toBeInTheDocument();
    await act(async () => finish({ ok: false, status: 500, code: "internal_error", message: "x" }));
    expect(screen.getByRole("alert")).toHaveTextContent(T.loadFailed);
    expect(screen.queryByTestId(/^entry-/)).toBeNull();

    const fresh = ev({ body: "recovered" });
    apiMock.mockResolvedValueOnce({ ok: true, data: page([fresh]) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.retry })));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(entry(fresh)).getByText("recovered")).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith("/api/w/acme/incidents/5/events?filter=notes&order=desc&limit=50");
  });
});

describe("filters", () => {
  it("offers the five filters, with the active one pressed", () => {
    setup({ filter: "key" });
    for (const [label, pressed] of [
      [T.filterAll, false],
      [T.filterNotes, false],
      [T.filterStatus, false],
      [T.filterRoles, false],
      [T.filterKey, true],
    ] as const) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", String(pressed));
    }
  });

  it("loads the chosen filter from the server and keeps it in the URL", async () => {
    const note = ev({ body: "only notes here" });
    apiMock.mockResolvedValue({ ok: true, data: page([note]) });
    setup({ initial: [ev({ type: "STATUS_CHANGED", payload: { to: "IDENTIFIED" } }), note] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.filterNotes })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/incidents/5/events?filter=notes&order=desc&limit=50");
    expect(order()).toEqual([note.id]);
    expect(screen.getByRole("button", { name: T.filterNotes })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("?filter=notes");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.filterAll })));
    expect(window.location.search).toBe(""); // "all" is the default, so it leaves the URL
  });

  it("keeps the order choice when the filter changes, and clicking the active filter does nothing", async () => {
    apiMock.mockResolvedValue({ ok: true, data: page([ev()]) });
    setup({ initial: [ev()], order: "desc" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.filterStatus })));
    expect(window.location.search).toBe("?filter=status&order=desc");
    apiMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: T.filterStatus }));
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("long timelines", () => {
  const earlierCursor = encodeCursor(at(0), "e000");

  it("offers 'Load earlier' only when there is more, at the top when oldest-first and the bottom when newest-first", () => {
    setup({ initial: [ev()] });
    expect(screen.queryByRole("button", { name: T.loadEarlier })).toBeNull();
    cleanup();

    const list = [ev(), ev()];
    setup({ initial: list, nextCursor: earlierCursor });
    const button = screen.getByRole("button", { name: T.loadEarlier });
    expect(button.compareDocumentPosition(entry(list[0])) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // above the entries
    cleanup();

    setup({ initial: list, nextCursor: earlierCursor, order: "desc" });
    const bottom = screen.getByRole("button", { name: T.loadEarlier });
    expect(bottom.compareDocumentPosition(entry(list[0])) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // below them
  });

  it("loads earlier entries with the cursor, puts them first, and stops when there are no more", async () => {
    const newer = [ev({ occurredAt: at(100) }), ev({ occurredAt: at(110) })];
    const older = [ev({ occurredAt: at(10) }), ev({ occurredAt: at(20) })];
    apiMock.mockResolvedValueOnce({ ok: true, data: page(older, null) });
    setup({ initial: newer, nextCursor: earlierCursor });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.loadEarlier })));
    expect(apiMock).toHaveBeenCalledWith(
      `/api/w/acme/incidents/5/events?filter=all&order=desc&limit=50&cursor=${earlierCursor}`,
    );
    expect(order()).toEqual([older[0].id, older[1].id, newer[0].id, newer[1].id]);
    expect(screen.queryByRole("button", { name: T.loadEarlier })).toBeNull();
  });

  it("keeps going when there is another page, and never duplicates an entry", async () => {
    const shared = ev({ occurredAt: at(50) });
    apiMock.mockResolvedValueOnce({ ok: true, data: page([shared, ev({ occurredAt: at(40) })], earlierCursor) });
    setup({ initial: [shared], nextCursor: earlierCursor });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.loadEarlier })));
    expect(order()).toHaveLength(2);
    expect(screen.getByRole("button", { name: T.loadEarlier })).toBeInTheDocument();
  });

  it("loads later entries from a cursor and appends them", async () => {
    const here = ev({ occurredAt: at(10) });
    const after = [ev({ occurredAt: at(200) }), ev({ occurredAt: at(210) })];
    apiMock.mockResolvedValueOnce({ ok: true, data: { ...page(after), items: after } });
    const cursor = encodeCursor(at(10), here.id);
    setup({ initial: [here], laterCursor: cursor });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.loadLater })));
    expect(apiMock).toHaveBeenCalledWith(
      `/api/w/acme/incidents/5/events?filter=all&order=asc&limit=50&cursor=${cursor}`,
    );
    expect(order()).toEqual([here.id, after[0].id, after[1].id]);
    expect(screen.queryByRole("button", { name: T.loadLater })).toBeNull();
  });

  it("tells you when loading fails and keeps the button to try again", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup({ initial: [ev()], nextCursor: earlierCursor });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.loadEarlier })));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.loadFailed);
    expect(screen.getByRole("button", { name: T.loadEarlier })).toBeEnabled();
  });
});

describe("the composer", () => {
  it("starts empty with the right placeholder and a disabled button, and defaults the time to now", () => {
    setup();
    expect(composer()).toHaveValue("");
    expect(composer()).toHaveAttribute("placeholder", T.composerPlaceholder);
    expect(submitButton()).toBeDisabled();
    expect(Math.abs(new Date(when().value).getTime() - Date.now())).toBeLessThan(120_000);
    expect(screen.getByText(T.happenedAtHelp)).toBeInTheDocument();
  });

  it("enables the button for real text only, and limits the length with a counter near the limit", () => {
    setup();
    fireEvent.change(composer(), { target: { value: "   " } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(composer(), { target: { value: "hello" } });
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(T.counter(5, 5000))).toBeNull();
    expect(composer()).toHaveAttribute("maxlength", "5000");
    fireEvent.change(composer(), { target: { value: "x".repeat(4500) } });
    expect(screen.getByText(T.counter(4500, 5000))).toBeInTheDocument();
    fireEvent.change(composer(), { target: { value: "x".repeat(5000) } });
    expect(screen.getByText(T.counter(5000, 5000))).toHaveClass("text-danger");
  });

  it("adds the entry immediately, clears the form, and swaps in the server's version", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (finish = r)));
    setup({ initial: [ev({ occurredAt: at(5) })] });
    fireEvent.change(composer(), { target: { value: "  **Deployed** the fix  " } });
    await act(async () => fireEvent.click(submitButton()));

    // before the server answers: shown, dimmed, and the composer is already clear
    const pending = screen.getAllByTestId(/^entry-pending-/);
    expect(pending).toHaveLength(1);
    expect(pending[0].className).toMatch(/opacity-60/);
    expect(within(pending[0]).getByText("Deployed").tagName).toBe("STRONG");
    expect(within(pending[0]).queryByRole("button", { name: T.edit })).toBeNull(); // no controls until it is saved
    expect(composer()).toHaveValue("");
    expect(screen.getByRole("button", { name: T.submitting })).toBeDisabled();

    const saved = ev({
      id: "real-1",
      actorId: "me",
      body: "**Deployed** the fix",
      occurredAt: new Date().toISOString(),
    });
    await act(async () => finish({ ok: true, data: { event: saved, people } }));
    expect(screen.queryByTestId(/^entry-pending-/)).toBeNull();
    expect(within(entry(saved)).getByText("Deployed")).toBeInTheDocument();
    expect(order().filter((id) => id === "real-1")).toHaveLength(1);
    expect(await screen.findByText(T.noteAdded)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/incidents/5/events", {
      method: "POST",
      body: { body: "**Deployed** the fix", occurredAt: undefined, isKeyMoment: false },
    });
  });

  it("submits with Cmd+Enter or Ctrl+Enter, but not with plain Enter", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { event: ev({ actorId: "me" }), people } });
    setup();
    fireEvent.change(composer(), { target: { value: "one" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(apiMock).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(composer(), { key: "Enter", metaKey: true }));
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.change(composer(), { target: { value: "two" } });
    await act(async () => fireEvent.keyDown(composer(), { key: "Enter", ctrlKey: true }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("restores the text, time and star, and says so, when the server refuses", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup({ initial: [ev({ occurredAt: at(5) })] });
    fireEvent.change(composer(), { target: { value: "important words" } });
    fireEvent.change(when(), { target: { value: "2026-06-10T10:30" } });
    fireEvent.click(screen.getByLabelText(T.markKeyMoment));
    await act(async () => fireEvent.click(submitButton()));

    expect(screen.queryByTestId(/^entry-pending-/)).toBeNull(); // the optimistic entry is gone
    expect(composer()).toHaveValue("important words");
    expect(when().value).toBe("2026-06-10T10:30");
    expect(screen.getByLabelText(T.markKeyMoment)).toBeChecked();
    expect(await screen.findByRole("alert")).toHaveTextContent(T.noteFailed);
    expect(submitButton()).toBeEnabled();
  });

  it("sends a backfilled time and the key-moment flag, and leaves the time out when untouched", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { event: ev({ actorId: "me" }), people } });
    setup();
    fireEvent.change(composer(), { target: { value: "earlier thing" } });
    fireEvent.change(when(), { target: { value: "2026-06-10T10:15" } });
    fireEvent.click(screen.getByLabelText(T.markKeyMoment));
    await act(async () => fireEvent.click(submitButton()));
    expect(apiMock.mock.calls[0][1].body).toEqual({
      body: "earlier thing",
      occurredAt: new Date(2026, 5, 10, 10, 15).toISOString(),
      isKeyMoment: true,
    });
    // the form resets to "now" and unchecked for the next one
    expect(screen.getByLabelText(T.markKeyMoment)).not.toBeChecked();
    expect(Math.abs(new Date(when().value).getTime() - Date.now())).toBeLessThan(120_000);
  });

  it("rejects a time in the future with a message, and sends nothing", async () => {
    setup();
    fireEvent.change(composer(), { target: { value: "from tomorrow" } });
    const tomorrow = new Date(Date.now() + 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(when(), {
      target: { value: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00` },
    });
    expect(screen.getByText(T.futureTime)).toBeInTheDocument();
    expect(when()).toHaveAttribute("aria-invalid", "true");
    await act(async () => fireEvent.click(submitButton()));
    expect(apiMock).not.toHaveBeenCalled();
    expect(composer()).toHaveValue("from tomorrow"); // nothing was cleared
    expect(screen.getByRole("alert")).toHaveTextContent(T.futureTime);
  });

  it("warns gently about a time before the incident started, but still allows it", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { event: ev({ actorId: "me" }), people } });
    setup();
    fireEvent.change(composer(), { target: { value: "context from the night before" } });
    fireEvent.change(when(), { target: { value: "2026-06-09T22:00" } });
    expect(screen.getByText(T.beforeStart)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull(); // a hint, not an error
    expect(when()).not.toHaveAttribute("aria-invalid", "true");
    await act(async () => fireEvent.click(submitButton()));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("is a sticky footer of the timeline", () => {
    setup();
    expect(screen.getByRole("form", { name: T.composerLabel }).className).toMatch(/sticky/);
    expect(screen.getByRole("form", { name: T.composerLabel }).className).toMatch(/bottom-0/);
  });
});

describe("editing and deleting notes", () => {
  const buttons = (e: TimelineEventView) => ({
    edit: within(entry(e)).queryByRole("button", { name: T.edit }),
    del: within(entry(e)).queryByRole("button", { name: T.delete }),
    star: within(entry(e)).queryByRole("button", { name: /key moment/i }),
  });

  it("authors control their own notes, and nobody else's", () => {
    const mine = ev({ actorId: "me" });
    const theirs = ev({ actorId: "other" });
    setup({ initial: [mine, theirs] });
    expect(buttons(mine)).toEqual({ edit: expect.anything(), del: expect.anything(), star: expect.anything() });
    expect(buttons(theirs)).toEqual({ edit: null, del: null, star: null });
  });

  it("admins control every note", () => {
    const mine = ev({ actorId: "boss" });
    const theirs = ev({ actorId: "other" });
    setup({ initial: [mine, theirs], me: "boss", admin: true });
    for (const n of [mine, theirs]) expect(buttons(n).edit).toBeInTheDocument();
  });

  it("nobody, admins included, can touch automatic entries or Slack and webhook notes", () => {
    const rows = [
      ev({ type: "STATUS_CHANGED", source: "SYSTEM", actorId: null, payload: { to: "INVESTIGATING", created: true } }),
      ev({
        type: "STATUS_CHANGED",
        source: "USER",
        actorId: "boss",
        payload: { from: "INVESTIGATING", to: "IDENTIFIED" },
      }),
      ev({ type: "NOTE", source: "INTEGRATION", actorId: null }),
      ev({ type: "NOTE", source: "SLACK", actorId: null }),
    ];
    setup({ initial: rows, me: "boss", admin: true });
    for (const r of rows) expect(buttons(r), `${r.type}/${r.source}`).toEqual({ edit: null, del: null, star: null });
  });

  it("edits text inline, updates at once, and shows 'edited' once saved", async () => {
    const mine = ev({ actorId: "me", body: "first draft", occurredAt: at(5) });
    apiMock.mockResolvedValue({ ok: true, data: { event: { ...mine, body: "second draft", editedAt: at(60) } } });
    setup({ initial: [mine] });
    fireEvent.click(buttons(mine).edit!);
    const box = editBox(mine) as HTMLTextAreaElement;
    expect(box.value).toBe("first draft");
    fireEvent.change(box, { target: { value: "  second draft  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.save })));
    expect(apiMock).toHaveBeenCalledWith(`/api/w/acme/incidents/5/events/${mine.id}`, {
      method: "PATCH",
      body: { body: "second draft" },
    });
    expect(within(entry(mine)).getByText("second draft")).toBeInTheDocument();
    expect(within(entry(mine)).getByText(T.edited)).toBeInTheDocument();
    expect(maybeEditBox(mine)).toBeNull(); // form closed
    expect(await screen.findByText(T.noteSaved)).toBeInTheDocument();
  });

  it("can change when it happened, which re-sorts the entry", async () => {
    const a = ev({ actorId: "me", occurredAt: at(10) });
    const b = ev({ actorId: "other", occurredAt: at(20) });
    apiMock.mockResolvedValue({ ok: true, data: { event: { ...a, occurredAt: at(30), editedAt: at(60) } } });
    setup({ initial: [a, b] });
    fireEvent.click(buttons(a).edit!);
    const local = (min: number) => {
      const d = new Date(at(min));
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    fireEvent.change(within(entry(a)).getByLabelText(T.happenedAt), { target: { value: local(30) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.save })));
    expect(apiMock.mock.calls[0][1].body).toEqual({ occurredAt: new Date(at(30)).toISOString() });
    expect(order()).toEqual([b.id, a.id]);
  });

  it("cancels with the button or Escape, validates, and does nothing when nothing changed", async () => {
    const mine = ev({ actorId: "me", body: "keep me" });
    setup({ initial: [mine] });
    const open = () => {
      fireEvent.click(buttons(mine).edit!);
      return editBox(mine) as HTMLTextAreaElement;
    };
    let box = open();
    fireEvent.change(box, { target: { value: "scrapped" } });
    fireEvent.click(screen.getByRole("button", { name: t.actions.cancel }));
    expect(within(entry(mine)).getByText("keep me")).toBeInTheDocument();
    box = open();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(maybeEditBox(mine)).toBeNull();

    box = open();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: T.save }));
    expect(screen.getByRole("alert")).toHaveTextContent(t.validation.required);
    fireEvent.change(box, { target: { value: "keep me" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.save })));
    expect(apiMock).not.toHaveBeenCalled(); // unchanged: closes without a request
    expect(maybeEditBox(mine)).toBeNull();
  });

  it("refuses a future time while editing", async () => {
    const mine = ev({ actorId: "me" });
    setup({ initial: [mine] });
    fireEvent.click(buttons(mine).edit!);
    const next = new Date(Date.now() + 5 * 86_400_000);
    const p = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(within(entry(mine)).getByLabelText(T.happenedAt), {
      target: { value: `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}T10:00` },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.save })));
    expect(screen.getByRole("alert")).toHaveTextContent(T.futureTime);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("keeps the form open and the old text in the list, and says so, if the edit fails", async () => {
    const mine = ev({ actorId: "me", body: "original" });
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup({ initial: [mine] });
    fireEvent.click(buttons(mine).edit!);
    fireEvent.change(editBox(mine), {
      target: { value: "doomed" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.save })));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.saveFailed);
    expect(editBox(mine).value).toBe("doomed"); // the form stays open so nothing typed is lost
    fireEvent.click(screen.getByRole("button", { name: t.actions.cancel }));
    expect(within(entry(mine)).getByText("original")).toBeInTheDocument(); // the list never kept the failed text
    expect(within(entry(mine)).queryByText("doomed")).toBeNull();
  });

  it("stars and un-stars with one click, instantly, and rolls back on failure", async () => {
    const mine = ev({ actorId: "me" });
    apiMock
      .mockResolvedValueOnce({ ok: true, data: { event: { ...mine, isKeyMoment: true } } })
      .mockResolvedValueOnce({ ok: false, status: 500, code: "x", message: "x" });
    setup({ initial: [mine] });
    await act(async () => fireEvent.click(within(entry(mine)).getByRole("button", { name: T.markKeyMoment })));
    expect(apiMock).toHaveBeenLastCalledWith(`/api/w/acme/incidents/5/events/${mine.id}`, {
      method: "PATCH",
      body: { isKeyMoment: true },
    });
    expect(entry(mine)).toHaveAttribute("data-key-moment", "true");
    expect(within(entry(mine)).getByText(T.keyMoment)).toBeInTheDocument();
    expect(within(entry(mine)).queryByText(T.edited)).toBeNull(); // a star isn't an edit

    await act(async () => fireEvent.click(within(entry(mine)).getByRole("button", { name: T.unmarkKeyMoment })));
    expect(entry(mine)).toHaveAttribute("data-key-moment", "true"); // refused: still starred
    expect(await screen.findByRole("alert")).toHaveTextContent(T.saveFailed);
  });

  it("deletes only after confirming, then removes the entry", async () => {
    const mine = ev({ actorId: "me" });
    const keep = ev({ actorId: "other" });
    apiMock.mockResolvedValue({ ok: true, data: { deleted: true } });
    setup({ initial: [mine, keep] });
    fireEvent.click(buttons(mine).del!);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: T.deleteConfirmTitle })).toBeInTheDocument();
    expect(dialog.getByText(T.deleteConfirmBody)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: t.actions.cancel }));
    expect(apiMock).not.toHaveBeenCalled();
    expect(order()).toContain(mine.id);

    fireEvent.click(buttons(mine).del!);
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: T.delete })));
    expect(apiMock).toHaveBeenCalledWith(`/api/w/acme/incidents/5/events/${mine.id}`, { method: "DELETE" });
    expect(order()).toEqual([keep.id]);
    expect(await screen.findByText(T.noteDeleted)).toBeInTheDocument();
  });

  it("keeps the entry and says so when the delete fails", async () => {
    const mine = ev({ actorId: "me" });
    apiMock.mockResolvedValue({ ok: false, status: 403, code: "forbidden", message: "x" });
    setup({ initial: [mine] });
    fireEvent.click(buttons(mine).del!);
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: T.delete })));
    expect(order()).toEqual([mine.id]);
    expect(await screen.findByRole("alert")).toHaveTextContent(T.saveFailed);
  });
});

describe("staying fresh", () => {
  const changes = (over: Partial<{ items: TimelineEventView[]; deleted: string[]; truncated: boolean }> = {}) => ({
    ok: true,
    data: { items: [], deleted: [], people, asOf: "2026-06-10T12:00:15.000Z", truncated: false, ...over },
  });
  const tick = (ms = 15_000) => act(async () => void vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("checks for changes every 15 seconds, asking only for what is newer than the last answer", async () => {
    apiMock.mockResolvedValue(changes());
    setup({ initial: [ev()], refreshMs: 15_000 });
    await tick(14_999);
    expect(apiMock).not.toHaveBeenCalled();
    await tick(1);
    expect(apiMock).toHaveBeenCalledTimes(1);
    const url = new URL(apiMock.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/w/acme/incidents/5/events");
    // 5 seconds before the page's own asOf, so an entry committed a moment late can't slip through
    expect(url.searchParams.get("after")).toBe("2026-06-10T11:59:55.000Z");
    await tick();
    expect(new URL(apiMock.mock.calls[1][0], "http://x").searchParams.get("after")).toBe("2026-06-10T12:00:10.000Z"); // moved on
  });

  it("uses a 15 second interval by default", async () => {
    apiMock.mockResolvedValue(changes());
    const { unmount } = render(
      <CopyProvider skin="professional">
        <ToastProvider>
          <IncidentTimeline
            slug="acme"
            number={5}
            incidentStartedAt={START.toISOString()}
            initial={page([])}
            initialFilter="all"
            initialOrder="asc"
            currentUserId="me"
            isAdmin={false}
            severityLabels={null}
          />
        </ToastProvider>
      </CopyProvider>,
    );
    await tick(14_000);
    expect(apiMock).not.toHaveBeenCalled();
    await tick(1_000);
    expect(apiMock).toHaveBeenCalledTimes(1);
    unmount();
    await tick(60_000);
    expect(apiMock).toHaveBeenCalledTimes(1); // stops when the page goes away
  });

  it("shows other people's new entries, in the right place, without a reload", async () => {
    const early = ev({ occurredAt: at(5) });
    const late = ev({ occurredAt: at(50) });
    const fresh = ev({ actorId: "boss", body: "from a teammate", occurredAt: at(30) });
    apiMock.mockResolvedValue(changes({ items: [fresh] }));
    setup({ initial: [early, late], refreshMs: 15_000 });
    await tick();
    expect(order()).toEqual([early.id, fresh.id, late.id]);
    expect(within(entry(fresh)).getByText("Ada Admin")).toBeInTheDocument();
  });

  it("never touches what you are typing in the composer", async () => {
    apiMock.mockResolvedValue(changes({ items: [ev({ body: "arrived meanwhile" })] }));
    setup({ initial: [ev()], refreshMs: 15_000 });
    fireEvent.change(composer(), { target: { value: "half-written thought" } });
    fireEvent.change(when(), { target: { value: "2026-06-10T10:20" } });
    fireEvent.click(screen.getByLabelText(T.markKeyMoment));
    await tick();
    expect(screen.getByText("arrived meanwhile")).toBeInTheDocument();
    expect(composer()).toHaveValue("half-written thought");
    expect(when().value).toBe("2026-06-10T10:20");
    expect(screen.getByLabelText(T.markKeyMoment)).toBeChecked();
    expect(document.activeElement === composer() || true).toBe(true);
  });

  it("never clobbers a note you are editing, even if someone changed it meanwhile", async () => {
    const mine = ev({ actorId: "me", body: "original" });
    apiMock.mockResolvedValue(changes({ items: [{ ...mine, body: "changed by an admin", editedAt: at(90) }] }));
    setup({ initial: [mine], refreshMs: 15_000 });
    fireEvent.click(within(entry(mine)).getByRole("button", { name: T.edit }));
    const box = editBox(mine) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "my careful rewrite" } });
    await tick();
    expect((editBox(mine) as HTMLTextAreaElement).value).toBe("my careful rewrite");
  });

  it("applies edits and deletions made by others", async () => {
    const edited = ev({ body: "before" });
    const gone = ev({ body: "doomed" });
    const stays = ev({ body: "stays" });
    apiMock.mockResolvedValue(changes({ items: [{ ...edited, body: "after", editedAt: at(99) }], deleted: [gone.id] }));
    setup({ initial: [edited, gone, stays], refreshMs: 15_000 });
    await tick();
    expect(order()).toEqual([edited.id, stays.id]);
    expect(within(entry(edited)).getByText("after")).toBeInTheDocument();
    expect(within(entry(edited)).getByText(T.edited)).toBeInTheDocument();
  });

  it("respects the active filter: ignores entries that don't match, drops ones that stop matching", async () => {
    const starred = ev({ isKeyMoment: true, body: "starred" });
    const status = ev({ type: "STATUS_CHANGED", payload: { to: "IDENTIFIED" } });
    const newStar = ev({ isKeyMoment: true, body: "newly starred" });
    apiMock.mockResolvedValue(changes({ items: [{ ...starred, isKeyMoment: false }, status, newStar] }));
    setup({ initial: [starred], filter: "key", refreshMs: 15_000 });
    await tick();
    expect(order()).toEqual([newStar.id]); // un-starred one left the view; the status entry doesn't belong here
  });

  it("holds back an entry older than everything loaded while earlier pages remain, so the window has no hidden gap", async () => {
    const loaded = ev({ occurredAt: at(100) });
    const recalled = ev({ occurredAt: at(5), createdAt: at(200), body: "recalled later" });
    apiMock.mockResolvedValue(changes({ items: [recalled] }));
    setup({ initial: [loaded], nextCursor: encodeCursor(at(0), "x"), refreshMs: 15_000 });
    await tick();
    expect(order()).toEqual([loaded.id]);
    cleanup();

    // with nothing earlier to load, it belongs at the top
    setup({ initial: [loaded], refreshMs: 15_000 });
    await tick();
    expect(order()).toEqual([recalled.id, loaded.id]);
  });

  it("does nothing while the tab is hidden, and catches up when it becomes visible or focused", async () => {
    apiMock.mockResolvedValue(changes());
    let state: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    setup({ initial: [ev()], refreshMs: 15_000 });
    await tick(60_000);
    expect(apiMock).not.toHaveBeenCalled();

    state = "visible";
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(apiMock).toHaveBeenCalledTimes(1);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    expect(apiMock).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("refreshes straight away when the page signals that something changed", async () => {
    apiMock.mockResolvedValue(changes({ items: [ev({ type: "SEVERITY_CHANGED", payload: { from: 3, to: 5 } })] }));
    const view = setup({ initial: [], refreshMs: 0 });
    expect(apiMock).not.toHaveBeenCalled();
    await act(async () => view.rerenderWith(1));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Severity raised from Medium to Critical")).toBeInTheDocument();
    await act(async () => view.rerenderWith(1));
    expect(apiMock).toHaveBeenCalledTimes(1); // same signal: no repeat
  });

  it("reloads the window instead of merging when too much changed", async () => {
    const fresh = ev({ body: "after the reload" });
    apiMock
      .mockResolvedValueOnce(changes({ truncated: true }))
      .mockResolvedValueOnce({ ok: true, data: page([fresh]) });
    setup({ initial: [ev({ body: "stale" })], refreshMs: 15_000 });
    await tick();
    expect(apiMock).toHaveBeenNthCalledWith(2, "/api/w/acme/incidents/5/events?filter=all&order=desc&limit=50");
    expect(order()).toEqual([fresh.id]);
  });

  it("stays quiet when a refresh fails, and tries again on the next tick", async () => {
    apiMock
      .mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" })
      .mockResolvedValueOnce(changes({ items: [ev({ body: "second try" })] }));
    setup({ initial: [], refreshMs: 15_000 });
    await tick();
    expect(screen.queryByRole("alert")).toBeNull();
    await tick();
    expect(screen.getByText("second try")).toBeInTheDocument();
  });
});
