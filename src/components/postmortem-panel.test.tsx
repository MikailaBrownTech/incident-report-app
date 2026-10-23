// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostmortemPanel } from "@/components/postmortem-panel";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { BUILT_IN_TEMPLATES } from "@/features/postmortems/sections";
import type { RuleLike } from "@/features/postmortems/status";
import { polyfillDialog } from "@/test/dialog-polyfill";

const apiMock = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const T = getCopy("professional").postmortem;
const DAY = 86_400_000;
const RULES: RuleLike[] = [{ minSeverity: 4, mode: "REQUIRED", dueInDays: 5 }];
const NOW = new Date("2026-06-20T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

beforeAll(polyfillDialog);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  apiMock.mockReset();
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Incident = { number: number; severity: number; status: string; resolvedAt: string | null };
const resolved = (severity: number, daysAgo: number): Incident => ({
  number: 5,
  severity,
  status: "RESOLVED",
  resolvedAt: ago(daysAgo),
});

function setup(
  incident: Incident,
  postmortemStatus: "DRAFT" | "PUBLISHED" | null = null,
  opts: { skin?: SkinKey; rules?: RuleLike[] } = {},
) {
  const ui = (i: Incident) => (
    <CopyProvider skin={opts.skin ?? "professional"}>
      <ToastProvider>
        <PostmortemPanel
          slug="acme"
          incident={i}
          postmortemStatus={postmortemStatus}
          rules={opts.rules ?? RULES}
          templates={BUILT_IN_TEMPLATES}
        />
      </ToastProvider>
    </CopyProvider>
  );
  const view = render(ui(incident));
  return { ...view, update: (i: Incident) => view.rerender(ui(i)) };
}
const panel = () => screen.getByRole("region", { name: T.singular });

describe("what it says", () => {
  it("says a postmortem is required and when it is due", () => {
    setup(resolved(4, 1));
    expect(panel()).toHaveAttribute("data-postmortem-state", "REQUIRED");
    expect(within(panel()).getByText(T.banner.required(4))).toBeInTheDocument();
    expect(within(panel()).getByText(T.states.REQUIRED)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: T.start })).toBeInTheDocument();
  });

  it("says due in 5 days for an incident resolved just now", () => {
    setup(resolved(5, 0));
    expect(within(panel()).getByText(T.banner.required(5))).toBeInTheDocument();
  });

  it("warns when it is due soon", () => {
    setup(resolved(4, 4));
    expect(panel()).toHaveAttribute("data-postmortem-state", "DUE_SOON");
    expect(within(panel()).getByText(T.banner.dueSoon(1))).toBeInTheDocument();
  });

  it("says how many days overdue, as an alert that doesn't rely on colour", () => {
    setup(resolved(4, 7));
    expect(within(panel()).getByRole("alert")).toHaveTextContent(T.banner.overdue(2));
    expect(within(panel()).getByText(T.states.OVERDUE)).toBeInTheDocument();
    expect(panel().querySelector("svg")).not.toBeNull(); // the badge carries an icon
  });

  it("says one day, not 1 days", () => {
    setup(resolved(4, 6));
    expect(within(panel()).getByRole("alert")).toHaveTextContent("overdue by 1 day");
  });

  it("is quiet for incidents that don't need one, but still offers to start", () => {
    setup(resolved(2, 3));
    expect(panel()).toHaveAttribute("data-postmortem-state", "OPTIONAL");
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(within(panel()).queryByText(/required|overdue/i)).toBeNull();
    expect(within(panel()).getByRole("button", { name: T.start })).toBeInTheDocument();
  });

  it("offers to start on an open incident, with a gentle hint", () => {
    setup({ number: 5, severity: 5, status: "INVESTIGATING", resolvedAt: null });
    expect(panel()).toHaveAttribute("data-postmortem-state", "NOT_APPLICABLE");
    expect(within(panel()).getByText(T.banner.openHint)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: T.start })).toBeInTheDocument();
  });

  it("links to a draft instead of offering to start another, and keeps overdue visible", () => {
    setup(resolved(4, 9), "DRAFT");
    expect(within(panel()).getByText(T.banner.draft)).toBeInTheDocument();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(T.banner.overdue(4));
    expect(within(panel()).getByRole("link", { name: T.banner.continue })).toHaveAttribute(
      "href",
      "/app/acme/incidents/5/postmortem",
    );
    expect(within(panel()).queryByRole("button", { name: T.start })).toBeNull();
  });

  it("links to a published one with no warnings", () => {
    setup(resolved(4, 30), "PUBLISHED");
    expect(within(panel()).getByText(T.states.PUBLISHED)).toBeInTheDocument();
    expect(within(panel()).queryByRole("alert")).toBeNull();
    expect(within(panel()).getByRole("link", { name: T.banner.view })).toHaveAttribute(
      "href",
      "/app/acme/incidents/5/postmortem",
    );
  });

  it("follows the incident as it is resolved and reopened", () => {
    const open = { number: 5, severity: 4, status: "MITIGATING", resolvedAt: null };
    const view = setup(open);
    expect(panel()).toHaveAttribute("data-postmortem-state", "NOT_APPLICABLE");
    view.update({ ...open, status: "RESOLVED", resolvedAt: NOW.toISOString() });
    expect(within(panel()).getByText(T.banner.required(5))).toBeInTheDocument();
    view.update(open);
    expect(panel()).toHaveAttribute("data-postmortem-state", "NOT_APPLICABLE");
    expect(within(panel()).queryByText(T.banner.required(5))).toBeNull();
  });

  it("moves from due soon to overdue as time passes", async () => {
    setup(resolved(4, 4.9));
    expect(panel()).toHaveAttribute("data-postmortem-state", "DUE_SOON");
    await act(async () => void (await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)));
    expect(panel()).toHaveAttribute("data-postmortem-state", "OVERDUE");
  });

  it("uses the haunted skin's words", () => {
    setup(resolved(4, 1), null, { skin: "haunted" });
    const h = getCopy("haunted").postmortem;
    const region = screen.getByRole("region", { name: h.singular });
    expect(within(region).getByText(h.banner.required(4))).toHaveTextContent("Autopsy required, due in 4 days");
    expect(within(region).getByRole("button", { name: "Begin the autopsy" })).toBeInTheDocument();
  });
});

describe("starting one", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: T.start }));
  const dialog = () => screen.getByRole("dialog", { name: T.chooseTemplate });
  const radio = (name: RegExp) => within(dialog()).getByRole("radio", { name }) as HTMLInputElement;

  it("preselects the template that suits the severity, and lets you change it", () => {
    setup(resolved(4, 1));
    open();
    expect(radio(/Standard/)).toBeChecked();
    expect(radio(/Quick/)).not.toBeChecked();
    fireEvent.click(radio(/Quick/));
    expect(radio(/Quick/)).toBeChecked();
  });

  it("preselects the quick review for severity 1 and 2", () => {
    setup(resolved(2, 1));
    open();
    expect(radio(/Quick/)).toBeChecked();
    cleanup();
    setup(resolved(3, 1));
    open();
    expect(radio(/Standard/)).toBeChecked();
  });

  it("warns gently when the incident is still open, and not when it is resolved", () => {
    setup({ number: 5, severity: 4, status: "IDENTIFIED", resolvedAt: null });
    open();
    expect(within(dialog()).getByRole("note")).toHaveTextContent(T.startOpenWarning);
    cleanup();
    setup(resolved(4, 1));
    open();
    expect(within(dialog()).queryByRole("note")).toBeNull();
  });

  it("creates the chosen template and opens the editor", async () => {
    apiMock.mockResolvedValue({ ok: true, data: {} });
    setup(resolved(4, 1));
    open();
    fireEvent.click(radio(/Quick/));
    await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: T.start })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/incidents/5/postmortem", {
      method: "POST",
      body: { templateId: "tpl_quick" },
    });
    expect(push).toHaveBeenCalledWith("/app/acme/incidents/5/postmortem");
  });

  it("sends the suggested template when you change nothing", async () => {
    apiMock.mockResolvedValue({ ok: true, data: {} });
    setup(resolved(5, 1));
    open();
    await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: T.start })));
    expect(apiMock.mock.calls[0][1].body).toEqual({ templateId: "tpl_standard" });
  });

  it("goes to the existing one when somebody else just started it (409)", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "postmortem_exists", message: "x" });
    setup(resolved(4, 1));
    open();
    await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: T.start })));
    expect(push).toHaveBeenCalledWith("/app/acme/incidents/5/postmortem");
    expect(screen.getByText(T.toasts.alreadyExists)).toBeInTheDocument();
  });

  it("stays put and says so when starting fails, and can be tried again", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup(resolved(4, 1));
    open();
    await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: T.start })));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(getCopy("professional").errors.generic)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: T.start })).toBeEnabled();
  });

  it("disables the button while starting, and cancels with the button or Escape", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (finish = r)));
    setup(resolved(4, 1));
    open();
    await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name: T.start })));
    expect(within(dialog()).getByRole("button", { name: T.starting })).toBeDisabled();
    await act(async () => finish({ ok: true, data: {} }));
    cleanup();

    setup(resolved(4, 1));
    open();
    fireEvent.click(within(dialog()).getByRole("button", { name: T.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    act(() => void dialog().dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
