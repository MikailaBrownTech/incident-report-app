import { docToMarkdown, type Doc } from "./content";

/**
 * The whole postmortem as markdown, for pasting into Notion or Confluence. Sections follow the template's order;
 * empty sections are left out. Pure: the caller supplies the words (section titles come from the active skin).
 */
export function postmortemToMarkdown(input: {
  heading: string;
  meta?: string[];
  sections: { key: string; title: string }[];
  content: Record<string, Doc>;
  /** Appended as a checklist under `actionItems.heading`; checked when done. */
  actionItems?: {
    heading: string;
    items: { title: string; done: boolean; wontDo?: string | null; owner?: string; due?: string | null }[];
  };
}): string {
  const parts = [`# ${input.heading}`];
  if (input.meta?.length) parts.push(input.meta.join("  \n"));
  for (const section of input.sections) {
    const body = docToMarkdown(input.content[section.key]);
    if (body.trim()) parts.push(`## ${section.title}\n\n${body}`);
  }
  const list = input.actionItems;
  if (list && list.items.length > 0) {
    const lines = list.items.map((i) => {
      const detail = [i.owner, i.due ? `due ${i.due}` : null].filter(Boolean).join(", ");
      const text = i.wontDo !== undefined && i.wontDo !== null ? `~~${i.title}~~ (${i.wontDo})` : i.title;
      return `- [${i.done ? "x" : " "}] ${text}${detail ? ` (${detail})` : ""}`;
    });
    parts.push(`## ${list.heading}\n\n${lines.join("\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}
