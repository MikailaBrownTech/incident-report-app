// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
import { getCopy } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import type { ServiceView } from "@/features/services/schema";
import { polyfillDialog } from "@/test/dialog-polyfill";
import { ServicesManager } from "./services-manager";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));

const t = getCopy("professional");
const svc = (name: string, over: Partial<ServiceView> = {}): ServiceView => ({
  id: `id-${name}`,
  name,
  slug: name.toLowerCase(),
  createdAt: "2026-02-03T10:00:00.000Z",
  openIncidents: 0,
  totalIncidents: 0,
  ...over,
});

beforeAll(polyfillDialog);
beforeEach(() => {
  apiMock.mockReset();
  nav.refresh.mockReset();
});
afterEach(cleanup);

function setup(services: ServiceView[], canManage = true) {
  return render(
    <CopyProvider skin="professional">
      <ToastProvider>
        <ServicesManager slug="acme" services={services} canManage={canManage} />
      </ToastProvider>
    </CopyProvider>,
  );
}

describe("the table", () => {
  it("shows name, slug, open-incident count and created date", () => {
    setup([svc("Payments", { slug: "payments-2", openIncidents: 3, totalIncidents: 9 })]);
    const row = screen.getByTestId("service-payments-2");
    expect(within(row).getByText("Payments")).toBeInTheDocument();
    expect(within(row).getByText("payments-2")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("Feb 3, 2026")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    setup([]);
    expect(screen.getByText(t.services.empty)).toBeInTheDocument();
  });

  it("is read-only for members: no form, no row actions, and says why", () => {
    setup([svc("API")], false);
    expect(screen.queryByLabelText(t.services.nameLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: t.services.rename })).toBeNull();
    expect(screen.queryByRole("button", { name: t.services.delete })).toBeNull();
    expect(screen.queryByText(t.services.colActions)).toBeNull();
    expect(screen.getByText(t.services.readOnlyNote)).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
  });
});

describe("adding", () => {
  const add = () => fireEvent.click(screen.getByRole("button", { name: t.services.add }));

  it("validates the name before calling the API", () => {
    setup([]);
    add();
    expect(screen.getByText(t.validation.required)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t.services.nameLabel), { target: { value: "x".repeat(61) } });
    add();
    expect(screen.getByText(t.validation.tooLong(60))).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("posts the trimmed name, then clears the field, toasts and refreshes", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { service: { id: "n", name: "Billing", slug: "billing" } } });
    setup([]);
    const input = screen.getByLabelText(t.services.nameLabel) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Billing  " } });
    await act(async () => add());
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/services", { method: "POST", body: { name: "Billing" } });
    expect(input.value).toBe("");
    expect(nav.refresh).toHaveBeenCalled();
    expect(await screen.findByText(t.services.created)).toBeInTheDocument();
  });

  it("shows a duplicate name inline instead of a toast", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "name_taken", message: "" });
    setup([svc("API")]);
    fireEvent.change(screen.getByLabelText(t.services.nameLabel), { target: { value: "api" } });
    await act(async () => add());
    expect(screen.getByText(t.services.nameTaken)).toBeInTheDocument();
    expect(screen.getByLabelText(t.services.nameLabel)).toHaveAttribute("aria-invalid", "true");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("disables the button while saving", async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup([]);
    fireEvent.change(screen.getByLabelText(t.services.nameLabel), { target: { value: "Slow" } });
    await act(async () => add());
    expect(screen.getByRole("button", { name: t.services.adding })).toBeDisabled();
    await act(async () => finish({ ok: true, data: {} }));
  });
});

describe("renaming", () => {
  it("opens prefilled, saves the new name, and refreshes", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { service: { id: "id-API", name: "API v2" } } });
    setup([svc("API")]);
    fireEvent.click(screen.getByRole("button", { name: t.services.rename }));
    const dialog = within(screen.getByRole("dialog"));
    const input = dialog.getByLabelText(t.services.nameLabel) as HTMLInputElement;
    expect(input.value).toBe("API");
    fireEvent.change(input, { target: { value: "API v2" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: t.services.save })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/services/id-API", { method: "PATCH", body: { name: "API v2" } });
    expect(nav.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports a taken name inside the dialog and stays open", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "name_taken", message: "" });
    setup([svc("API"), svc("Web")]);
    fireEvent.click(screen.getAllByRole("button", { name: t.services.rename })[0]);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(t.services.nameLabel), { target: { value: "Web" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: t.services.save })));
    expect(dialog.getByText(t.services.nameTaken)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("starts from the current name each time and cancel changes nothing", () => {
    setup([svc("API")]);
    fireEvent.click(screen.getByRole("button", { name: t.services.rename }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(t.services.nameLabel), { target: { value: "Edited" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t.actions.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.services.rename }));
    expect((within(screen.getByRole("dialog")).getByLabelText(t.services.nameLabel) as HTMLInputElement).value).toBe("API");
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("deleting", () => {
  const openDelete = (s: ServiceView) => {
    setup([s]);
    fireEvent.click(screen.getByRole("button", { name: t.services.delete }));
    return within(screen.getByRole("dialog"));
  };

  it("tells you how many incidents are linked (singular and plural) and asks to confirm", () => {
    let dialog = openDelete(svc("API", { totalIncidents: 1 }));
    expect(dialog.getByRole("heading", { name: t.services.deleteConfirmTitle("API") })).toBeInTheDocument();
    expect(dialog.getByText(t.services.deleteConfirmLinked(1))).toHaveTextContent("1 incident is linked");
    cleanup();
    dialog = openDelete(svc("API", { totalIncidents: 12 }));
    expect(dialog.getByText(t.services.deleteConfirmLinked(12))).toHaveTextContent("12 incidents are linked");
    expect(apiMock).not.toHaveBeenCalled(); // nothing happens until confirmed
  });

  it("says so plainly when no incidents are linked", () => {
    const dialog = openDelete(svc("Idle"));
    expect(dialog.getByText(t.services.deleteConfirmNone)).toBeInTheDocument();
  });

  it("cancelling deletes nothing", () => {
    const dialog = openDelete(svc("API", { totalIncidents: 2 }));
    fireEvent.click(dialog.getByRole("button", { name: t.actions.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("confirming deletes, reports how many incidents were unlinked, and refreshes", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { deleted: true, unlinkedIncidents: 2 } });
    const dialog = openDelete(svc("API", { totalIncidents: 2 }));
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: t.services.delete })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/services/id-API", { method: "DELETE" });
    expect(nav.refresh).toHaveBeenCalled();
    expect(await screen.findByText(t.services.deleted(2))).toHaveTextContent("unlinked from 2 incidents");
  });

  it("shows an error toast when the delete fails", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 403, code: "forbidden", message: "" });
    const dialog = openDelete(svc("API"));
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: t.services.delete })));
    expect(await screen.findByRole("alert")).toHaveTextContent(t.members.roleNotAllowed);
  });
});
