// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { getCopy } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { DeclareIncidentButton, DeclareIncidentProvider } from "./declare-incident";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));

const t = getCopy("professional");
const services = [
  { id: "s1", name: "API" },
  { id: "s2", name: "Checkout" },
  { id: "s3", name: "Search" },
];

beforeAll(() => {
  // jsdom doesn't implement <dialog> modality; mirror the open attribute the browser would set.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  apiMock.mockReset();
  Object.values(nav).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

function setup(opts: { canCreateServices?: boolean } = {}) {
  return render(
    <CopyProvider skin="professional">
      <ToastProvider>
        <DeclareIncidentProvider
          slug="acme"
          services={services}
          canCreateServices={opts.canCreateServices ?? false}
          severityLabels={{ "4": "Sev Four" }}
        >
          <DeclareIncidentButton />
          <input aria-label="elsewhere" />
        </DeclareIncidentProvider>
      </ToastProvider>
    </CopyProvider>,
  );
}

const dialogOpen = () => screen.queryByRole("dialog", { name: t.declare.dialogTitle });
const pressC = (target: Element | Window = window, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: "c", bubbles: true, ...init });

describe("opening the dialog", () => {
  it("opens from the button", () => {
    setup();
    expect(dialogOpen()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.declare.button) }));
    expect(dialogOpen()).toBeInTheDocument();
  });

  it("opens with the c key", () => {
    setup();
    pressC();
    expect(dialogOpen()).toBeInTheDocument();
  });

  it("ignores c while typing, with modifiers, or when another dialog is open", () => {
    setup();
    pressC(screen.getByLabelText("elsewhere"));
    expect(dialogOpen()).toBeNull();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
      pressC(window, init);
      expect(dialogOpen()).toBeNull();
    }
    pressC(window, { key: "x" });
    expect(dialogOpen()).toBeNull();

    pressC();
    expect(dialogOpen()).toBeInTheDocument();
    // already open: another c must not do anything odd (typing a "c" in the title field, for one)
    pressC(screen.getByLabelText(t.declare.titleLabel));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes on Cancel and starts clean the next time", () => {
    setup();
    pressC();
    fireEvent.change(screen.getByLabelText(t.declare.titleLabel), { target: { value: "stale" } });
    fireEvent.click(screen.getByRole("button", { name: t.actions.cancel }));
    expect(dialogOpen()).toBeNull();
    pressC();
    expect(screen.getByLabelText(t.declare.titleLabel)).toHaveValue("");
  });
});

describe("the form", () => {
  const open = (opts?: Parameters<typeof setup>[0]) => {
    setup(opts);
    pressC();
    return within(dialogOpen()!);
  };
  const inDialog = () => within(dialogOpen()!);
  const submit = () => fireEvent.click(inDialog().getByRole("button", { name: t.declare.submit }));

  it("defaults: severity 3, Investigating, start time now, labels from the dictionary and overrides", () => {
    const d = open();
    expect(d.getByLabelText(new RegExp(`^3\\s*${t.severity[3]}`))).toBeChecked();
    expect(d.getByLabelText(t.declare.statusLabel)).toHaveValue("INVESTIGATING");
    expect(d.getByLabelText(new RegExp(`4\\s*Sev Four`))).toBeInTheDocument(); // workspace override
    const started = (d.getByLabelText(t.declare.startedAtLabel) as HTMLInputElement).value;
    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Math.abs(new Date(started).getTime() - Date.now())).toBeLessThan(120_000);
    // only the three open statuses are offered
    expect(within(d.getByLabelText(t.declare.statusLabel)).getAllByRole("option")).toHaveLength(3);
  });

  it("requires a title, and does not call the API", () => {
    open();
    submit();
    expect(screen.getByText(t.validation.required)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t.declare.titleLabel), { target: { value: "x".repeat(141) } });
    submit();
    expect(screen.getByText(t.validation.tooLong(140))).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("rejects a start time in the future", () => {
    open();
    fireEvent.change(screen.getByLabelText(t.declare.titleLabel), { target: { value: "Down" } });
    const tomorrow = new Date(Date.now() + 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(screen.getByLabelText(t.declare.startedAtLabel), {
      target: { value: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T10:00` },
    });
    submit();
    expect(screen.getAllByText(t.declare.startedInFuture).length).toBeGreaterThan(0);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("submits the right payload and goes to the new incident", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { incident: { number: 7 } } });
    const d = open();
    fireEvent.change(d.getByLabelText(t.declare.titleLabel), { target: { value: "  Checkout is down  " } });
    fireEvent.change(d.getByLabelText(t.declare.summaryLabel), { target: { value: "500s everywhere" } });
    fireEvent.click(d.getByLabelText(new RegExp(`5\\s*${t.severity[5]}`)));
    fireEvent.change(d.getByLabelText(t.declare.statusLabel), { target: { value: "IDENTIFIED" } });
    fireEvent.change(d.getByLabelText(t.declare.startedAtLabel), { target: { value: "2026-01-02T03:04" } });

    const combo = d.getByRole("combobox", { name: t.declare.servicesLabel });
    fireEvent.focus(combo);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Checkout" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "API" }));

    await act(async () => submit());

    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiMock.mock.calls[0];
    expect(path).toBe("/api/w/acme/incidents");
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({
      title: "Checkout is down",
      summary: "500s everywhere",
      severity: 5,
      serviceIds: ["s2", "s1"],
      newServiceNames: [],
      startedAt: new Date(2026, 0, 2, 3, 4).toISOString(),
      status: "IDENTIFIED",
    });
    expect(nav.push).toHaveBeenCalledWith("/app/acme/incidents/7");
    expect(nav.refresh).not.toHaveBeenCalled(); // no new services, so the shell's list is unchanged
    expect(await screen.findByText(t.declare.created(t.incident.number(7)))).toBeInTheDocument();
    expect(dialogOpen()).toBeNull();
  });

  it("disables the buttons while submitting", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    open();
    fireEvent.change(screen.getByLabelText(t.declare.titleLabel), { target: { value: "Down" } });
    await act(async () => submit());
    expect(inDialog().getByRole("button", { name: t.declare.submitting })).toBeDisabled();
    expect(inDialog().getByRole("button", { name: t.actions.cancel })).toBeDisabled();
    await act(async () => finish({ ok: true, data: { incident: { number: 1 } } }));
  });

  it("shows server field errors inline and stays open", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 400, code: "validation_error", message: "", fieldErrors: { title: ["too_long"] } });
    open();
    fireEvent.change(screen.getByLabelText(t.declare.titleLabel), { target: { value: "Down" } });
    await act(async () => submit());
    expect(screen.getByText(t.validation.tooLong(140))).toBeInTheDocument();
    expect(dialogOpen()).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();

    apiMock.mockResolvedValue({ ok: false, status: 400, code: "invalid_service", message: "", fieldErrors: { serviceIds: ["invalid_service"] } });
    await act(async () => submit());
    expect(screen.getByText(t.declare.invalidService)).toBeInTheDocument();
  });

  it("lets admins create a service inline, and refreshes the shell's list after", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { incident: { number: 2 } } });
    const d = open({ canCreateServices: true });
    fireEvent.change(d.getByLabelText(t.declare.titleLabel), { target: { value: "Down" } });
    const combo = d.getByRole("combobox", { name: t.declare.servicesLabel });
    fireEvent.change(combo, { target: { value: "Billing" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: t.declare.createService("Billing") }));
    expect(screen.getByRole("button", { name: t.declare.removeService("Billing") })).toBeInTheDocument();

    await act(async () => submit());
    expect(apiMock.mock.calls[0][1].body).toMatchObject({ serviceIds: [], newServiceNames: ["Billing"] });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("does not offer service creation to non-admins", () => {
    const d = open({ canCreateServices: false });
    fireEvent.change(d.getByRole("combobox", { name: t.declare.servicesLabel }), { target: { value: "Billing" } });
    expect(screen.queryByRole("option", { name: t.declare.createService("Billing") })).toBeNull();
    expect(screen.getByText(t.declare.servicesNoMatch)).toBeInTheDocument();
  });
});

describe("the service combobox", () => {
  const openPicker = (opts?: Parameters<typeof setup>[0]) => {
    setup(opts);
    pressC();
    return screen.getByRole("combobox", { name: t.declare.servicesLabel });
  };

  it("filters as you type, case-insensitively", () => {
    const combo = openPicker();
    const names = () => within(screen.getByRole("listbox")).queryAllByRole("option").map((o) => o.textContent);
    fireEvent.change(combo, { target: { value: "CHECK" } });
    expect(names()).toEqual(["Checkout"]);
    fireEvent.change(combo, { target: { value: "ch" } }); // substring match: Checkout and Search
    expect(names()).toEqual(["Checkout", "Search"]);
    fireEvent.change(combo, { target: { value: "zzz" } });
    expect(names()).toEqual([]);
  });

  it("works from the keyboard: arrows move, Enter toggles, Backspace removes the last chip", () => {
    const combo = openPicker();
    fireEvent.focus(combo);
    fireEvent.keyDown(combo, { key: "ArrowDown" }); // API -> Checkout
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(screen.getByRole("button", { name: t.declare.removeService("Checkout") })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Checkout" })).toHaveAttribute("aria-selected", "true");
    expect(combo).toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(combo, { key: "Enter" }); // toggles it back off
    expect(screen.queryByRole("button", { name: t.declare.removeService("Checkout") })).toBeNull();

    fireEvent.keyDown(combo, { key: "Enter" });
    fireEvent.keyDown(combo, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: t.declare.removeService("Checkout") })).toBeNull();
  });

  it("Enter never submits the form, and Escape closes the list but not the dialog", () => {
    const combo = openPicker();
    fireEvent.focus(combo);
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dialogOpen()).toBeInTheDocument();
  });

  it("removes a chip with its × button", () => {
    const combo = openPicker();
    fireEvent.focus(combo);
    fireEvent.mouseDown(screen.getByRole("option", { name: "API" }));
    fireEvent.click(screen.getByRole("button", { name: t.declare.removeService("API") }));
    expect(screen.queryByRole("button", { name: t.declare.removeService("API") })).toBeNull();
  });

  it("won't offer to create a name that already exists (any case) or is already queued", () => {
    const combo = openPicker({ canCreateServices: true });
    fireEvent.change(combo, { target: { value: "api" } });
    expect(screen.queryByRole("option", { name: t.declare.createService("api") })).toBeNull();
    fireEvent.change(combo, { target: { value: "Billing" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: t.declare.createService("Billing") }));
    fireEvent.change(combo, { target: { value: "billing" } });
    expect(screen.queryByRole("option", { name: t.declare.createService("billing") })).toBeNull();
  });
});
