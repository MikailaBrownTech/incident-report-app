// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostmortemPublished } from "@/components/postmortem-published";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { docFromBullets, docFromParagraphs, type Doc } from "@/features/postmortems/content";
import type { ActionItemView } from "@/features/action-items/schema";
import type { PostmortemPayload } from "@/features/postmortems/schema";
import { BUILT_IN_TEMPLATES, STANDARD_TEMPLATE_ID } from "@/features/postmortems/sections";
import { polyfillDialog } from "@/test/dialog-polyfill";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: apiMock }));

const T = getCopy("professional").postmortem;
const LONG = "This section has comfortably more than twenty characters.";

function payload(sections: Record<string, Doc>): PostmortemPayload {
  return {
    postmortem: {
      id: "pm1",
      incidentNumber: 5,
      templateId: STANDARD_TEMPLATE_ID,
      status: "PUBLISHED",
      version: 7,
      sections,
      authorId: "u1",
      publishedAt: "2026-06-12T09:30:00.000Z",
      publishedById: "u2",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-12T09:30:00.000Z",
    },
    template: BUILT_IN_TEMPLATES[0],
    people: { u2: { userId: "u2", name: "Priya Raman", email: "priya@x.test", image: null } },
  };
}
const SECTIONS: Record<string, Doc> = {
  summary: docFromParagraphs(["Checkout failed for twelve percent of customers."]),
  impact: docFromParagraphs([LONG]),
  root_cause: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A slow query exhausted the " },
          { type: "text", text: "connection pool", marks: [{ type: "bold" }] },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "runbook", marks: [{ type: "link", attrs: { href: "https://example.com/runbook" } }] },
        ],
      },
    ],
  },
  timeline: docFromBullets(["10:05 alerts fired", "10:30 rollback"]),
  lessons: docFromParagraphs([LONG]),
};

beforeAll(polyfillDialog);
beforeEach(() => apiMock.mockReset());
afterEach(cleanup);

function setup(
  opts: {
    canUnpublish?: boolean;
    sections?: Record<string, Doc>;
    skin?: SkinKey;
    onUnpublished?: (p: PostmortemPayload) => void;
    actionItems?: ActionItemView[];
    actionPanel?: React.ReactNode;
  } = {},
) {
  const onUnpublished = opts.onUnpublished ?? vi.fn();
  render(
    <CopyProvider skin={opts.skin ?? "professional"}>
      <ToastProvider>
        <PostmortemPublished
          slug="acme"
          incident={{ number: 5, title: "Checkout API timeouts", severity: 4, status: "RESOLVED" }}
          severityLabels={null}
          payload={payload(opts.sections ?? SECTIONS)}
          canUnpublish={opts.canUnpublish ?? false}
          onUnpublished={onUnpublished}
          actionItems={opts.actionItems}
          actionPanel={opts.actionPanel}
        />
      </ToastProvider>
    </CopyProvider>,
  );
  return { onUnpublished };
}

describe("reading", () => {
  it("shows the sections that have content, in template order, with formatting", () => {
    setup();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Summary",
      "Impact",
      "Root cause and contributing factors",
      "Key moments",
      "What we learned",
    ]);
    expect(screen.getByText("connection pool").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "runbook" })).toHaveAttribute("href", "https://example.com/runbook");
    expect(screen.getByRole("link", { name: "runbook" })).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("is read-only: nothing to type into", () => {
    setup();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(T.readOnlyNotice)).toBeInTheDocument();
  });

  it("says who published it and when", () => {
    setup();
    expect(screen.getByText(/Published by Priya Raman on /)).toBeInTheDocument();
  });

  it("shows the live action items panel it is given, and invents nothing when there is none", () => {
    setup();
    expect(screen.queryByTestId("panel-stub")).toBeNull();
    cleanup();
    setup({ actionPanel: <div data-testid="panel-stub" /> });
    expect(screen.getByTestId("panel-stub")).toBeInTheDocument();
  });

  it("never renders a script or javascript link, even from stored content that predates the allowlist", () => {
    setup({
      sections: {
        summary: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              ],
            },
            { type: "script", content: [{ type: "text", text: "alert(1)" }] },
          ],
        } as Doc,
      },
    });
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("click")).toBeInTheDocument();
  });
});

describe("copy as markdown", () => {
  it("copies the whole postmortem as markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.copyMarkdown })));
    const md = writeText.mock.calls[0][0] as string;
    expect(md.startsWith("# INC-5: Checkout API timeouts\n")).toBe(true);
    expect(md).toContain("## Summary\n\nCheckout failed for twelve percent of customers.");
    expect(md).toContain("A slow query exhausted the **connection pool**");
    expect(md).toContain("[runbook](https://example.com/runbook)");
    expect(md).toContain("## Key moments\n\n- 10:05 alerts fired\n- 10:30 rollback");
    expect(md.indexOf("## Impact")).toBeLessThan(md.indexOf("## What we learned"));
    expect(md).not.toContain("## How we found out"); // empty sections are left out
    expect(screen.getByText(T.copied)).toBeInTheDocument();
  });

  it("includes the action items as a checklist, checked when done", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const mk = (over: Partial<ActionItemView>): ActionItemView => ({
      id: "i",
      title: "Item",
      description: "",
      status: "OPEN",
      wontDoReason: null,
      dueDate: null,
      completedAt: null,
      ownerId: "u2",
      createdById: "u2",
      position: "a0",
      postmortemId: "pm1",
      incident: { id: "inc", number: 5, title: "x", severity: 4 },
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      ...over,
    });
    setup({
      actionItems: [
        mk({ id: "a", title: "Add a pool alert", status: "DONE", dueDate: "2026-06-20" }),
        mk({ id: "b", title: "Separate the export queue", status: "IN_PROGRESS" }),
        mk({ id: "c", title: "Rewrite the importer", status: "WONT_DO", wontDoReason: "Replaced by the vendor" }),
      ],
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.copyMarkdown })));
    const md = writeText.mock.calls[0][0] as string;
    expect(md).toContain(
      [
        "## Action items",
        "",
        "- [x] Add a pool alert (Priya Raman, due 2026-06-20)",
        "- [ ] Separate the export queue (Priya Raman)",
        "- [ ] ~~Rewrite the importer~~ (Replaced by the vendor) (Priya Raman)",
      ].join("\n"),
    );
    expect(md.indexOf("## Action items")).toBeGreaterThan(md.indexOf("## What we learned"));
  });

  it("leaves the checklist out when there are no action items", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.copyMarkdown })));
    expect(writeText.mock.calls[0][0]).not.toContain("Action items");
  });

  it("says so when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
      configurable: true,
    });
    setup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.copyMarkdown })));
    expect(screen.getByText(T.copyFailed)).toBeInTheDocument();
  });
});

describe("printing", () => {
  it("prints the page, and keeps the buttons and notice out of the printout", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    setup({ canUnpublish: true });
    fireEvent.click(screen.getByRole("button", { name: T.print }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: T.print }).closest("div.print\\:hidden")).not.toBeNull();
    print.mockRestore();
  });
});

describe("unpublishing", () => {
  it("is only offered to admins", () => {
    setup({ canUnpublish: false });
    expect(screen.queryByRole("button", { name: T.unpublish })).toBeNull();
    cleanup();
    setup({ canUnpublish: true });
    expect(screen.getByRole("button", { name: T.unpublish })).toBeInTheDocument();
  });

  it("asks first, then unpublishes and hands back the draft", async () => {
    const draft = payload(SECTIONS);
    apiMock.mockResolvedValue({ ok: true, data: draft });
    const { onUnpublished } = setup({ canUnpublish: true });
    fireEvent.click(screen.getByRole("button", { name: T.unpublish }));
    const dialog = screen.getByRole("dialog", { name: T.unpublishConfirmTitle });
    expect(apiMock).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: T.unpublish })));
    expect(apiMock).toHaveBeenCalledWith("/api/w/acme/incidents/5/postmortem/unpublish", { method: "POST" });
    expect(onUnpublished).toHaveBeenCalledWith(draft);
    expect(screen.getByText(T.toasts.unpublished)).toBeInTheDocument();
  });

  it("does nothing if you cancel, and reports a failure without changing anything", async () => {
    const { onUnpublished } = setup({ canUnpublish: true });
    fireEvent.click(screen.getByRole("button", { name: T.unpublish }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: getCopy("professional").actions.cancel }),
    );
    expect(apiMock).not.toHaveBeenCalled();

    apiMock.mockResolvedValue({ ok: false, status: 403, code: "forbidden", message: "x" });
    fireEvent.click(screen.getByRole("button", { name: T.unpublish }));
    await act(async () =>
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: T.unpublish })),
    );
    expect(onUnpublished).not.toHaveBeenCalled();
    expect(screen.getByText(getCopy("professional").errors.generic)).toBeInTheDocument();
  });

  it("speaks the haunted skin's words", () => {
    setup({ canUnpublish: true, skin: "haunted" });
    expect(screen.getByRole("button", { name: "Exhume" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The Tale" })).toBeInTheDocument();
  });
});
