// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import type { IncidentRow } from "@/features/incidents/list";
import { IncidentList } from "./incident-list";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => apiMock.mockReset());
afterEach(cleanup);

const row = (n: number, over: Partial<IncidentRow> = {}): IncidentRow => ({
  id: `id${n}`,
  number: n,
  title: `Incident title ${n}`,
  severity: 3,
  status: "INVESTIGATING",
  startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  resolvedAt: null,
  services: [],
  commander: null,
  ...over,
});

function setup(
  props: Partial<React.ComponentProps<typeof IncidentList>> = {},
  skin: SkinKey = "professional",
) {
  return render(
    <CopyProvider skin={skin}>
      <ToastProvider>
        <IncidentList
          slug="acme"
          initial={[row(2), row(1)]}
          initialCursor={null}
          queryString=""
          hasFilters={false}
          severityLabels={null}
          {...props}
        />
      </ToastProvider>
    </CopyProvider>,
  );
}

describe("rows", () => {
  it("shows the number in the skin's own style, the title as a link, severity and status", () => {
    const pro = getCopy("professional");
    setup({ initial: [row(42, { severity: 5, status: "MITIGATING" })] });
    const r = screen.getByTestId("incident-42");
    expect(within(r).getByText("INC-42")).toBeInTheDocument();
    expect(within(r).getByRole("link", { name: "Incident title 42" })).toHaveAttribute("href", "/app/acme/incidents/42");
    expect(within(r).getByText(pro.severity[5])).toBeInTheDocument();
    expect(within(r).getByText(pro.status.MITIGATING)).toBeInTheDocument();
    cleanup();

    const haunted = getCopy("haunted");
    setup({ initial: [row(42, { severity: 5, status: "MITIGATING" })] }, "haunted");
    const h = screen.getByTestId("incident-42");
    expect(within(h).getByText("Haunting #42")).toBeInTheDocument();
    expect(within(h).getByText(haunted.severity[5])).toBeInTheDocument();
    expect(within(h).getByText(haunted.status.MITIGATING)).toBeInTheDocument();
  });

  it("applies workspace severity names", () => {
    setup({ initial: [row(1, { severity: 4 })], severityLabels: { "4": "Sev Two" } });
    expect(screen.getByText("Sev Two")).toBeInTheDocument();
  });

  it("shows the first two services and +N for the rest, with the rest in a tooltip", () => {
    const names = ["API", "Web", "Search", "Email"];
    setup({ initial: [row(1, { services: names.map((name, i) => ({ id: `s${i}`, name })) })] });
    const r = screen.getByTestId("incident-1");
    expect(within(r).getByText("API")).toBeInTheDocument();
    expect(within(r).getByText("Web")).toBeInTheDocument();
    expect(within(r).queryByText("Search")).toBeNull();
    const more = within(r).getByText("+2");
    expect(more).toHaveAttribute("title", "Search, Email");
  });

  it("shows a dash with no services, one chip and no +N for one or two", () => {
    setup({ initial: [row(1), row(2, { services: [{ id: "s", name: "API" }] }), row(3, { services: [{ id: "a", name: "A" }, { id: "b", name: "B" }] })] });
    expect(within(screen.getByTestId("incident-1")).getByText("—")).toBeInTheDocument();
    expect(within(screen.getByTestId("incident-2")).queryByText(/^\+/)).toBeNull();
    expect(within(screen.getByTestId("incident-3")).queryByText(/^\+/)).toBeNull();
  });

  it("shows the commander by name for screen readers, or that nobody is assigned", () => {
    setup({
      initial: [
        row(1, { commander: { name: "Ada Lovelace", email: "ada@x.test", image: null } }),
        row(2, { commander: { name: "", email: "nameless@x.test", image: null } }),
        row(3),
      ],
    });
    expect(within(screen.getByTestId("incident-1")).getByText("Ada Lovelace")).toHaveClass("sr-only");
    expect(within(screen.getByTestId("incident-2")).getByText("nameless@x.test")).toHaveClass("sr-only");
    expect(within(screen.getByTestId("incident-3")).getByText(getCopy("professional").incidentList.unassigned)).toBeInTheDocument();
  });

  it("shows relative start time with the exact time as a tooltip, and a duration", () => {
    const started = new Date(Date.now() - 2 * 3_600_000 - 5 * 60_000);
    setup({ initial: [row(1, { startedAt: started.toISOString() })] });
    const r = screen.getByTestId("incident-1");
    const time = within(r).getByText("2 hours ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", started.toISOString());
    expect(time.getAttribute("title")).toMatch(/\d{4}.*\d{1,2}:\d{2}/);
    expect(within(r).getByText(/^2h 0[45]m/)).toBeInTheDocument();
  });

  it("ticks the duration of an open incident every second, and freezes a resolved one", () => {
    vi.useFakeTimers();
    const started = new Date(Date.now() - 59_000);
    const resolved = new Date(started.getTime() + 90 * 60_000);
    setup({
      initial: [
        row(1, { startedAt: started.toISOString() }),
        row(2, { startedAt: started.toISOString(), resolvedAt: resolved.toISOString(), status: "RESOLVED" }),
      ],
    });
    const open = () => within(screen.getByTestId("incident-1")).getByText(/^\d+m? ?\d*s?/);
    const before = open().textContent;
    act(() => void vi.advanceTimersByTime(3000));
    expect(open().textContent).not.toBe(before);
    expect(within(screen.getByTestId("incident-2")).getByText("1h 30m")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(within(screen.getByTestId("incident-2")).getByText("1h 30m")).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("empty states", () => {
  it("says there are no incidents when nothing is filtered", () => {
    setup({ initial: [] });
    expect(screen.getByText(getCopy("professional").empty.incidents[0])).toBeInTheDocument();
  });

  it("says nothing matches when filters are active", () => {
    setup({ initial: [], hasFilters: true });
    expect(screen.getByText(getCopy("professional").incidentList.noMatches)).toBeInTheDocument();
  });

  it("uses the haunted voice in the haunted skin", () => {
    setup({ initial: [] }, "haunted");
    expect(screen.getByText(/Suspiciously quiet|Don't jinx it/)).toBeInTheDocument();
  });
});

describe("load more", () => {
  const t = getCopy("professional");

  it("only shows when there is another page", () => {
    setup({ initialCursor: null });
    expect(screen.queryByRole("button", { name: t.incidentList.loadMore })).toBeNull();
    cleanup();
    setup({ initialCursor: "id1" });
    expect(screen.getByRole("button", { name: t.incidentList.loadMore })).toBeInTheDocument();
  });

  it("fetches the next page with the same filters plus the cursor, and appends", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { items: [row(0)], nextCursor: null } });
    setup({ initialCursor: "id1", queryString: "status=RESOLVED&q=slow" });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.incidentList.loadMore })));

    const url = new URL(apiMock.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/w/acme/incidents");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "RESOLVED", q: "slow", after: "id1" });
    expect(screen.getAllByTestId(/^incident-/).map((n) => n.dataset.testid)).toEqual(["incident-2", "incident-1", "incident-0"]);
    expect(screen.queryByRole("button", { name: t.incidentList.loadMore })).toBeNull(); // no further page
  });

  it("keeps paging when there is yet another cursor", async () => {
    apiMock
      .mockResolvedValueOnce({ ok: true, data: { items: [row(0)], nextCursor: "id0" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [row(-1)], nextCursor: null } });
    setup({ initialCursor: "id1" });
    for (let i = 0; i < 2; i++) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: t.incidentList.loadMore })));
    }
    expect(new URL(apiMock.mock.calls[1][0], "http://x").searchParams.get("after")).toBe("id0");
    expect(screen.getAllByTestId(/^incident-/)).toHaveLength(4);
  });

  it("keeps the rows and the button, and shows an error toast, when loading fails", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup({ initialCursor: "id1" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.incidentList.loadMore })));
    expect(screen.getAllByTestId(/^incident-/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: t.incidentList.loadMore })).toBeEnabled();
    expect(await screen.findByRole("alert")).toHaveTextContent(t.errors.generic);
  });

  it("disables the button while a page is loading", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup({ initialCursor: "id1" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: t.incidentList.loadMore })));
    expect(screen.getByRole("button", { name: t.incidentList.loadMore })).toBeDisabled();
    await act(async () => finish({ ok: true, data: { items: [], nextCursor: null } }));
  });
});
