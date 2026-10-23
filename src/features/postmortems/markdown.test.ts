import { describe, expect, it } from "vitest";
import { docFromBullets, docFromParagraphs } from "./content";
import { postmortemToMarkdown } from "./markdown";

describe("postmortemToMarkdown", () => {
  const sections = [
    { key: "summary", title: "Summary" },
    { key: "impact", title: "Impact" },
    { key: "lessons", title: "What we learned" },
  ];

  it("writes a heading, the meta lines, then each non-empty section in template order", () => {
    const md = postmortemToMarkdown({
      heading: "INC-5: Checkout down",
      meta: ["High", "Published by Priya"],
      sections,
      content: {
        lessons: docFromBullets(["Add a timeout", "Alert on pool use"]),
        summary: docFromParagraphs(["It broke.", "Then we fixed it."]),
      },
    });
    expect(md).toBe(
      [
        "# INC-5: Checkout down",
        "High  \nPublished by Priya",
        "## Summary\n\nIt broke.\n\nThen we fixed it.",
        "## What we learned\n\n- Add a timeout\n- Alert on pool use",
      ].join("\n\n") + "\n",
    );
  });

  it("leaves out empty and missing sections, and works without meta", () => {
    const md = postmortemToMarkdown({
      heading: "H",
      sections,
      content: { summary: docFromParagraphs(["  "]), impact: docFromParagraphs(["Real."]) },
    });
    expect(md).toBe("# H\n\n## Impact\n\nReal.\n");
  });
});
