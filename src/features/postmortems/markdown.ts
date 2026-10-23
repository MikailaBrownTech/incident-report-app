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
}): string {
  const parts = [`# ${input.heading}`];
  if (input.meta?.length) parts.push(input.meta.join("  \n"));
  for (const section of input.sections) {
    const body = docToMarkdown(input.content[section.key]);
    if (body.trim()) parts.push(`## ${section.title}\n\n${body}`);
  }
  return `${parts.join("\n\n")}\n`;
}
