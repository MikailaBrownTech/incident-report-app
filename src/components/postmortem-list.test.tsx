// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostmortemFilters } from "@/components/postmortem-filters";
import { PostmortemList } from "@/components/postmortem-list";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { parseListParams, type PostmortemListRow } from "@/features/postmortems/schema";

const apiMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/app/acme/postmortems",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const T = getCopy("professional").postmortem;
const L = T.list;
const DAY = 86_400_000;
const NOW = new Date("2026-06-20T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const person = { userId: "u1", name: "Maya Member", email: "maya@x.test", image: null };
function row(over: Partial<PostmortemListRow> & { number: number }): PostmortemListRow {
  return {
    incidentId: `inc${over.number}`,
    title: `Outage ${over.number}`,
    severity: 4,
    postmortemId: null,
    state: "REQUIRED",
    dueAt: null,
    publishedAt: null,
    author: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  apiMock.mockReset();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.search = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderList(
  initial: PostmortemListRow[],
  opts: { cursor?: string | null; hasFilters?: boolean; queryString?: string; skin?: SkinKey } = {},
) {
  return render(
    <CopyProvider skin={opts.skin ?? "professional"}>
      <ToastProvider>
        <PostmortemList
          slug="acme"
          initial={initial}
          initialCursor={opts.cursor ?? null}
          queryString={opts.queryString ?? ""}
          hasFilters={opts.hasFilters ?? false}
          severityLabels={null}
        />
      </ToastProvider>
    </CopyProvider>,
  );
}
const cell = (number: number, label: string) =>
  within(screen.getByTestId(`postmortem-${number}`)).getByRole("cell", {
    name: (_, el) => el.getAttribute("data-label") === label,
  });

describe("the table", () => {
  it("shows incident, severity, state, author, due date and published date", () => {
    renderList([
      row({ number: 1, state: "OVERDUE", dueAt: at(-3) }),
      row({ number: 2, state: "DUE_SOON", dueAt: at(1.5) }),
      row({ number: 3, state: "REQUIRED", dueAt: at(4) }),
      row({ number: 4, state: "DRAFT", postmortemId: "pm4", author: person }),
      row({ number: 5, state: "PUBLISHED", postmortemId: "pm5", author: person, publishedAt: at(-2) }),
    ]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      L.columns.incident,
      L.columns.severity,
      L.columns.state,
      L.columns.author,
      L.columns.due,
      L.columns.published,
    ]);
    expect(cell(1, L.columns.incident)).toHaveTextContent("INC-1");
    expect(cell(1, L.columns.incident)).toHaveTextContent("Outage 1");
    expect(cell(1, L.columns.state)).toHaveTextContent(T.states.OVERDUE);
    expect(cell(1, L.columns.due)).toHaveTextContent(T.overdueBy(3));
    expect(cell(2, L.columns.due)).toHaveTextContent(T.dueIn(2));
    expect(cell(3, L.columns.due)).toHaveTextContent(T.dueIn(4));
    expect(cell(4, L.columns.state)).toHaveTextContent(T.states.DRAFT);
    expect(cell(4, L.columns.author)).toHaveTextContent("Maya Member");
    expect(cell(4, L.columns.due)).toHaveTextContent(T.noDueDate);
    expect(cell(5, L.columns.published).querySelector("time")).toHaveAttribute("dateTime", at(-2));
    expect(cell(1, L.columns.author)).toHaveTextContent(L.noAuthor);
    expect(cell(1, L.columns.published)).toHaveTextContent("-");
  });

  it("shows the exact due date in a tooltip, and marks overdue with an icon as well as words", () => {
    renderList([row({ number: 1, state: "OVERDUE", dueAt: at(-3) })]);
    const due = cell(1, L.columns.due);
    expect(due.querySelector("[title]")?.getAttribute("title")).toMatch(/2026/);
    expect(within(due).getByRole("img", { name: getCopy("professional").a11y.overdueIcon })).toBeInTheDocument();
  });

  it("opens the editor for rows with a postmortem, and the incident for ones that still need starting", () => {
    renderList([row({ number: 1, postmortemId: "pm1", state: "DRAFT" }), row({ number: 2 })]);
    expect(within(screen.getByTestId("postmortem-1")).getByRole("link")).toHaveAttribute(
      "href",
      "/app/acme/incidents/1/postmortem",
    );
    expect(within(screen.getByTestId("postmortem-2")).getByRole("link")).toHaveAttribute(
      "href",
      "/app/acme/incidents/2",
    );
  });

  it("moves from due soon to overdue wording as time passes", async () => {
    renderList([row({ number: 1, state: "DUE_SOON", dueAt: at(0.01) })]);
    expect(cell(1, L.columns.due)).toHaveTextContent(T.dueIn(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)));
    expect(cell(1, L.columns.due)).toHaveTextContent(T.overdueBy(1));
  });

  it("speaks the haunted skin's words", () => {
    renderList([row({ number: 1, state: "OVERDUE", dueAt: at(-2) })], { skin: "haunted" });
    expect(cell(1, "Haunting")).toBeInTheDocument();
    expect(cell(1, "Haunting")).toHaveTextContent("Haunting #1");
    expect(screen.getByText(getCopy("haunted").postmortem.states.OVERDUE)).toBeInTheDocument();
  });
});

describe("loading more", () => {
  it("fetches the next page with the same filters and the cursor, and appends it", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { items: [row({ number: 9 })], nextCursor: null } });
    renderList([row({ number: 1 })], { cursor: "c1", queryString: "state=OVERDUE&sort=due" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: L.loadMore })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/postmortems?state=OVERDUE&sort=due&cursor=c1");
    expect(screen.getAllByTestId(/^postmortem-/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: L.loadMore })).toBeNull();
  });

  it("offers a retry when it fails", async () => {
    apiMock.mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" });
    apiMock.mockResolvedValueOnce({ ok: true, data: { items: [row({ number: 2 })], nextCursor: null } });
    renderList([row({ number: 1 })], { cursor: "c1" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: L.loadMore })));
    expect(screen.getByText(L.loadFailed)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: L.retry })));
    expect(screen.getAllByTestId(/^postmortem-/)).toHaveLength(2);
  });

  it("shows no button when there is no more", () => {
    renderList([row({ number: 1 })]);
    expect(screen.queryByRole("button", { name: L.loadMore })).toBeNull();
  });
});

describe("empty states", () => {
  it("says there is nothing yet when there are no filters", () => {
    renderList([]);
    expect(screen.getByText(getCopy("professional").empty.postmortems[0])).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: L.clearFilters })).toBeNull();
  });

  it("says nothing matches when filters hide everything, and offers to clear them", () => {
    renderList([], { hasFilters: true });
    expect(screen.getByText(L.noResults)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.clearFilters }));
    expect(nav.push).toHaveBeenCalledWith("/app/acme/postmortems");
  });

  it("is a little funny in the haunted skin", () => {
    renderList([], { skin: "haunted" });
    expect(getCopy("haunted").empty.postmortems.some((m) => screen.queryByText(m))).toBe(true);
  });
});

describe("filters", () => {
  function renderFilters(query = "", skin: SkinKey = "professional") {
    nav.search = query;
    const params = parseListParams(Object.fromEntries(new URLSearchParams(query)));
    return render(
      <CopyProvider skin={skin}>
        <PostmortemFilters params={params} severityLabels={null} />
      </CopyProvider>,
    );
  }
  const lastUrl = () => nav.push.mock.calls.at(-1)?.[0] as string;

  it("shows the current filters as pressed", () => {
    renderFilters("state=OVERDUE,DRAFT&severity=4&attention=1&q=checkout");
    expect(screen.getByRole("button", { name: T.states.OVERDUE })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: T.states.DRAFT })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: T.states.PUBLISHED })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: L.needsAttention })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(L.searchLabel)).toHaveValue("checkout");
  });

  it("writes state, severity and needs-attention to the URL", () => {
    renderFilters();
    fireEvent.click(screen.getByRole("button", { name: T.states.OVERDUE }));
    expect(lastUrl()).toBe("/app/acme/postmortems?state=OVERDUE");
    fireEvent.click(screen.getByRole("button", { name: L.needsAttention }));
    expect(lastUrl()).toBe("/app/acme/postmortems?attention=1");
    fireEvent.click(screen.getByRole("button", { name: getCopy("professional").severity[4] }));
    expect(lastUrl()).toMatch(/severity=\d/);
  });

  it("adds to and removes from a multi-value filter, and starts again from the first page", () => {
    renderFilters("state=OVERDUE&cursor=abc");
    fireEvent.click(screen.getByRole("button", { name: T.states.DRAFT }));
    expect(new URLSearchParams(lastUrl().split("?")[1]).get("state")).toBe("OVERDUE,DRAFT");
    expect(lastUrl()).not.toContain("cursor");
    cleanup();
    renderFilters("state=OVERDUE,DRAFT");
    fireEvent.click(screen.getByRole("button", { name: T.states.OVERDUE }));
    expect(new URLSearchParams(lastUrl().split("?")[1]).get("state")).toBe("DRAFT");
  });

  it("keeps the default sort out of the URL", () => {
    renderFilters("sort=severity");
    fireEvent.change(screen.getByLabelText(L.sortLabel), { target: { value: "due" } });
    expect(lastUrl()).toBe("/app/acme/postmortems");
    fireEvent.change(screen.getByLabelText(L.sortLabel), { target: { value: "number" } });
    expect(lastUrl()).toBe("/app/acme/postmortems?sort=number");
  });

  it("waits for a pause in typing before searching, and replaces rather than pushes history", async () => {
    renderFilters();
    const box = screen.getByLabelText(L.searchLabel);
    fireEvent.change(box, { target: { value: "chec" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    fireEvent.change(box, { target: { value: "checkout" } });
    await act(async () => void (await vi.advanceTimersByTimeAsync(299)));
    expect(nav.replace).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/app/acme/postmortems?q=checkout", { scroll: false });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("clears everything at once, only when something is applied", () => {
    renderFilters();
    expect(screen.queryByRole("button", { name: L.clearFilters })).toBeNull();
    cleanup();
    renderFilters("state=DRAFT");
    fireEvent.click(screen.getByRole("button", { name: L.clearFilters }));
    expect(nav.push).toHaveBeenCalledWith("/app/acme/postmortems");
  });
});
