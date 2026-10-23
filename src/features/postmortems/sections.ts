/**
 * Built-in postmortem templates. Pure and browser-safe. The same definitions are inserted into the database by the
 * `postmortems` migration (fixed ids); a DB test keeps the two equal. Section titles and blameless prompts are not
 * stored: they come from the copy dictionary (`t.postmortem.sections[key]`), per skin.
 */

export const SECTION_KEYS = [
  "summary",
  "impact",
  "root_cause",
  "detection",
  "response",
  "timeline",
  "went_well",
  "went_wrong",
  "lucky",
  "lessons",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface TemplateSection {
  key: string;
  required: boolean;
  order: number;
}

export interface TemplateView {
  id: string;
  name: string;
  isDefault: boolean;
  builtIn: boolean;
  sections: TemplateSection[];
}

export const STANDARD_TEMPLATE_ID = "tpl_standard";
export const QUICK_TEMPLATE_ID = "tpl_quick";

const sections = (rows: [string, boolean][]): TemplateSection[] =>
  rows.map(([key, required], order) => ({ key, required, order }));

export const BUILT_IN_TEMPLATES: TemplateView[] = [
  {
    id: STANDARD_TEMPLATE_ID,
    name: "Standard autopsy",
    isDefault: true,
    builtIn: true,
    sections: sections([
      ["summary", true],
      ["impact", true],
      ["root_cause", true],
      ["detection", false],
      ["response", false],
      ["timeline", false],
      ["went_well", false],
      ["went_wrong", false],
      ["lucky", false],
      ["lessons", true],
    ]),
  },
  {
    id: QUICK_TEMPLATE_ID,
    name: "Quick review",
    isDefault: false,
    builtIn: true,
    sections: sections([
      ["summary", true],
      ["root_cause", true],
      ["lessons", true],
    ]),
  },
];

/** Standard for severity 3 and up, Quick review for 1 and 2. */
export const defaultTemplateIdFor = (severity: number) => (severity >= 3 ? STANDARD_TEMPLATE_ID : QUICK_TEMPLATE_ID);

export const builtInTemplate = (id: string) => BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? null;
