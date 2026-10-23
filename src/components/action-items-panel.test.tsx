// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionItemsPanel } from "@/components/action-items-panel";
import { IncidentRitualsCard } from "@/components/incident-rituals-card";
import { ToastProvider } from "@/components/toast";
import { getCopy } from "@/copy";
import type { PersonView } from "@/features/incidents/schema";
import { CopyProvider } from "@/copy/provider";
import type { ActionItemView } from "@/features/action-items/schema";
import { addDays, localDay } from "@/features/action-items/state";
import { polyfillDialog } from "@/test/dialog-polyfill";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));
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

beforeAll(polyfillDialog);
beforeEach(() => {
  n = 0;
  apiMock.mockReset();
});
afterEach(cleanup);

function Harness({ start, me = "me", admin = false }: { start: ActionItemView[]; me?: string; admin?: boolean }) {
  const [items, setItems] = useState(start);
  const [ppl, setPeople] = useState<Record<string, PersonView>>(people);
  return (
    <ActionItemsPanel
      slug="acme"
      incidentNumber={12}
      items={items}
      people={ppl}
      members={Object.values(people)}
      currentUserId={me}
      isAdmin={admin}
      onItems={setItems}
      onPeople={(p) => setPeople((cur) => ({ ...cur, ...p }))}
    />
  );
}
const setup = (start: ActionItemView[], o: { me?: string; admin?: boolean } = {}) =>
  render(
    <CopyProvider skin="professional">
      <ToastProvider>
        <Harness start={start} {...o} />
      </ToastProvider>
    </CopyProvider>,
  );
const row = (i: ActionItemView) => screen.getByTestId(`panel-item-${i.id}`);

describe("the list", () => {
  it("says there are none yet, without inventing any", () => {
    setup([]);
    expect(screen.getByText(R.editor.none)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows each item's title, owner, due date state and status", () => {
    const late = item({ title: "Item late", dueDate: addDays(TODAY, -2), ownerId: "other" });
    setup([late, item({ title: "Item done", status: "DONE" })]);
    expect(within(row(late)).getByText("Item late")).toBeInTheDocument();
    expect(within(row(late)).getByText("Omar Other")).toBeInTheDocument();
    expect(within(row(late)).getByText(R.daysLate(2))).toBeInTheDocument();
    expect(within(row(late)).getByLabelText(`${R.fields.status}: Item late`)).toHaveValue("OPEN");
  });

  it("disables the status control for someone else's item, with the reason", () => {
    const theirs = item({ title: "Item theirs", ownerId: "other" });
    setup([theirs]);
    const select = within(row(theirs)).getByLabelText(`${R.fields.status}: Item theirs`);
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("title", R.readOnlyHint);
    cleanup();
    setup([theirs], { admin: true });
    expect(within(row(theirs)).getByLabelText(`${R.fields.status}: Item theirs`)).toBeEnabled();
  });
});

describe("changing status", () => {
  it("updates at once and keeps the server's version", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockResolvedValue({ ok: true, data: { items: [{ ...a, status: "IN_PROGRESS" }], people } });
    setup([a]);
    await act(async () =>
      fireEvent.change(within(row(a)).getByLabelText(`${R.fields.status}: Item a`), {
        target: { value: "IN_PROGRESS" },
      }),
    );
    expect(apiMock).toHaveBeenCalledWith(`/api/w/acme/action-items/${a.id}`, {
      method: "PATCH",
      body: { status: "IN_PROGRESS" },
    });
    expect(within(row(a)).getByLabelText(`${R.fields.status}: Item a`)).toHaveValue("IN_PROGRESS");
  });

  it("puts it back and says so when the server refuses", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });
    setup([a]);
    await act(async () =>
      fireEvent.change(within(row(a)).getByLabelText(`${R.fields.status}: Item a`), { target: { value: "DONE" } }),
    );
    expect(within(row(a)).getByLabelText(`${R.fields.status}: Item a`)).toHaveValue("OPEN");
    expect(screen.getByRole("alert")).toHaveTextContent(R.toasts.saveFailed);
  });

  it("asks why before marking something won't do", async () => {
    const a = item({ title: "Item a" });
    apiMock.mockResolvedValue({
      ok: true,
      data: { items: [{ ...a, status: "WONT_DO", wontDoReason: "Out of scope" }], people },
    });
    setup([a]);
    fireEvent.change(within(row(a)).getByLabelText(`${R.fields.status}: Item a`), { target: { value: "WONT_DO" } });
    expect(apiMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: R.reasonTitle });
    fireEvent.change(within(dialog).getByLabelText(R.fields.reason), { target: { value: "Out of scope" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: R.reasonConfirm })));
    expect(apiMock.mock.calls[0][1].body).toEqual({ status: "WONT_DO", wontDoReason: "Out of scope" });
    expect(within(row(a)).getByText("Out of scope")).toBeInTheDocument();
  });
});

describe("adding an action item", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: R.newRitual }));
  const form = () => screen.getByRole("form", { name: R.add });

  it("defaults the owner to me, and sends the title, a quick-pick date and the description", async () => {
    const created = item({ title: "Brand new", dueDate: addDays(TODAY, 14) });
    apiMock.mockResolvedValue({ ok: true, data: { items: [created], people } });
    setup([]);
    open();
    expect(within(form()).getByLabelText(R.fields.owner)).toHaveValue("me");
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "  Brand new  " } });
    fireEvent.click(within(form()).getByRole("button", { name: R.quickDue.twoWeeks }));
    fireEvent.change(within(form()).getByLabelText(R.fields.description), { target: { value: "Some context" } });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/incidents/12/action-items", {
      method: "POST",
      body: { title: "Brand new", description: "Some context", ownerId: "me", dueDate: addDays(TODAY, 14) },
    });
    expect(screen.getByText("Brand new")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: R.add })).toBeNull(); // closed again
  });

  it.each([
    ["week", 7],
    ["month", 30],
  ] as const)("the %s quick pick is %i days from the viewer's today", async (key, days) => {
    apiMock.mockResolvedValue({ ok: true, data: { items: [item()], people } });
    setup([]);
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "x" } });
    fireEvent.click(within(form()).getByRole("button", { name: R.quickDue[key] }));
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock.mock.calls[0][1].body.dueDate).toBe(addDays(TODAY, days));
  });

  it("sends a custom date, or none", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { items: [item()], people } });
    setup([]);
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "x" } });
    fireEvent.click(within(form()).getByRole("button", { name: R.quickDue.custom }));
    fireEvent.change(within(form()).getByLabelText(R.fields.dueDate, { selector: "input" }), {
      target: { value: "2026-12-24" },
    });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock.mock.calls[0][1].body.dueDate).toBe("2026-12-24");
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "y" } });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock.mock.calls[1][1].body.dueDate).toBeNull();
  });

  it("can assign someone else", async () => {
    apiMock.mockResolvedValue({ ok: true, data: { items: [item({ ownerId: "other" })], people } });
    setup([]);
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "x" } });
    fireEvent.change(within(form()).getByLabelText(R.fields.owner), { target: { value: "other" } });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock.mock.calls[0][1].body.ownerId).toBe("other");
  });

  it("won't send an empty title", async () => {
    setup([]);
    open();
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(getCopy("professional").validation.required);
  });

  it("explains when there is no postmortem to add to, and keeps what was typed", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "no_postmortem", message: "x" });
    setup([]);
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "Keep me" } });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(screen.getByRole("alert")).toHaveTextContent(R.noPostmortem);
    expect(within(form()).getByLabelText(R.fields.title)).toHaveValue("Keep me");
  });

  it("explains an owner who isn't a member", async () => {
    apiMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: "validation_error",
      message: "x",
      fieldErrors: { ownerId: ["not_a_member"] },
    });
    setup([]);
    open();
    fireEvent.change(within(form()).getByLabelText(R.fields.title), { target: { value: "x" } });
    await act(async () => fireEvent.click(within(form()).getByRole("button", { name: R.add })));
    expect(screen.getByRole("alert")).toHaveTextContent(R.notAMember);
  });

  it("cancels without sending anything", () => {
    setup([]);
    open();
    fireEvent.click(within(form()).getByRole("button", { name: getCopy("professional").actions.cancel }));
    expect(screen.queryByRole("form", { name: R.add })).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("the incident's Rituals card", () => {
  const card = (props: Partial<Parameters<typeof IncidentRitualsCard>[0]> = {}) =>
    render(
      <CopyProvider skin="professional">
        <IncidentRitualsCard
          slug="acme"
          incidentNumber={12}
          hasPostmortem
          progress={{ done: 3, total: 5, overdue: 2 }}
          {...props}
        />
      </CopyProvider>,
    );

  it("shows a progress bar, the overdue count and a link to the postmortem", () => {
    card();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar).toHaveAttribute("aria-valuetext", R.progress(3, 5));
    expect(screen.getByText(R.progress(3, 5))).toBeInTheDocument();
    expect(screen.getByText(R.overdueCount(2))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: R.card.viewPostmortem })).toHaveAttribute(
      "href",
      "/app/acme/incidents/12/postmortem",
    );
  });

  it("leaves out the overdue line when nothing is overdue", () => {
    card({ progress: { done: 5, total: 5, overdue: 0 } });
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("says plainly that there are none, or that there is no postmortem yet, with no fake bar", () => {
    card({ progress: { done: 0, total: 0, overdue: 0 } });
    expect(screen.getByText(R.card.none)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    cleanup();
    card({ hasPostmortem: false, progress: { done: 0, total: 0, overdue: 0 } });
    expect(screen.getByText(R.card.startFirst)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("speaks the haunted skin's words", () => {
    render(
      <CopyProvider skin="haunted">
        <IncidentRitualsCard
          slug="acme"
          incidentNumber={12}
          hasPostmortem
          progress={{ done: 1, total: 2, overdue: 0 }}
        />
      </CopyProvider>,
    );
    expect(screen.getByRole("heading", { name: "Rituals" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 complete")).toBeInTheDocument();
  });
});
