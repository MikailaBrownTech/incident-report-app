// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostmortemEditor } from "@/components/postmortem-editor";
import { ToastProvider } from "@/components/toast";
import { getCopy, type SkinKey } from "@/copy";
import { CopyProvider } from "@/copy/provider";
import { docFromParagraphs, docText, type Doc } from "@/features/postmortems/content";
import type { PostmortemPayload } from "@/features/postmortems/schema";
import { BUILT_IN_TEMPLATES, QUICK_TEMPLATE_ID, STANDARD_TEMPLATE_ID } from "@/features/postmortems/sections";
import { polyfillDialog } from "@/test/dialog-polyfill";

// The real editor (ProseMirror) has its own smoke test. Here it is a textarea, so these tests are about saving.
vi.mock("@/components/rich-text-editor", async () => {
  const content = await import("@/features/postmortems/content");
  return {
    RichTextEditor: ({
      doc,
      onChange,
      onBlur,
      label,
      invalid,
    }: {
      doc: Doc | undefined;
      onChange: (d: Doc) => void;
      onBlur?: () => void;
      label: string;
      invalid?: boolean;
    }) => (
      <textarea
        aria-label={label}
        aria-invalid={invalid ? "true" : undefined}
        defaultValue={content.docText(doc)}
        onChange={(e) => onChange(content.docFromParagraphs([e.target.value]))}
        onBlur={onBlur}
      />
    ),
  };
});

const T = getCopy("professional").postmortem;
const LONG = "This section has comfortably more than twenty characters.";

function payload(
  over: { id?: string; templateId?: string; version?: number; sections?: Record<string, Doc> } = {},
): PostmortemPayload {
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === (over.templateId ?? QUICK_TEMPLATE_ID))!;
  return {
    postmortem: {
      id: over.id ?? "pm1",
      incidentNumber: 5,
      templateId: template.id,
      status: "DRAFT",
      version: over.version ?? 1,
      sections: over.sections ?? {},
      authorId: "u1",
      publishedAt: null,
      publishedById: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    },
    template,
    people: {},
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[];
type Handler = (
  call: Call,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }> | "network-error";
let handler: Handler;
const reply = (status: number, body: unknown) => ({ status, body });

beforeAll(() => {
  polyfillDialog();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  handler = () => {
    throw new Error("unexpected request");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const out = await handler(call);
      if (out === "network-error") throw new TypeError("network down");
      const status = out.status ?? 200;
      return { ok: status < 400, status, json: async () => out.body, text: async () => JSON.stringify(out.body) };
    }),
  );
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const savedPayload = (version: number, sections: Record<string, Doc> = {}) =>
  reply(200, payload({ version, sections }));

function setup(
  over: Parameters<typeof payload>[0] = {},
  extra: { skin?: SkinKey; onPublished?: (p: PostmortemPayload) => void } = {},
) {
  const onPublished = extra.onPublished ?? vi.fn();
  const view = render(
    <CopyProvider skin={extra.skin ?? "professional"}>
      <ToastProvider>
        <PostmortemEditor slug="acme" incidentNumber={5} initial={payload(over)} onPublished={onPublished} />
      </ToastProvider>
    </CopyProvider>,
  );
  return { ...view, onPublished };
}
const box = (title: string) =>
  screen.getByRole("textbox", { name: getCopy("professional").postmortem.editorLabel(title) }) as HTMLTextAreaElement;
const type = (title: string, text: string) => fireEvent.change(box(title), { target: { value: text } });
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const patches = () => calls.filter((c) => c.method === "PATCH");
const status = () => screen.getByRole("status");

describe("layout", () => {
  it("lists the template's sections in order, marking which are required", () => {
    setup();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/(Required|Optional)$/, "")),
    ).toEqual(["Summary", "Root cause and contributing factors", "What we learned"]);
    for (const h of screen.getAllByRole("heading", { level: 2 })) expect(h).toHaveTextContent(T.required);
  });

  it("shows the standard template's optional sections as optional", () => {
    setup({ templateId: STANDARD_TEMPLATE_ID });
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(10);
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(`How we found out\\s*${T.optional}`) }),
    ).toBeInTheDocument();
  });

  it("shows each section's blameless prompt until it has content, then lets you show it again", () => {
    setup({ sections: { summary: docFromParagraphs([LONG]) } });
    expect(screen.getByText(T.sections.root_cause.prompt)).toBeInTheDocument();
    expect(screen.queryByText(T.sections.summary.prompt)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: T.showPrompt }));
    expect(screen.getByText(T.sections.summary.prompt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: T.hidePrompt }));
    expect(screen.queryByText(T.sections.summary.prompt)).toBeNull();
  });

  it("hides the prompt once you start typing", () => {
    setup();
    expect(screen.getByText(T.sections.summary.prompt)).toBeInTheDocument();
    type("Summary", "Something");
    expect(screen.queryByText(T.sections.summary.prompt)).toBeNull();
  });

  it("marks sections empty, started or complete in the sidebar, and updates as you type", () => {
    setup({ sections: { summary: docFromParagraphs([LONG]), root_cause: docFromParagraphs(["short"]) } });
    const nav = screen.getByRole("navigation", { name: T.sectionsNav });
    const item = (name: string) => within(nav).getByRole("button", { name: new RegExp(name) });
    expect(item("Summary")).toHaveTextContent(T.progress.complete);
    expect(item("Root cause")).toHaveTextContent(T.progress.started);
    expect(item("What we learned")).toHaveTextContent(T.progress.empty);
    type("What we learned", LONG);
    expect(item("What we learned")).toHaveTextContent(T.progress.complete);
    expect(within(nav).getAllByText(T.required)).toHaveLength(3);
  });

  it("scrolls to a section from the sidebar, and from the dropdown on a phone", () => {
    setup();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: T.sectionsNav })).getByRole("button", { name: /What we learned/ }),
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(
      document.getElementById("section-lessons"),
    );
    fireEvent.change(screen.getByLabelText(T.jumpToSection), { target: { value: "root_cause" } });
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[1]).toBe(
      document.getElementById("section-root_cause"),
    );
    // the dropdown offers every section
    expect(within(screen.getByLabelText(T.jumpToSection)).getAllByRole("option")).toHaveLength(4); // placeholder + 3
  });

  it("speaks the haunted skin's words", () => {
    setup({}, { skin: "haunted" });
    const h = getCopy("haunted").postmortem;
    expect(screen.getByRole("button", { name: "Bury it" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(h.sections.root_cause.title) }),
    ).toBeInTheDocument();
    expect(screen.getByText(h.sections.root_cause.prompt)).toBeInTheDocument();
  });
});

describe("autosave", () => {
  it("saves about 1.5 seconds after the last keystroke, sending only what changed and the version it loaded", async () => {
    handler = () => savedPayload(2);
    setup({ version: 1 });
    type("Summary", "First thoughts");
    await advance(1499);
    expect(patches()).toHaveLength(0);
    expect(status()).toHaveTextContent(T.save.unsaved);
    await advance(1);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({ url: "/api/w/acme/incidents/5/postmortem", body: { version: 1 } });
    const sent = (patches()[0].body as { sections: Record<string, Doc> }).sections;
    expect(Object.keys(sent)).toEqual(["summary"]);
    expect(docText(sent.summary)).toBe("First thoughts");
    expect(status()).toHaveTextContent(T.save.saved(0));
  });

  it("shows Saving... while the request is out, then 'Saved 3s ago' as time passes", async () => {
    let finish: (v: ReturnType<typeof reply>) => void = () => {};
    handler = () => new Promise((resolve) => (finish = resolve));
    setup();
    type("Summary", "text");
    await advance(1500);
    expect(status()).toHaveTextContent(T.save.saving);
    await act(async () => finish(savedPayload(2)));
    expect(status()).toHaveTextContent(T.save.saved(0));
    await advance(3000);
    expect(status()).toHaveTextContent(T.save.saved(3));
  });

  it("restarts the wait on every keystroke, so a burst of typing is one save", async () => {
    handler = () => savedPayload(2);
    setup();
    type("Summary", "a");
    await advance(1000);
    type("Summary", "ab");
    await advance(1000);
    type("Summary", "abc");
    await advance(1499);
    expect(patches()).toHaveLength(0);
    await advance(1);
    expect(patches()).toHaveLength(1);
    expect(docText((patches()[0].body as { sections: Record<string, Doc> }).sections.summary)).toBe("abc");
  });

  it("uses the new version for the next save", async () => {
    let version = 1;
    handler = () => savedPayload(++version);
    setup({ version: 1 });
    type("Summary", "one");
    await advance(1500);
    type("Summary", "two");
    await advance(1500);
    expect(patches().map((c) => (c.body as { version: number }).version)).toEqual([1, 2]);
  });

  it("saves on blur straight away", async () => {
    handler = () => savedPayload(2);
    setup();
    type("Summary", "typed");
    fireEvent.blur(box("Summary"));
    await advance(0);
    expect(patches()).toHaveLength(1);
  });

  it("saves on Ctrl+S and Cmd+S, and stops the browser's own save dialog", async () => {
    handler = () => savedPayload(2);
    setup();
    type("Summary", "typed");
    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true, bubbles: true });
    await act(async () => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(patches()).toHaveLength(1);

    type("Summary", "typed more");
    await act(
      async () =>
        void window.dispatchEvent(new KeyboardEvent("keydown", { key: "S", metaKey: true, cancelable: true })),
    );
    expect(patches()).toHaveLength(2);
  });

  it("does nothing when nothing changed", async () => {
    setup();
    await advance(10_000);
    fireEvent.blur(box("Summary"));
    await advance(10_000);
    expect(calls).toHaveLength(0);
  });

  it("keeps edits made while a save is in flight, and sends them next", async () => {
    let finish: (v: ReturnType<typeof reply>) => void = () => {};
    let n = 0;
    handler = () => (++n === 1 ? new Promise((resolve) => (finish = resolve)) : savedPayload(3));
    setup({ version: 1 });
    type("Summary", "first");
    await advance(1500);
    type("Summary", "first and more"); // typed while request 1 is out
    await act(async () => finish(savedPayload(2)));
    expect(status()).toHaveTextContent(T.save.unsaved);
    await advance(1500);
    expect(patches()).toHaveLength(2);
    expect(patches()[1].body).toMatchObject({ version: 2 });
    expect(docText((patches()[1].body as { sections: Record<string, Doc> }).sections.summary)).toBe("first and more");
  });

  it("warns before leaving the page while anything is unsaved, and not once saved", async () => {
    handler = () => savedPayload(2);
    setup();
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    type("Summary", "unsaved words");
    expect(leave()).toBe(true);
    await advance(1500);
    expect(leave()).toBe(false);
  });
});

describe("when saving fails", () => {
  it("keeps the text, says so, and retries with growing pauses until it works", async () => {
    let n = 0;
    handler = () => {
      n += 1;
      return n <= 2 ? "network-error" : savedPayload(2);
    };
    setup();
    type("Summary", "precious words");
    await advance(1500);
    expect(patches()).toHaveLength(1);
    expect(status()).toHaveTextContent(T.save.failed);
    expect(box("Summary").value).toBe("precious words");

    await advance(1999);
    expect(patches()).toHaveLength(1);
    await advance(1); // first retry after 2s
    expect(patches()).toHaveLength(2);
    await advance(3999);
    expect(patches()).toHaveLength(2);
    await advance(1); // second retry after 4s
    expect(patches()).toHaveLength(3);
    expect(status()).toHaveTextContent(T.save.saved(0));
    // every attempt carried the same text and version
    for (const c of patches()) {
      expect(c.body).toMatchObject({ version: 1 });
      expect(docText((c.body as { sections: Record<string, Doc> }).sections.summary)).toBe("precious words");
    }
  });

  it("also retries after a server error, and never gives up the text", async () => {
    let n = 0;
    handler = () => (++n === 1 ? reply(500, { error: { code: "internal_error" } }) : savedPayload(2));
    setup();
    type("Summary", "words");
    await advance(1500);
    expect(status()).toHaveTextContent(T.save.failed);
    await advance(2000);
    expect(status()).toHaveTextContent(T.save.saved(0));
  });

  it("caps the pause between retries at 30 seconds", async () => {
    handler = () => "network-error";
    setup();
    type("Summary", "words");
    await advance(1500);
    for (const pause of [2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = patches().length;
      await advance(pause - 1);
      expect(patches()).toHaveLength(before);
      await advance(1);
      expect(patches()).toHaveLength(before + 1);
    }
  });
});

describe("conflicts", () => {
  const theirs = payload({
    version: 5,
    sections: {
      summary: docFromParagraphs(["Their summary, written meanwhile"]),
      lessons: docFromParagraphs(["Their lessons, written meanwhile"]),
    },
  });

  async function conflicted() {
    handler = (call) =>
      call.method === "PATCH" && (call.body as { version: number }).version === 1
        ? reply(409, { error: { code: "version_conflict", message: "x" }, latest: theirs })
        : savedPayload(6);
    const view = setup({ version: 1, sections: { summary: docFromParagraphs(["Original"]) } });
    type("Summary", "My summary edit");
    await advance(1500);
    return view;
  }

  it("never overwrites silently: it stops and asks, naming both choices", async () => {
    await conflicted();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: T.conflict.title })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.conflict.keepMine })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.conflict.loadTheirs })).toBeInTheDocument();
    expect(status()).toHaveTextContent(T.save.unsaved);
    expect(box("Summary").value).toBe("My summary edit"); // still there under the dialog
    // no further attempts while the question is open
    await advance(60_000);
    expect(patches()).toHaveLength(1);
  });

  it("can't be dismissed with Escape", async () => {
    await conflicted();
    const cancel = new Event("cancel", { cancelable: true });
    screen.getByRole("dialog").dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("'Load theirs' replaces the sections with the server's, discards my edit, and saves nothing", async () => {
    await conflicted();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.conflict.loadTheirs })));
    expect(box("Summary").value).toBe("Their summary, written meanwhile");
    expect(box("What we learned").value).toBe("Their lessons, written meanwhile");
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(10_000);
    expect(patches()).toHaveLength(1); // no second save
    // and the next edit builds on their version
    type("Summary", "Now editing theirs");
    await advance(1500);
    expect(patches()[1].body).toMatchObject({ version: 5 });
  });

  it("'Keep mine' copies my text first, then saves it on top of their version, keeping their other sections", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await conflicted();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.conflict.keepMine })));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("My summary edit");
    expect(screen.queryByRole("dialog")).toBeNull();
    // saved against THEIR version, so it goes through
    expect(patches()).toHaveLength(2);
    expect(patches()[1].body).toMatchObject({ version: 5 });
    const sent = (patches()[1].body as { sections: Record<string, Doc> }).sections;
    expect(Object.keys(sent)).toEqual(["summary"]); // only what I changed
    expect(docText(sent.summary)).toBe("My summary edit");
    // the section I didn't touch now shows theirs
    expect(box("What we learned").value).toBe("Their lessons, written meanwhile");
    expect(box("Summary").value).toBe("My summary edit");
    expect(status()).toHaveTextContent(T.save.saved(0));
  });

  it("still keeps my text if the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    await conflicted();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.conflict.keepMine })));
    expect(patches()).toHaveLength(2);
  });
});

describe("publishing", () => {
  it("saves pending edits first, then publishes, and hands over the published postmortem", async () => {
    const published = {
      ...payload({ version: 3 }),
      postmortem: { ...payload({ version: 3 }).postmortem, status: "PUBLISHED" as const },
    };
    handler = (call) => (call.url.endsWith("/publish") ? reply(200, published) : savedPayload(2));
    const { onPublished } = setup({ version: 1 });
    type("Summary", "Last-second edit");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.publish })));
    await advance(0);
    expect(calls.map((c) => `${c.method} ${c.url.replace("/api/w/acme/incidents/5/postmortem", "")}`)).toEqual([
      "PATCH ",
      "POST /publish",
    ]);
    expect(onPublished).toHaveBeenCalledWith(published);
  });

  it("lists the required sections that are missing, flags them, and scrolls to the first", async () => {
    handler = () =>
      reply(422, {
        error: { code: "missing_sections", message: "x", fieldErrors: { sections: ["root_cause", "lessons"] } },
      });
    const { onPublished } = setup({ sections: { summary: docFromParagraphs([LONG]) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.publish })));
    await advance(0);
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      T.missingSections([T.sections.root_cause.title, T.sections.lessons.title]),
    );
    expect(box("Root cause and contributing factors")).toHaveAttribute("aria-invalid", "true");
    expect(box("What we learned")).toHaveAttribute("aria-invalid", "true");
    expect(box("Summary")).not.toHaveAttribute("aria-invalid");
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(
      document.getElementById("section-root_cause"),
    );
    // fixing a flagged section clears its flag
    type("Root cause and contributing factors", LONG);
    expect(box("Root cause and contributing factors")).not.toHaveAttribute("aria-invalid");
    expect(box("What we learned")).toHaveAttribute("aria-invalid", "true");
  });

  it("doesn't publish when the pending save can't be completed", async () => {
    handler = () => "network-error";
    const { onPublished } = setup();
    type("Summary", "unsaved");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.publish })));
    await advance(0);
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: T.publish })).toBeEnabled();
    await advance(0);
    expect(screen.getByText(T.toasts.saveFailed)).toBeInTheDocument();
  });

  it("disables the button while publishing", async () => {
    let finish: (v: ReturnType<typeof reply>) => void = () => {};
    handler = () => new Promise((resolve) => (finish = resolve));
    setup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.publish })));
    expect(screen.getByRole("button", { name: T.publishing })).toBeDisabled();
    await act(async () => finish(reply(500, { error: { code: "internal_error" } })));
    await advance(0);
    expect(screen.getByText(T.toasts.publishFailed)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.publish })).toBeEnabled();
  });

  it("opens what someone else published when a save finds it already published", async () => {
    const published = {
      ...payload({ version: 4 }),
      postmortem: { ...payload({ version: 4 }).postmortem, status: "PUBLISHED" as const },
    };
    handler = (call) =>
      call.method === "PATCH"
        ? reply(409, { error: { code: "postmortem_published", message: "x" } })
        : reply(200, published);
    const { onPublished } = setup();
    type("Summary", "too late");
    await advance(1500);
    await advance(0);
    expect(screen.getByText(T.toasts.publishedElsewhere)).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledWith(published);
  });
});

describe("refreshing the timeline section", () => {
  const doc = docFromParagraphs(["2026-06-10 10:05 UTC: Alerts fired"]);

  it("asks first, then replaces the section with a fresh snapshot and saves it", async () => {
    handler = (call) => (call.url.endsWith("/timeline") ? reply(200, { doc }) : savedPayload(2));
    setup({
      templateId: STANDARD_TEMPLATE_ID,
      sections: { timeline: docFromParagraphs(["my own edited timeline text"]) },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.refreshTimeline })));
    expect(screen.getByRole("dialog", { name: T.refreshTimelineTitle })).toBeInTheDocument();
    expect(calls).toHaveLength(0); // nothing until confirmed
    expect(box("Key moments").value).toBe("my own edited timeline text");

    await act(async () =>
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: T.refreshTimeline })),
    );
    await advance(0);
    expect(box("Key moments").value).toContain("Alerts fired");
    await advance(1500);
    expect(Object.keys((patches()[0].body as { sections: object }).sections)).toEqual(["timeline"]);
  });

  it("changes nothing when cancelled", async () => {
    setup({ templateId: STANDARD_TEMPLATE_ID, sections: { timeline: docFromParagraphs(["keep this"]) } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: T.refreshTimeline })));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: getCopy("professional").actions.cancel }),
    );
    expect(calls).toHaveLength(0);
    expect(box("Key moments").value).toBe("keep this");
  });

  it("only offers the refresh on the timeline section", () => {
    setup({ templateId: STANDARD_TEMPLATE_ID });
    expect(screen.getAllByRole("button", { name: T.refreshTimeline })).toHaveLength(1);
    cleanup();
    setup(); // the quick template has no timeline section
    expect(screen.queryByRole("button", { name: T.refreshTimeline })).toBeNull();
  });
});
