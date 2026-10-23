import { describe, expect, it } from "vitest";
import {
  MAX_CONTENT_BYTES,
  MAX_SECTIONS,
  docFromBullets,
  docFromParagraphs,
  docText,
  docToMarkdown,
  isMeaningful,
  isSafeHref,
  readContent,
  sectionProgress,
  validateContent,
  validateDoc,
  type Doc,
  type DocNode,
} from "./content";
import { markdownToDoc } from "./prefill";

const KEYS = ["summary", "root_cause", "lessons"];
const doc = (...content: DocNode[]): Doc => ({ type: "doc", content });
const p = (text: string, marks?: DocNode["marks"]): DocNode => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

describe("allowed formatting", () => {
  it("accepts everything the editor can produce, as Tiptap writes it", () => {
    const everything = doc(
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Heading" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          {
            type: "text",
            text: "link",
            marks: [
              {
                type: "link",
                attrs: {
                  href: "https://example.com/a?b=1",
                  target: "_blank",
                  rel: "noopener noreferrer nofollow",
                  class: null,
                },
              },
            ],
          },
          { type: "hardBreak" },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] },
      { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [p("one")] }] },
      { type: "blockquote", content: [p("quoted")] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "let x = 1" }] },
      { type: "paragraph" }, // an empty paragraph has no content key
    );
    expect(validateDoc(everything)).toEqual({ ok: true, doc: everything });
    const saved = validateContent({ summary: everything }, KEYS);
    expect(saved).toEqual({ ok: true, sections: { summary: everything } }); // round-trips unchanged
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it("accepts mailto links", () => {
    expect(validateDoc(doc(p("mail", [{ type: "link", attrs: { href: "mailto:oncall@example.com" } }]))).ok).toBe(true);
  });
});

describe("rejected content", () => {
  const bad = (node: unknown) => validateDoc(doc(node as DocNode));

  it.each([
    ["a script node", { type: "script", content: [{ type: "text", text: "alert(1)" }] }, "unknown_node"],
    ["raw HTML", { type: "html", text: "<img src=x onerror=alert(1)>" }, "unknown_node"],
    ["an iframe", { type: "iframe", attrs: { src: "https://evil.example" } }, "unknown_node"],
    ["an image", { type: "image", attrs: { src: "https://t.test/p.png" } }, "unknown_node"],
    ["a table", { type: "table", content: [] }, "unknown_node"],
    ["a node type that is an Object.prototype name", { type: "constructor" }, "unknown_node"],
    ["a toString node", { type: "toString" }, "unknown_node"],
    [
      "a heading above level 3",
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "x" }] },
      "bad_heading_level",
    ],
    ["a heading with no level", { type: "heading", content: [{ type: "text", text: "x" }] }, "bad_heading_level"],
    ["an unexpected attribute on a paragraph", { type: "paragraph", attrs: { onclick: "x" } }, "bad_attribute"],
    [
      "a style attribute on a heading",
      { type: "heading", attrs: { level: 3, style: "x" }, content: [] },
      "bad_attribute",
    ],
    ["empty text", { type: "paragraph", content: [{ type: "text", text: "" }] }, "bad_text"],
    ["text on a non-text node", { type: "paragraph", text: "hi" }, "bad_text"],
    [
      "an unknown mark",
      { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "highlight" }] }] },
      "unknown_mark",
    ],
    ["a mark on a non-text node", { type: "paragraph", marks: [{ type: "bold" }] }, "unknown_mark"],
    ["an unknown top-level key", { type: "paragraph", onclick: "x" }, "not_a_document"],
    ["a non-array content", { type: "paragraph", content: "x" }, "not_a_document"],
  ])("rejects %s", (_name, node, problem) => {
    expect(bad(node)).toEqual({ ok: false, problem });
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "/relative/path",
    "//evil.example",
    "https://",
    "",
    "https://example.com/has space",
  ])("rejects the link target %j", (href) => {
    const result = validateDoc(doc(p("x", [{ type: "link", attrs: { href } }])));
    expect(result).toEqual({ ok: false, problem: "unsafe_link" });
    expect(isSafeHref(href)).toBe(false);
  });

  it("rejects a link with no href, and a non-string href", () => {
    expect(validateDoc(doc(p("x", [{ type: "link" }])))).toEqual({ ok: false, problem: "unsafe_link" });
    expect(validateDoc(doc(p("x", [{ type: "link", attrs: { href: 5 } }])))).toEqual({
      ok: false,
      problem: "unsafe_link",
    });
  });

  it("rejects anything that isn't a doc", () => {
    for (const v of [null, undefined, 5, "x", [], {}, { type: "paragraph" }, { type: "doc", content: "x" }]) {
      expect(validateDoc(v).ok, JSON.stringify(v)).toBe(false);
    }
  });

  it("rejects absurdly deep nesting without overflowing", () => {
    let node: DocNode = p("deep");
    for (let i = 0; i < 5000; i += 1) node = { type: "blockquote", content: [node] };
    expect(validateDoc(doc(node))).toEqual({ ok: false, problem: "too_deep" });
  });
});

describe("validateContent", () => {
  it("rejects sections that aren't in the template, and badly named ones", () => {
    expect(validateContent({ nope: doc() }, KEYS)).toEqual({
      ok: false,
      error: { code: "unknown_section", key: "nope" },
    });
    expect(validateContent({ __proto__x: doc() } as never, KEYS).ok).toBe(false);
    expect(validateContent({ Summary: doc() }, KEYS).ok).toBe(false);
  });

  it("names the section whose document is invalid", () => {
    const result = validateContent({ summary: doc(p("fine")), lessons: doc({ type: "script" } as DocNode) }, KEYS);
    expect(result).toEqual({ ok: false, error: { code: "invalid_document", key: "lessons", problem: "unknown_node" } });
  });

  it("rejects an oversize payload before walking it", () => {
    const big = doc(p("x".repeat(MAX_CONTENT_BYTES)));
    expect(validateContent({ summary: big }, KEYS)).toEqual({ ok: false, error: { code: "too_large" } });
  });

  it("accepts a payload just under the limit", () => {
    const text = "x".repeat(MAX_CONTENT_BYTES - 500);
    expect(validateContent({ summary: doc(p(text)) }, KEYS).ok).toBe(true);
  });

  it("limits the number of sections", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => [`s${i}`, doc()]));
    const keys = Object.keys(many);
    expect(validateContent(many, keys)).toEqual({ ok: false, error: { code: "too_many_sections" } });
  });

  it("is not content when it isn't an object", () => {
    for (const v of [null, [], "x", 3])
      expect(validateContent(v, KEYS)).toEqual({ ok: false, error: { code: "not_content" } });
  });
});

describe("readContent", () => {
  it("treats malformed stored data as empty rather than crashing", () => {
    expect(readContent(null)).toEqual({ sections: {} });
    expect(readContent({ sections: "x" })).toEqual({ sections: {} });
    expect(readContent({ sections: { a: { type: "script" }, b: doc(p("ok")) } })).toEqual({
      sections: { b: doc(p("ok")) },
    });
  });
});

describe("reading a document", () => {
  it("extracts text, and judges a section by it", () => {
    const d = doc(p("First line here"), { type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] });
    expect(docText(d)).toBe("First line here\nitem");
    expect(isMeaningful(doc(p("short")))).toBe(false);
    expect(isMeaningful(doc(p("x".repeat(19))))).toBe(false);
    expect(isMeaningful(doc(p("x".repeat(20))))).toBe(true);
    expect(isMeaningful(doc(p("   " + "x".repeat(19) + "   ")))).toBe(false); // whitespace doesn't count
    expect(isMeaningful(undefined)).toBe(false);
    expect(sectionProgress(undefined)).toBe("empty");
    expect(sectionProgress(doc(p("   ")))).toBe("empty");
    expect(sectionProgress(doc(p("hi")))).toBe("started");
    expect(sectionProgress(doc(p("x".repeat(25))))).toBe("complete");
  });
});

describe("markdown export", () => {
  it("writes readable markdown for every kind of block and mark", () => {
    const d = doc(
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Timeline" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "We " },
          { type: "text", text: "rolled back", marks: [{ type: "bold" }] },
          { type: "text", text: " via " },
          { type: "text", text: "kubectl", marks: [{ type: "code" }] },
          { type: "text", text: " (" },
          { type: "text", text: "runbook", marks: [{ type: "link", attrs: { href: "https://example.com/r" } }] },
          { type: "text", text: ")" },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("one")] },
          { type: "listItem", content: [p("two")] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          { type: "listItem", content: [p("first")] },
          { type: "listItem", content: [p("second")] },
        ],
      },
      { type: "blockquote", content: [p("quoted")] },
      { type: "codeBlock", attrs: { language: "sh" }, content: [{ type: "text", text: "echo hi" }] },
    );
    expect(docToMarkdown(d)).toBe(
      [
        "### Timeline",
        "We **rolled back** via `kubectl` ([runbook](https://example.com/r))",
        "- one\n- two",
        "1. first\n2. second",
        "> quoted",
        "```sh\necho hi\n```",
      ].join("\n\n"),
    );
  });

  it("is empty for an empty or missing document", () => {
    expect(docToMarkdown(undefined)).toBe("");
    expect(docToMarkdown(doc({ type: "paragraph" }))).toBe("");
  });
});

describe("building documents", () => {
  it("makes valid paragraphs and bullet lists", () => {
    expect(validateDoc(docFromParagraphs(["a", " ", "b"])).ok).toBe(true);
    expect(docText(docFromParagraphs(["a", " ", "b"]))).toBe("a\nb");
    expect(validateDoc(docFromBullets(["x", "y"])).ok).toBe(true);
    expect(docFromBullets([]).content).toEqual([]);
  });
});

describe("markdownToDoc (the incident summary becomes the first section)", () => {
  it("converts the markdown a summary realistically contains, into valid nodes", () => {
    const md = [
      "Users on **Safari 17** were bounced to `/login`.",
      "",
      "## What happened",
      "",
      "- Cause: `SameSite` set after the redirect",
      "- Fix: [the patch](https://example.com/pr/1)",
      "",
      "1. Fix the key check",
      "2. Replay the events",
      "",
      "> a quote",
      "",
      "```js",
      "let a = 1",
      "```",
    ].join("\n");
    const d = markdownToDoc(md);
    expect(validateDoc(d).ok).toBe(true);
    expect(d.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
    ]);
    expect(d.content?.[1].attrs).toEqual({ level: 3 }); // any markdown heading becomes level 3
    expect(docText(d)).toContain("Users on Safari 17 were bounced to /login.");
    expect(docToMarkdown(d)).toContain("**Safari 17**");
  });

  it("drops unsafe link targets but keeps the words", () => {
    const d = markdownToDoc("[click me](javascript:alert(1)) now");
    expect(validateDoc(d).ok).toBe(true);
    expect(docText(d)).toBe("click me now");
    expect(JSON.stringify(d)).not.toContain("javascript");
  });

  it("leaves snake_case words alone and survives odd input", () => {
    expect(docText(markdownToDoc("the root_cause_analysis step"))).toBe("the root_cause_analysis step");
    expect(validateDoc(markdownToDoc("")).ok).toBe(true);
    expect(markdownToDoc("").content).toEqual([]);
    expect(validateDoc(markdownToDoc("```\nunterminated")).ok).toBe(true);
    expect(validateDoc(markdownToDoc("- \n-\n> \n#")).ok).toBe(true);
  });
});
