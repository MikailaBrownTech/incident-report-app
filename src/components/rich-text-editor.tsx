"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Code2, Heading3, Italic, Link2, List, ListOrdered, Quote } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useCopy } from "@/copy/provider";
import { isSafeHref, type Doc } from "@/features/postmortems/content";

export interface RichTextEditorProps {
  /** The content when the editor mounts. Remount (change `key`) to replace it from outside. */
  doc: Doc | undefined;
  onChange: (doc: Doc) => void;
  onBlur?: () => void;
  /** Accessible name of the editing area. */
  label: string;
  /** Marks the area as failing validation (a required section that is too short). */
  invalid?: boolean;
}

/**
 * Only what the server accepts: paragraphs, level-3 headings, bold, italic, inline code, links (http, https, mailto),
 * bullet and numbered lists, quotes and code blocks. Everything else StarterKit offers is switched off, so the editor
 * can't produce a document the server would refuse.
 */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [3] },
    strike: false,
    underline: false,
    horizontalRule: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      validate: (href: string) => isSafeHref(href),
    },
  }),
];

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      // keep the selection in the editor when the button is pressed
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded border p-1.5 ${pressed ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ doc, onChange, onBlur, label, invalid }: RichTextEditorProps) {
  const t = useCopy();
  // The handlers change every render; the editor is created once, so it reads the latest through refs.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
  });

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: doc ?? { type: "doc", content: [] },
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON() as Doc),
    onBlur: () => onBlurRef.current?.(),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        ...(invalid ? { "aria-invalid": "true" } : {}),
        class:
          "min-h-24 max-w-none space-y-3 p-3 leading-relaxed outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_pre]:rounded [&_pre]:bg-surface [&_pre]:p-3 [&_pre]:font-mono [&_code]:font-mono [&_a]:text-accent [&_a]:underline [&_h3]:text-base [&_h3]:font-semibold",
      },
    },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      code: e?.isActive("code") ?? false,
      link: e?.isActive("link") ?? false,
      heading: e?.isActive("heading", { level: 3 }) ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
    }),
  });

  if (!editor) {
    return <div className="min-h-24 rounded border border-border bg-surface" aria-hidden="true" />;
  }

  const run = () => editor.chain().focus();
  function setLink() {
    if (!editor) return;
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    const href = window.prompt(t.postmortem.toolbar.linkPrompt, previous);
    if (href === null) return;
    if (href.trim() === "") {
      run().extendMarkRange("link").unsetLink().run();
    } else if (isSafeHref(href.trim())) {
      run().extendMarkRange("link").setLink({ href: href.trim() }).run();
    }
  }
  const tb = t.postmortem.toolbar;

  return (
    <div
      className={`rounded border bg-surface focus-within:border-accent ${invalid ? "border-danger" : "border-border"}`}
    >
      <div role="toolbar" aria-label={tb.label} className="flex flex-wrap gap-1 border-b border-border p-1.5">
        <ToolbarButton label={tb.bold} pressed={active?.bold ?? false} onClick={() => run().toggleBold().run()}>
          <Bold aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton label={tb.italic} pressed={active?.italic ?? false} onClick={() => run().toggleItalic().run()}>
          <Italic aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton label={tb.code} pressed={active?.code ?? false} onClick={() => run().toggleCode().run()}>
          <Code aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton label={tb.link} pressed={active?.link ?? false} onClick={setLink}>
          <Link2 aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={tb.heading}
          pressed={active?.heading ?? false}
          onClick={() => run().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={tb.bulletList}
          pressed={active?.bulletList ?? false}
          onClick={() => run().toggleBulletList().run()}
        >
          <List aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={tb.orderedList}
          pressed={active?.orderedList ?? false}
          onClick={() => run().toggleOrderedList().run()}
        >
          <ListOrdered aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={tb.quote}
          pressed={active?.blockquote ?? false}
          onClick={() => run().toggleBlockquote().run()}
        >
          <Quote aria-hidden="true" className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={tb.codeBlock}
          pressed={active?.codeBlock ?? false}
          onClick={() => run().toggleCodeBlock().run()}
        >
          <Code2 aria-hidden="true" className="size-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
