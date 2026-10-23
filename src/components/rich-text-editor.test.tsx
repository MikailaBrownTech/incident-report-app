// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "@/components/rich-text-editor";
import { getCopy } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { validateDoc, type Doc } from "@/features/postmortems/content";

const tb = getCopy("professional").postmortem.toolbar;

// ProseMirror measures layout, which jsdom doesn't do.
beforeAll(() => {
  const rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});
afterEach(cleanup);

const DOC: Doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "A heading" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Some " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " words" },
      ],
    },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item one" }] }] }],
    },
  ],
};

function setup(doc: Doc | null = DOC, extra: { invalid?: boolean; onChange?: (d: Doc) => void } = {}) {
  return render(
    <CopyProvider skin="professional">
      <RichTextEditor
        doc={doc ?? undefined}
        onChange={extra.onChange ?? (() => {})}
        label="Edit: Summary"
        invalid={extra.invalid}
      />
    </CopyProvider>,
  );
}

describe("the real editor", () => {
  it("shows the stored document with its formatting, under an accessible name", async () => {
    setup();
    const area = await screen.findByRole("textbox", { name: "Edit: Summary" });
    expect(area).toHaveAttribute("aria-multiline", "true");
    expect(within(area).getByRole("heading", { level: 3, name: "A heading" })).toBeInTheDocument();
    expect(within(area).getByText("bold").tagName).toBe("STRONG");
    expect(within(area).getByText("item one").closest("li")).not.toBeNull();
  });

  it("offers exactly the formatting the server accepts, and nothing else", async () => {
    setup();
    await screen.findByRole("textbox");
    const toolbar = screen.getByRole("toolbar", { name: tb.label });
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      tb.bold,
      tb.italic,
      tb.code,
      tb.link,
      tb.heading,
      tb.bulletList,
      tb.orderedList,
      tb.quote,
      tb.codeBlock,
    ]);
    for (const b of within(toolbar).getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "false");
  });

  it("starts empty without a document", async () => {
    setup(null);
    const area = await screen.findByRole("textbox", { name: "Edit: Summary" });
    expect(area.textContent).toBe("");
  });

  it("flags itself invalid when asked to", async () => {
    setup(DOC, { invalid: true });
    expect(await screen.findByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("reports edits as documents that pass the server's allowlist", async () => {
    const onChange = vi.fn();
    setup(DOC, { onChange });
    const area = await screen.findByRole("textbox");
    // edit the way a browser does: change the text node, and let ProseMirror read the mutation
    const text = within(area).getByText("item one").firstChild as Text;
    text.nodeValue = "item one, edited";
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const out = onChange.mock.calls.at(-1)![0] as Doc;
    expect(validateDoc(out).ok).toBe(true);
    expect(JSON.stringify(out)).toContain("item one, edited");
  });
});
