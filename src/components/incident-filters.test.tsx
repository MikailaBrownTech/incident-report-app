// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCopy } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { parseListParams } from "@/features/incidents/list-params";
import { IncidentFilters } from "./incident-filters";

const PATH = "/app/acme/incidents";
const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/app/acme/incidents",
  useSearchParams: () => new URLSearchParams(nav.query),
}));

const t = getCopy("professional");
const services = [
  { id: "s1", name: "API" },
  { id: "s2", name: "Web" },
];

beforeEach(() => {
  nav.replace.mockReset();
  nav.query = "";
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Render for the given URL query, the way the page would (params parsed from the same query). */
function setup(query = "") {
  nav.query = query;
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(new URLSearchParams(query).keys())) {
    const all = new URLSearchParams(query).getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  return render(
    <CopyProvider skin="professional">
      <IncidentFilters params={parseListParams(raw)} services={services} severityLabels={{ "5": "Sev One" }} />
    </CopyProvider>,
  );
}

/** The URL the component navigated to, as pathname + decoded params. */
function lastUrl() {
  const call = nav.replace.mock.calls.at(-1);
  expect(call, "router.replace was not called").toBeTruthy();
  const [href, options] = call!;
  const url = new URL(href, "http://x");
  expect(options).toEqual({ scroll: false });
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
}

describe("search", () => {
  it("waits for a pause in typing (300ms) before updating the URL", () => {
    setup();
    const box = screen.getByLabelText(t.incidentList.searchLabel);
    fireEvent.change(box, { target: { value: "check" } });
    act(() => void vi.advanceTimersByTime(299));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(lastUrl()).toEqual({ path: PATH, params: { q: "check" } });
  });

  it("restarts the wait on every keystroke, so only the final text is searched", () => {
    setup();
    const box = screen.getByLabelText(t.incidentList.searchLabel);
    for (const text of ["c", "ch", "che", "chec"]) {
      fireEvent.change(box, { target: { value: text } });
      act(() => void vi.advanceTimersByTime(200));
    }
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(100));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(lastUrl().params.q).toBe("chec");
  });

  it("trims, keeps other filters, and drops the pagination cursor", () => {
    setup("status=RESOLVED&after=abc123&sort=severity");
    fireEvent.change(screen.getByLabelText(t.incidentList.searchLabel), { target: { value: "  slow  " } });
    act(() => void vi.advanceTimersByTime(300));
    expect(lastUrl().params).toEqual({ status: "RESOLVED", sort: "severity", q: "slow" });
  });

  it("clearing the box removes q; unchanged text makes no navigation", () => {
    setup("q=old");
    const box = screen.getByLabelText(t.incidentList.searchLabel) as HTMLInputElement;
    expect(box.value).toBe("old");
    fireEvent.change(box, { target: { value: "old" } });
    act(() => void vi.advanceTimersByTime(500));
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "" } });
    act(() => void vi.advanceTimersByTime(300));
    expect(lastUrl()).toEqual({ path: PATH, params: {} });
  });
});

describe("chips", () => {
  it("toggles statuses on and off, combining several, and reflects aria-pressed", () => {
    setup();
    const investigating = screen.getByRole("button", { name: t.status.INVESTIGATING });
    expect(investigating).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(investigating);
    expect(lastUrl().params).toEqual({ status: "INVESTIGATING" });

    cleanup();
    setup("status=INVESTIGATING");
    expect(screen.getByRole("button", { name: t.status.INVESTIGATING })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t.status.RESOLVED }));
    expect(lastUrl().params).toEqual({ status: "INVESTIGATING,RESOLVED" });
    fireEvent.click(screen.getByRole("button", { name: t.status.INVESTIGATING }));
    expect(lastUrl().params).toEqual({}); // unchanged query (the mock doesn't navigate), so only the toggled value is gone
  });

  it("uses severity names from the dictionary and workspace overrides", () => {
    setup("severity=2");
    expect(screen.getByRole("button", { name: "Sev One" })).toBeInTheDocument(); // override for level 5
    expect(screen.getByRole("button", { name: t.severity[2] })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sev One" }));
    expect(lastUrl().params).toEqual({ severity: "2,5" });
  });
});

describe("open only", () => {
  it("is on by default; switching it off writes open=0, back on removes it", () => {
    setup();
    const toggle = screen.getByLabelText(t.incidentList.openOnly);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(lastUrl().params).toEqual({ open: "0" });

    cleanup();
    setup("open=0");
    expect(screen.getByLabelText(t.incidentList.openOnly)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(t.incidentList.openOnly));
    expect(lastUrl().params).toEqual({});
  });

  it("is disabled while a status is chosen, because an explicit status wins", () => {
    setup("status=RESOLVED");
    const toggle = screen.getByLabelText(t.incidentList.openOnly);
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  });
});

describe("sorting", () => {
  it("changes the column, resetting direction; the default column leaves the URL clean", () => {
    setup("dir=asc");
    fireEvent.change(screen.getByLabelText(t.incidentList.sortBy), { target: { value: "severity" } });
    expect(lastUrl().params).toEqual({ sort: "severity" }); // dir dropped: severity's natural order is descending
    cleanup();
    setup("sort=severity");
    fireEvent.change(screen.getByLabelText(t.incidentList.sortBy), { target: { value: "started" } });
    expect(lastUrl().params).toEqual({});
  });

  it("flips direction, omitting dir when it equals the column's natural direction", () => {
    setup(); // started, descending (natural)
    fireEvent.click(screen.getByRole("button", { name: t.incidentList.sortDescending }));
    expect(lastUrl().params).toEqual({ dir: "asc" });

    cleanup();
    setup("sort=status"); // status is naturally ascending
    fireEvent.click(screen.getByRole("button", { name: t.incidentList.sortAscending }));
    expect(lastUrl().params).toEqual({ sort: "status", dir: "desc" });

    cleanup();
    setup("sort=status&dir=desc");
    fireEvent.click(screen.getByRole("button", { name: t.incidentList.sortDescending }));
    expect(lastUrl().params).toEqual({ sort: "status" });
  });
});

describe("services and dates", () => {
  it("picks services from a checklist and shows how many are selected", () => {
    setup("service=s1");
    expect(screen.getByText(`${t.incidentList.serviceFilter} (1)`)).toBeInTheDocument();
    expect(screen.getByLabelText("API")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Web"));
    expect(lastUrl().params).toEqual({ service: "s1,s2" });
    fireEvent.click(screen.getByLabelText("API"));
    expect(lastUrl().params).toEqual({});
  });

  it("sets and clears the date range", () => {
    setup("from=2026-01-02");
    const from = screen.getByLabelText(t.incidentList.dateFrom) as HTMLInputElement;
    const to = screen.getByLabelText(t.incidentList.dateTo) as HTMLInputElement;
    expect(from.value).toBe("2026-01-02");
    expect(to.min).toBe("2026-01-02"); // can't pick an end before the start
    fireEvent.change(to, { target: { value: "2026-01-09" } });
    expect(lastUrl().params).toEqual({ from: "2026-01-02", to: "2026-01-09" });
    fireEvent.change(from, { target: { value: "" } });
    expect(lastUrl().params).toEqual({});
  });
});

describe("clear filters", () => {
  it("only shows when something is filtered, and resets the whole URL and search box", () => {
    setup();
    expect(screen.queryByRole("button", { name: t.incidentList.clearFilters })).toBeNull();
    cleanup();

    setup("q=slow&severity=5&sort=number");
    expect((screen.getByLabelText(t.incidentList.searchLabel) as HTMLInputElement).value).toBe("slow");
    fireEvent.click(screen.getByRole("button", { name: t.incidentList.clearFilters }));
    expect(nav.replace).toHaveBeenCalledWith(PATH, { scroll: false });
    expect((screen.getByLabelText(t.incidentList.searchLabel) as HTMLInputElement).value).toBe("");
  });

  it("treats switching open-only off as a filter", () => {
    setup("open=0");
    expect(screen.getByRole("button", { name: t.incidentList.clearFilters })).toBeInTheDocument();
  });
});
