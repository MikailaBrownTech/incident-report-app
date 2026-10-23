/**
 * Rich-text documents (Tiptap/ProseMirror JSON). Pure and browser-safe.
 *
 * The server never trusts a document: `validateContent` accepts only an allowlist of node and mark types (and the few
 * attributes each may carry), http/https/mailto links, and bounded size. Anything else is rejected, not "cleaned", so
 * what is stored is exactly what was validated.
 */

export const MAX_CONTENT_BYTES = 200 * 1024;
export const MAX_SECTIONS = 20;
const MAX_DEPTH = 8;
const MAX_NODES = 20_000;
/** A required section must say at least this much to be publishable. */
export const MEANINGFUL_CHARS = 20;

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}
export type Doc = { type: "doc"; content?: DocNode[] };
export interface PostmortemContent {
  sections: Record<string, Doc>;
}

export const emptyDoc = (): Doc => ({ type: "doc", content: [] });
export const emptyContent = (): PostmortemContent => ({ sections: {} });

const para = (text: string): DocNode =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
export const docFromParagraphs = (lines: string[]): Doc => ({
  type: "doc",
  content: lines.filter((l) => l.trim()).map((l) => para(l.trim())),
});
export const docFromBullets = (lines: string[]): Doc => ({
  type: "doc",
  content: lines.length
    ? [{ type: "bulletList", content: lines.map((l) => ({ type: "listItem", content: [para(l)] })) }]
    : [],
});

// ---- validation -------------------------------------------------------------------------------------------------

/** Which attributes each node/mark may carry. A type missing from here is not allowed at all. */
const NODE_ATTRS: Record<string, readonly string[]> = {
  doc: [],
  paragraph: [],
  text: [],
  heading: ["level"],
  bulletList: [],
  orderedList: ["start", "type"],
  listItem: [],
  blockquote: [],
  codeBlock: ["language"],
  hardBreak: [],
};
const MARK_ATTRS: Record<string, readonly string[]> = {
  bold: [],
  italic: [],
  code: [],
  link: ["href", "target", "rel", "class"],
};
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length === 0 || href.length > 2048) return false;
  if (/[\u0000-\u001f\u007f\s]/.test(href)) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol.toLowerCase());
  } catch {
    return false; // relative or malformed
  }
}

export type DocProblem =
  | "not_a_document"
  | "unknown_node"
  | "unknown_mark"
  | "bad_attribute"
  | "unsafe_link"
  | "bad_heading_level"
  | "too_deep"
  | "too_many_nodes"
  | "bad_text";

class Reject extends Error {
  constructor(readonly problem: DocProblem) {
    super(problem);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkAttrs(attrs: unknown, allowed: readonly string[]) {
  if (attrs === undefined || attrs === null) return;
  if (!isRecord(attrs)) throw new Reject("bad_attribute");
  for (const key of Object.keys(attrs)) if (!allowed.includes(key)) throw new Reject("bad_attribute");
}

function checkNode(node: unknown, depth: number, counter: { n: number }): void {
  if (!isRecord(node) || typeof node.type !== "string") throw new Reject("not_a_document");
  if (depth > MAX_DEPTH) throw new Reject("too_deep");
  if (++counter.n > MAX_NODES) throw new Reject("too_many_nodes");
  const allowed = Object.hasOwn(NODE_ATTRS, node.type) ? NODE_ATTRS[node.type] : null;
  if (!allowed) throw new Reject("unknown_node");
  for (const key of Object.keys(node)) {
    if (!["type", "attrs", "content", "marks", "text"].includes(key)) throw new Reject("not_a_document");
  }
  checkAttrs(node.attrs, allowed);
  if (node.type === "heading") {
    const level = isRecord(node.attrs) ? node.attrs.level : undefined;
    if (level !== 3) throw new Reject("bad_heading_level");
  }
  if (node.type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) throw new Reject("bad_text");
    if (node.content !== undefined) throw new Reject("not_a_document");
  } else if (node.text !== undefined) {
    throw new Reject("bad_text");
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks) || node.type !== "text") throw new Reject("unknown_mark");
    for (const mark of node.marks) {
      if (!isRecord(mark) || typeof mark.type !== "string") throw new Reject("unknown_mark");
      const markAllowed = Object.hasOwn(MARK_ATTRS, mark.type) ? MARK_ATTRS[mark.type] : null;
      if (!markAllowed) throw new Reject("unknown_mark");
      checkAttrs(mark.attrs, markAllowed);
      if (mark.type === "link") {
        const attrs = isRecord(mark.attrs) ? mark.attrs : {};
        if (!isSafeHref(attrs.href)) throw new Reject("unsafe_link");
        for (const k of ["target", "rel", "class"]) {
          const v = attrs[k];
          if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 100))
            throw new Reject("bad_attribute");
        }
      }
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new Reject("not_a_document");
    for (const child of node.content) checkNode(child, depth + 1, counter);
  }
}

export function validateDoc(value: unknown): { ok: true; doc: Doc } | { ok: false; problem: DocProblem } {
  try {
    if (!isRecord(value) || value.type !== "doc") return { ok: false, problem: "not_a_document" };
    checkNode(value, 0, { n: 0 });
    return { ok: true, doc: value as unknown as Doc };
  } catch (err) {
    if (err instanceof Reject) return { ok: false, problem: err.problem };
    throw err;
  }
}

export type ContentProblem =
  | { code: "too_large" }
  | { code: "too_many_sections" }
  | { code: "unknown_section"; key: string }
  | { code: "invalid_document"; key: string; problem: DocProblem }
  | { code: "not_content" };

const encoder = new TextEncoder();
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Validates a `{ sections: { key: doc } }` payload (or a partial one, for PATCH). `allowedKeys` are the sections of the
 * postmortem's template; a key outside it is rejected.
 */
export function validateContent(
  value: unknown,
  allowedKeys: readonly string[],
): { ok: true; sections: Record<string, Doc> } | { ok: false; error: ContentProblem } {
  if (!isRecord(value)) return { ok: false, error: { code: "not_content" } };
  // size first, so a huge payload costs one stringify rather than a deep walk
  let bytes: number;
  try {
    bytes = encoder.encode(JSON.stringify(value)).length;
  } catch {
    return { ok: false, error: { code: "not_content" } };
  }
  if (bytes > MAX_CONTENT_BYTES) return { ok: false, error: { code: "too_large" } };
  const keys = Object.keys(value);
  if (keys.length > MAX_SECTIONS) return { ok: false, error: { code: "too_many_sections" } };
  const sections: Record<string, Doc> = {};
  for (const key of keys) {
    if (!sectionKeyPattern.test(key) || !allowedKeys.includes(key)) {
      return { ok: false, error: { code: "unknown_section", key } };
    }
    const checked = validateDoc(value[key]);
    if (!checked.ok) return { ok: false, error: { code: "invalid_document", key, problem: checked.problem } };
    sections[key] = checked.doc;
  }
  return { ok: true, sections };
}

/** Reads stored content defensively: anything malformed in the database counts as an empty section. */
export function readContent(stored: unknown): PostmortemContent {
  const out: PostmortemContent = { sections: {} };
  if (!isRecord(stored) || !isRecord(stored.sections)) return out;
  for (const [key, doc] of Object.entries(stored.sections)) {
    const checked = validateDoc(doc);
    if (checked.ok) out.sections[key] = checked.doc;
  }
  return out;
}

// ---- reading a document -----------------------------------------------------------------------------------------

function textOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(textOf).join("");
}

/** Plain text, blocks separated by a newline. */
export function docText(doc: Doc | undefined): string {
  if (!doc) return "";
  return (doc.content ?? []).map(textOf).join("\n");
}

export const isMeaningful = (doc: Doc | undefined) => docText(doc).trim().length >= MEANINGFUL_CHARS;

export type SectionProgress = "empty" | "started" | "complete";
export function sectionProgress(doc: Doc | undefined): SectionProgress {
  const len = docText(doc).trim().length;
  if (len === 0) return "empty";
  return len >= MEANINGFUL_CHARS ? "complete" : "started";
}

// ---- markdown ----------------------------------------------------------------------------------------------------

function inlineMarkdown(node: DocNode): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type !== "text") return (node.content ?? []).map(inlineMarkdown).join("");
  let out = node.text ?? "";
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  if (marks.has("code")) out = `\`${out}\``;
  if (marks.has("bold")) out = `**${out}**`;
  if (marks.has("italic")) out = `*${out}*`;
  const link = (node.marks ?? []).find((m) => m.type === "link");
  if (link && typeof link.attrs?.href === "string") out = `[${out}](${link.attrs.href})`;
  return out;
}

function blockMarkdown(node: DocNode, indent = ""): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return indent + children.map(inlineMarkdown).join("");
    case "heading":
      return `### ${children.map(inlineMarkdown).join("")}`;
    case "blockquote":
      return children
        .map((c) => blockMarkdown(c))
        .join("\n\n")
        .split("\n")
        .map((l) => `> ${l}`.trimEnd())
        .join("\n");
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${lang}\n${children.map((c) => c.text ?? "").join("")}\n\`\`\``;
    }
    case "bulletList":
    case "orderedList": {
      const start = node.type === "orderedList" && typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return children
        .map((item, i) => {
          const marker = node.type === "bulletList" ? "-" : `${start + i}.`;
          const [first, ...rest] = (item.content ?? []).map((c) => blockMarkdown(c));
          const pad = " ".repeat(marker.length + 1);
          const body = [
            first ?? "",
            ...rest.map((r) =>
              r
                .split("\n")
                .map((l) => pad + l)
                .join("\n"),
            ),
          ].join("\n");
          return `${indent}${marker} ${body}`;
        })
        .join("\n");
    }
    default:
      return children.map((c) => blockMarkdown(c)).join("\n\n");
  }
}

export function docToMarkdown(doc: Doc | undefined): string {
  return (doc?.content ?? [])
    .map((n) => blockMarkdown(n))
    .filter((s) => s.trim() !== "")
    .join("\n\n");
}
