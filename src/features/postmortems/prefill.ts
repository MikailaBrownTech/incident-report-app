import { isSafeHref, type Doc, type DocMark, type DocNode } from "./content";

/**
 * Turns the incident's markdown summary into a rich-text document, so it can be edited in the postmortem. Handles what
 * the incident summary realistically contains: paragraphs, headings (demoted to level 3), bullet and numbered lists,
 * quotes, fenced code, and bold / italic / code / link inline marks. Anything fancier stays as plain text.
 * Pure: produces only nodes the content allowlist accepts.
 */

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\))/g;

function inline(text: string): DocNode[] {
  const nodes: DocNode[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    let node: DocNode;
    const marks: DocMark[] = [];
    let m: RegExpExecArray | null;
    if ((m = /^\*\*([^*\n]+)\*\*$/.exec(part))) {
      node = { type: "text", text: m[1] };
      marks.push({ type: "bold" });
    } else if ((m = /^`([^`\n]+)`$/.exec(part))) {
      node = { type: "text", text: m[1] };
      marks.push({ type: "code" });
    } else if ((m = /^\*([^*\n]+)\*$/.exec(part))) {
      node = { type: "text", text: m[1] };
      marks.push({ type: "italic" });
    } else if ((m = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$/.exec(part))) {
      node = { type: "text", text: m[1] };
      if (isSafeHref(m[2])) marks.push({ type: "link", attrs: { href: m[2] } });
    } else {
      node = { type: "text", text: part };
    }
    if (marks.length) node.marks = marks;
    nodes.push(node);
  }
  return nodes;
}

const paragraph = (text: string): DocNode => ({ type: "paragraph", content: inline(text) });

export function markdownToDoc(markdown: string): Doc {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: DocNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      const code: DocNode = { type: "codeBlock", attrs: { language: fence[1] || null } };
      if (body.length) code.content = [{ type: "text", text: body.join("\n") }];
      content.push(code);
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      content.push({ type: "heading", attrs: { level: 3 }, content: inline(heading[1].trim()) });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      const items: DocNode[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push({ type: "listItem", content: [paragraph(lines[i].replace(marker, "").trim())] });
        i += 1;
      }
      content.push({
        type: ordered ? "orderedList" : "bulletList",
        ...(ordered ? { attrs: { start: 1 } } : {}),
        content: items,
      });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ""));
      content.push({ type: "blockquote", content: [paragraph(quoted.join(" ").trim())] });
      continue;
    }
    // a paragraph runs until a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    content.push(paragraph(para.join(" ")));
  }
  return { type: "doc", content };
}

/** "2026-06-10 10:05 UTC": unambiguous in a document that will be read in other time zones. */
export const stampUtc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
