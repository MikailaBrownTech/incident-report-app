// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import type { IncidentDetailView, PersonView } from "@/features/incidents/schema";
import { polyfillDialog } from "@/test/dialog-polyfill";
import { IncidentDetail } from "./incident-detail";

const apiMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
vi.mock("@/components/incident-timeline", () => ({
  IncidentTimeline: (p: {
    number: number;
    currentUserId: string;
    isAdmin: boolean;
    refreshSignal?: number;
    initialFilter: string;
    initialOrder: string;
  }) => (
    <div
      data-testid="timeline-stub"
      data-number={p.number}
      data-user={p.currentUserId}
      data-admin={String(p.isAdmin)}
      data-signal={p.refreshSignal}
      data-filter={p.initialFilter}
      data-order={p.initialOrder}
    />
  ),
}));
vi.mock("@/components/postmortem-panel", () => ({
  PostmortemPanel: () => <div data-testid="postmortem-panel-stub" />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const members: PersonView[] = [
  { userId: "u1", name: "Ada Lovelace", email: "ada@x.test", image: null },
  { userId: "u2", name: "", email: "grace@x.test", image: null },
];
const services = [
  { id: "s1", name: "API" },
  { id: "s2", name: "Search" },
];
const base = (over: Partial<IncidentDetailView> = {}): IncidentDetailView => ({
  id: "inc1",
  number: 5,
  title: "Checkout is down",
  summary: "Users see **errors**",
  severity: 3,
  status: "INVESTIGATING",
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  resolvedAt: null,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  createdBy: { name: "Owen Owner", email: "owen@x.test" },
  services: [{ id: "s1", name: "API" }],
  roles: { COMMANDER: null, SCRIBE: null, COMMS: null },
  ...over,
});
/** What the server would answer with after a successful change. */
const ok = (incident: IncidentDetailView) => ({ ok: true, data: { incident, changed: true } });
const fail = (code = "internal_error") => ({ ok: false, status: 500, code, message: "x" });

beforeAll(polyfillDialog);
beforeEach(() => {
  apiMock.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

function setup(
  incident = base(),
  opts: { canDelete?: boolean; skin?: SkinKey; severityLabels?: Record<string, string> | null } = {},
) {
  return render(
    <CopyProvider skin={opts.skin ?? "professional"}>
      <ToastProvider>
        <IncidentDetail
          slug="acme"
          initial={incident}
          members={members}
          services={services}
          severityLabels={opts.severityLabels ?? null}
          canDelete={opts.canDelete ?? false}
          currentUserId="u-me"
          timeline={{
            page: { items: [], nextCursor: null, people: {}, asOf: new Date().toISOString() },
            filter: "all",
            order: "asc",
          }}
          postmortem={{ status: null, rules: [], templates: [] }}
          rituals={{ done: 0, total: 0, overdue: 0 }}
        />
      </ToastProvider>
    </CopyProvider>,
  );
}
const t = getCopy("professional");
const d = t.incidentDetail;
const panel = () => within(screen.getByRole("complementary"));
const BASE_URL = "/api/w/acme/incidents/5";

describe("rendering", () => {
  it("shows number, title, severity, status, markdown summary, properties and the timeline placeholder", () => {
    setup();
    expect(screen.getByText("INC-5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Checkout is down");
    expect(screen.getByText("errors").tagName).toBe("STRONG"); // markdown rendered
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("INVESTIGATING");
    expect(panel().getByLabelText(d.severityLabel)).toHaveValue("3");
    expect(panel().getByText("Owen Owner")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-number", "5"); // the real timeline replaced the placeholder
    expect(screen.queryByTestId("resolved-at")).toBeNull(); // only shown once resolved
    expect(screen.queryByRole("button", { name: d.reopen })).toBeNull();
    expect(screen.queryByRole("button", { name: d.deleteIncident })).toBeNull(); // members can't delete
  });

  it("asks for a commander until there is one", () => {
    setup();
    expect(screen.getByRole("note")).toHaveTextContent(d.assignCommanderTitle);
    cleanup();
    setup(base({ roles: { COMMANDER: members[0], SCRIBE: null, COMMS: null } }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(panel().getByLabelText(t.incidentRole.COMMANDER)).toHaveValue("u1");
  });

  it("shows resolved time and a Reopen action for a resolved incident", () => {
    setup(base({ status: "RESOLVED", resolvedAt: new Date(Date.now() - 1_800_000).toISOString() }));
    expect(screen.getByTestId("resolved-at")).toHaveTextContent("30 minutes ago");
    expect(screen.getByRole("button", { name: d.reopen })).toBeInTheDocument();
  });

  it("uses workspace severity names and falls back to the email for nameless members", () => {
    setup(base(), { severityLabels: { "5": "Sev One" } });
    expect(
      within(panel().getByLabelText(d.severityLabel)).getByRole("option", { name: "5 Sev One" }),
    ).toBeInTheDocument();
    const commander = panel().getByLabelText(t.incidentRole.COMMANDER);
    expect(within(commander).getByRole("option", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(within(commander).getByRole("option", { name: "grace@x.test" })).toBeInTheDocument();
    expect(within(commander).getByRole("option", { name: d.unassigned })).toBeInTheDocument();
  });

  it("speaks the haunted skin's language without changing structure", () => {
    const h = getCopy("haunted");
    setup(base(), { skin: "haunted" });
    expect(screen.getByText("Haunting #5")).toBeInTheDocument();
    expect(panel().getByLabelText(h.incidentDetail.statusLabel)).toBeInTheDocument();
    expect(
      within(panel().getByLabelText(h.incidentDetail.statusLabel)).getByRole("option", { name: "Laid to Rest" }),
    ).toBeInTheDocument();
    expect(panel().getByLabelText(h.incidentRole.COMMANDER)).toBeInTheDocument(); // "Exorcist"
    expect(screen.getByRole("note")).toHaveTextContent("Assign an Exorcist");
    expect(screen.getByTestId("timeline-stub")).toBeInTheDocument();
  });

  it("renders summary markdown safely", () => {
    setup(base({ summary: "<script>window.x=1</script>\n\n[bad](javascript:alert(1)) ok" }));
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(screen.getByText(/ok/)).toBeInTheDocument();
  });
});

describe("timeline hookup", () => {
  it("gives the timeline the incident, the viewer and their rights", () => {
    setup(base(), { canDelete: true });
    const stub = screen.getByTestId("timeline-stub");
    expect(stub).toHaveAttribute("data-user", "u-me");
    expect(stub).toHaveAttribute("data-admin", "true");
    expect(stub).toHaveAttribute("data-filter", "all");
    expect(stub).toHaveAttribute("data-order", "asc");
    cleanup();
    setup(base(), { canDelete: false });
    expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-admin", "false");
  });

  it("asks it to refresh after each saved change, but not after a failed one", async () => {
    apiMock.mockResolvedValueOnce(ok(base({ severity: 5 }))).mockResolvedValueOnce(fail());
    setup();
    const signal = () => screen.getByTestId("timeline-stub").getAttribute("data-signal");
    expect(signal()).toBe("0");
    await act(async () => fireEvent.change(panel().getByLabelText(d.severityLabel), { target: { value: "5" } }));
    expect(signal()).toBe("1");
    await act(async () => fireEvent.change(panel().getByLabelText(d.severityLabel), { target: { value: "1" } }));
    expect(signal()).toBe("1"); // the failed save produced no entry
  });
});

describe("title", () => {
  const edit = () => fireEvent.click(screen.getByRole("button", { name: d.editTitle }));
  const input = () => screen.getByLabelText(d.titleLabel) as HTMLInputElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: d.save }));

  it("edits inline, shows the new title immediately and PATCHes it", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (finish = r)));
    setup();
    edit();
    expect(input().value).toBe("Checkout is down");
    fireEvent.change(input(), { target: { value: "  Checkout fully down  " } });
    await act(async () => save());
    expect(screen.getByTestId("incident-title")).toHaveTextContent("Checkout fully down"); // before the server answers
    expect(apiMock).toHaveBeenCalledWith(BASE_URL, { method: "PATCH", body: { title: "Checkout fully down" } });
    await act(async () => finish(ok(base({ title: "Checkout fully down" }))));
    expect(screen.getByTestId("incident-title")).toHaveTextContent("Checkout fully down");
  });

  it("submits with Enter and cancels with Escape", async () => {
    apiMock.mockResolvedValue(ok(base({ title: "Via enter" })));
    setup();
    edit();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByLabelText(d.titleLabel)).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();

    edit();
    fireEvent.change(input(), { target: { value: "Via enter" } });
    await act(async () => fireEvent.submit(input().closest("form")!));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("validates before saving: not blank, at most 140 characters", () => {
    setup();
    edit();
    fireEvent.change(input(), { target: { value: "   " } });
    save();
    expect(screen.getByText(t.validation.required)).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "x".repeat(141) } });
    save();
    expect(screen.getByText(t.validation.tooLong(140))).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
    expect(input()).toHaveAttribute("aria-invalid", "true");
  });

  it("doesn't call the API when nothing changed", () => {
    setup();
    edit();
    save();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("puts the old title back and says so if the save fails", async () => {
    apiMock.mockResolvedValue(fail());
    setup();
    edit();
    fireEvent.change(input(), { target: { value: "Doomed edit" } });
    await act(async () => save());
    expect(screen.getByTestId("incident-title")).toHaveTextContent("Checkout is down");
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);
  });
});

describe("summary", () => {
  it("edits as markdown text, saves, and renders the result", async () => {
    apiMock.mockResolvedValue(ok(base({ summary: "# Root cause\n\nA *bad* deploy" })));
    setup(base({ summary: "" }));
    expect(screen.getByText(d.noSummary)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: d.addSummary }));
    const box = screen.getByLabelText(d.summaryLabel, { selector: "textarea" });
    expect(screen.getByText(d.markdownHint)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "# Root cause\n\nA *bad* deploy" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: d.save })));
    expect(apiMock).toHaveBeenCalledWith(BASE_URL, {
      method: "PATCH",
      body: { summary: "# Root cause\n\nA *bad* deploy" },
    });
    expect(screen.getByText("bad").tagName).toBe("EM");
    expect(screen.getByText("Root cause").tagName).toBe("H3"); // demoted: the page keeps one h1
  });

  it("cancels with the button or Escape, and rolls back on failure", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: d.editSummary }));
    fireEvent.change(screen.getByLabelText(d.summaryLabel, { selector: "textarea" }), { target: { value: "unsaved" } });
    fireEvent.keyDown(screen.getByLabelText(d.summaryLabel, { selector: "textarea" }), { key: "Escape" });
    expect(screen.queryByLabelText(d.summaryLabel, { selector: "textarea" })).toBeNull();
    expect(screen.getByText("errors")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockResolvedValue(fail());
    fireEvent.click(screen.getByRole("button", { name: d.editSummary }));
    fireEvent.change(screen.getByLabelText(d.summaryLabel, { selector: "textarea" }), {
      target: { value: "will fail" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: d.save })));
    expect(screen.getByText("errors")).toBeInTheDocument(); // original restored
    expect(screen.queryByText("will fail")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);
  });

  it("rejects an over-long summary without calling the API", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: d.editSummary }));
    fireEvent.change(screen.getByLabelText(d.summaryLabel, { selector: "textarea" }), {
      target: { value: "x".repeat(20_001) },
    });
    fireEvent.click(screen.getByRole("button", { name: d.save }));
    expect(screen.getByText(t.validation.tooLong(20000))).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  const pick = async (status: string) => {
    await act(async () => fireEvent.change(panel().getByLabelText(d.statusLabel), { target: { value: status } }));
  };

  it("resolving shows the resolved time immediately and posts the status", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (finish = r)));
    setup();
    await pick("RESOLVED");
    expect(apiMock).toHaveBeenCalledWith(`${BASE_URL}/status`, { method: "POST", body: { status: "RESOLVED" } });
    expect(screen.getByTestId("resolved-at")).toBeInTheDocument(); // optimistic
    expect(screen.getByRole("button", { name: d.reopen })).toBeInTheDocument();
    const stamp = new Date().toISOString();
    await act(async () => finish(ok(base({ status: "RESOLVED", resolvedAt: stamp }))));
    expect(screen.getByTestId("resolved-at")).toHaveTextContent("now");
  });

  it("reopening clears the resolved time; resolving again sets it again", async () => {
    apiMock.mockImplementation(async (_url: string, init: { body: { status: string } }) =>
      ok(
        base({
          status: init.body.status as never,
          resolvedAt: init.body.status === "RESOLVED" ? new Date().toISOString() : null,
        }),
      ),
    );
    setup(base({ status: "RESOLVED", resolvedAt: new Date(Date.now() - 600_000).toISOString() }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: d.reopen })));
    expect(apiMock).toHaveBeenLastCalledWith(`${BASE_URL}/status`, {
      method: "POST",
      body: { status: "INVESTIGATING" },
    });
    expect(screen.queryByTestId("resolved-at")).toBeNull();
    expect(screen.queryByRole("button", { name: d.reopen })).toBeNull();
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("INVESTIGATING");

    await pick("RESOLVED");
    expect(screen.getByTestId("resolved-at")).toBeInTheDocument();
  });

  it("moving between open statuses never shows a resolved time", async () => {
    apiMock.mockImplementation(async (_u: string, init: { body: { status: string } }) =>
      ok(base({ status: init.body.status as never })),
    );
    setup();
    for (const s of ["IDENTIFIED", "MITIGATING", "INVESTIGATING"]) {
      await pick(s);
      expect(screen.queryByTestId("resolved-at")).toBeNull();
    }
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it("choosing the current status does nothing", async () => {
    setup();
    await pick("INVESTIGATING");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("rolls back status and resolved time when the save fails", async () => {
    apiMock.mockResolvedValue(fail());
    setup();
    await pick("RESOLVED");
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("INVESTIGATING");
    expect(screen.queryByTestId("resolved-at")).toBeNull();
    expect(screen.queryByRole("button", { name: d.reopen })).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);

    // and a failed reopen restores the original resolved time
    cleanup();
    const stamp = new Date(Date.now() - 600_000).toISOString();
    setup(base({ status: "RESOLVED", resolvedAt: stamp }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: d.reopen })));
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("RESOLVED");
    expect(screen.getByTestId("resolved-at")).toHaveTextContent("10 minutes ago");
  });
});

describe("severity", () => {
  it("saves immediately and rolls back on failure", async () => {
    apiMock.mockResolvedValueOnce(ok(base({ severity: 5 }))).mockResolvedValueOnce(fail());
    setup();
    const select = () => panel().getByLabelText(d.severityLabel);
    await act(async () => fireEvent.change(select(), { target: { value: "5" } }));
    expect(apiMock).toHaveBeenCalledWith(BASE_URL, { method: "PATCH", body: { severity: 5 } });
    expect(select()).toHaveValue("5");
    expect(screen.getAllByText(t.severity[5]).length).toBeGreaterThan(0); // badge follows

    await act(async () => fireEvent.change(select(), { target: { value: "1" } }));
    expect(select()).toHaveValue("5"); // reverted
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);
  });
});

describe("roles", () => {
  const role = (r: "COMMANDER" | "SCRIBE" | "COMMS") => panel().getByLabelText(t.incidentRole[r]);

  it("assigns and unassigns, and the commander prompt follows", async () => {
    apiMock.mockImplementation(async (_u: string, init: { body: Record<string, string | null> }) =>
      ok(base({ roles: { COMMANDER: init.body.COMMANDER ? members[0] : null, SCRIBE: null, COMMS: null } })),
    );
    setup();
    await act(async () => fireEvent.change(role("COMMANDER"), { target: { value: "u1" } }));
    expect(apiMock).toHaveBeenCalledWith(`${BASE_URL}/roles`, { method: "PUT", body: { COMMANDER: "u1" } });
    expect(role("COMMANDER")).toHaveValue("u1");
    expect(screen.queryByRole("note")).toBeNull();

    await act(async () => fireEvent.change(role("COMMANDER"), { target: { value: "" } }));
    expect(apiMock).toHaveBeenLastCalledWith(`${BASE_URL}/roles`, { method: "PUT", body: { COMMANDER: null } });
    expect(role("COMMANDER")).toHaveValue("");
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("each role saves on its own and ignores no-op changes", async () => {
    const held: Record<string, (typeof members)[number] | null> = { COMMANDER: null, SCRIBE: null, COMMS: null };
    apiMock.mockImplementation(async (_u: string, init: { body: Record<string, string | null> }) => {
      for (const [r, id] of Object.entries(init.body))
        held[r] = id ? (members.find((m) => m.userId === id) ?? null) : null;
      return ok(base({ roles: { ...held } as never }));
    });
    setup();
    await act(async () => fireEvent.change(role("SCRIBE"), { target: { value: "u2" } }));
    await act(async () => fireEvent.change(role("COMMS"), { target: { value: "u1" } }));
    expect(apiMock.mock.calls.map((c) => c[1].body)).toEqual([{ SCRIBE: "u2" }, { COMMS: "u1" }]);
    await act(async () => fireEvent.change(role("SCRIBE"), { target: { value: "u2" } }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("restores the previous holder when assignment fails", async () => {
    apiMock.mockResolvedValue(fail("not_a_member"));
    setup(base({ roles: { COMMANDER: members[0], SCRIBE: null, COMMS: null } }));
    await act(async () => fireEvent.change(role("COMMANDER"), { target: { value: "u2" } }));
    expect(role("COMMANDER")).toHaveValue("u1");
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);
  });
});

describe("services", () => {
  it("adds and removes services with the picker, saving each change", async () => {
    apiMock.mockImplementation(async (_u: string, init: { body: { serviceIds: string[] } }) =>
      ok(base({ services: init.body.serviceIds.map((id) => services.find((x) => x.id === id)!) })),
    );
    setup();
    const combo = panel().getByRole("combobox", { name: t.declare.servicesLabel });
    fireEvent.focus(combo);
    await act(async () => fireEvent.mouseDown(screen.getByRole("option", { name: "Search" })));
    expect(apiMock).toHaveBeenLastCalledWith(BASE_URL, { method: "PATCH", body: { serviceIds: ["s1", "s2"] } });
    expect(panel().getByRole("button", { name: t.declare.removeService("Search") })).toBeInTheDocument();

    await act(async () => fireEvent.click(panel().getByRole("button", { name: t.declare.removeService("API") })));
    expect(apiMock).toHaveBeenLastCalledWith(BASE_URL, { method: "PATCH", body: { serviceIds: ["s2"] } });
    expect(panel().queryByRole("button", { name: t.declare.removeService("API") })).toBeNull();
  });

  it("puts the services back if the save fails, and never offers to create new ones here", async () => {
    apiMock.mockResolvedValue(fail());
    setup();
    await act(async () => fireEvent.click(panel().getByRole("button", { name: t.declare.removeService("API") })));
    expect(panel().getByRole("button", { name: t.declare.removeService("API") })).toBeInTheDocument();
    const combo = panel().getByRole("combobox", { name: t.declare.servicesLabel });
    fireEvent.change(combo, { target: { value: "Brand new" } });
    expect(screen.queryByRole("option", { name: t.declare.createService("Brand new") })).toBeNull();
  });
});

describe("overlapping edits", () => {
  it("a failure undoes only its own change, not edits that are still in flight", async () => {
    const pending: ((v: unknown) => void)[] = [];
    apiMock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    setup();
    // two edits start before either answers
    await act(async () => fireEvent.change(panel().getByLabelText(d.severityLabel), { target: { value: "5" } }));
    await act(async () => fireEvent.change(panel().getByLabelText(d.statusLabel), { target: { value: "MITIGATING" } }));
    expect(panel().getByLabelText(d.severityLabel)).toHaveValue("5");
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("MITIGATING");

    await act(async () => pending[0](fail())); // severity is refused
    expect(panel().getByLabelText(d.severityLabel)).toHaveValue("3"); // only severity is undone
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("MITIGATING");

    await act(async () => pending[1](ok(base({ status: "MITIGATING" }))));
    expect(panel().getByLabelText(d.statusLabel)).toHaveValue("MITIGATING");
    expect(panel().getByLabelText(d.severityLabel)).toHaveValue("3");
  });
});

describe("deleting", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: d.deleteIncident }));

  it("is offered only to admins, behind a confirmation that names the incident", () => {
    setup(base(), { canDelete: true });
    open();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: d.deleteConfirmTitle("INC-5") })).toBeInTheDocument();
    expect(dialog.getByText(d.deleteConfirmBody)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: t.actions.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("deletes after confirming, then returns to the list", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { deleted: true } });
    setup(base(), { canDelete: true });
    open();
    await act(async () =>
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: d.deleteIncident })),
    );
    expect(apiMock).toHaveBeenCalledWith(BASE_URL, { method: "DELETE" });
    expect(nav.push).toHaveBeenCalledWith("/app/acme/incidents");
    expect(await screen.findByText(d.deleted)).toBeInTheDocument();
  });

  it("stays on the page with an error if the delete fails", async () => {
    apiMock.mockResolvedValue(fail("forbidden"));
    setup(base(), { canDelete: true });
    open();
    await act(async () =>
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: d.deleteIncident })),
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(d.saveFailed);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
