import { Fragment, type ReactNode } from "react";
import { isSafeHref, type Doc, type DocNode } from "@/features/postmortems/content";

/**
 * Renders a stored document read-only. Builds React elements from the validated node types only (no HTML strings),
 * and re-checks link targets, so even content that somehow predates the allowlist can't inject markup.
 */

function marked(node: DocNode, key: number): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "code")
      out = <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]">{out}</code>;
    else if (mark.type === "link" && isSafeHref(mark.attrs?.href)) {
      out = (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
          {out}
        </a>
      );
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function inline(nodes: DocNode[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => (n.type === "hardBreak" ? <br key={i} /> : marked(n, i)));
}

function block(node: DocNode, key: number): ReactNode {
  const kids = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return kids.length ? <p key={key}>{inline(kids)}</p> : null;
    case "heading":
      return (
        <h3 key={key} className="mt-4 text-base font-semibold">
          {inline(kids)}
        </h3>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc space-y-1 pl-6">
          {kids.map((item, i) => (
            <li key={i}>{item.content?.map((c, j) => block(c, j))}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol
          key={key}
          className="list-decimal space-y-1 pl-6"
          start={typeof node.attrs?.start === "number" ? node.attrs.start : 1}
        >
          {kids.map((item, i) => (
            <li key={i}>{item.content?.map((c, j) => block(c, j))}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-4 border-border pl-4 text-muted">
          {kids.map((c, i) => block(c, i))}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className="overflow-x-auto rounded border border-border bg-surface p-3 font-mono text-sm">
          <code>{kids.map((c) => c.text ?? "").join("")}</code>
        </pre>
      );
    default:
      return null;
  }
}

export function RichTextView({ doc }: { doc: Doc | undefined }) {
  return <div className="space-y-3 leading-relaxed">{(doc?.content ?? []).map((n, i) => block(n, i))}</div>;
}
