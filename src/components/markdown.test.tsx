// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown, safeUrl } from "./markdown";

afterEach(cleanup);
const html = (source: string) => render(<Markdown source={source} />).container;

describe("Markdown", () => {
  it("renders ordinary markdown", () => {
    const c = html("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted");
    expect(c.querySelector("strong")).toHaveTextContent("bold");
    expect(c.querySelector("code")).toHaveTextContent("code");
    expect(c.querySelectorAll("ul li")).toHaveLength(2);
    expect(c.querySelectorAll("ol li")).toHaveLength(2);
    expect(c.querySelector("blockquote")).toHaveTextContent("quoted");
  });

  it("demotes headings so the page keeps a single h1", () => {
    const c = html("# One\n## Two\n### Three\n#### Four");
    expect(c.querySelector("h1")).toBeNull();
    expect(c.querySelector("h2")).toBeNull();
    expect(c.querySelectorAll("h3")).toHaveLength(2);
    expect(c.querySelectorAll("h4")).toHaveLength(1);
    expect(c.querySelectorAll("h5")).toHaveLength(1);
  });

  it("drops script tags and every other raw HTML element", () => {
    const c = html(
      'Before <script>window.hacked = 1</script> after\n\n<img src=x onerror="window.hacked=1">\n\n<iframe src="https://evil.test"></iframe>\n\n<div onclick="x()">block</div>\n\n<style>body{display:none}</style>',
    );
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("iframe")).toBeNull();
    expect(c.querySelector("style")).toBeNull();
    expect(c.querySelector("[onclick]")).toBeNull();
    expect(c.querySelector("[onerror]")).toBeNull();
    expect(c.innerHTML).not.toMatch(/<script|onerror|onclick|<iframe|<style/i);
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
    expect(c).toHaveTextContent("Before");
    expect(c).toHaveTextContent("after");
  });

  it("removes unsafe link targets but keeps the link text", () => {
    const unsafe = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.test/x",
      "\\\\evil.test\\x",
    ];
    for (const href of unsafe) {
      const c = html(`[click me](<${href}>)`);
      expect(c.querySelector("a"), href).toBeNull();
      expect(c).toHaveTextContent("click me");
      cleanup();
    }
  });

  it("keeps safe links and opens them without leaking the referrer or opener", () => {
    const c = html("[web](https://example.com/a?b=1) [mail](mailto:a@example.com) [in page](#top) [site](/app/acme)");
    const links = [...c.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a?b=1",
      "mailto:a@example.com",
      "#top",
      "/app/acme",
    ]);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
  });

  it("never loads images (no tracking pixels), even from markdown syntax", () => {
    const c = html("![pixel](https://tracker.test/p.gif) and ![x](javascript:alert(1))");
    expect(c.querySelector("img")).toBeNull();
    expect(c.innerHTML).not.toContain("tracker.test");
  });

  it("autolinks don't smuggle in bad schemes", () => {
    const c = html("<javascript:alert(1)> <https://ok.test>");
    expect([...c.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://ok.test"]);
  });

  it("handles empty input and plain text", () => {
    expect(html("").textContent).toBe("");
    render(<Markdown source="just text" />);
    expect(screen.getByText("just text")).toBeInTheDocument();
  });
});

describe("safeUrl", () => {
  it("allows only web, mail, anchors and same-site paths", () => {
    for (const ok of ["https://a.test", "http://a.test", "HTTPS://A.TEST", "mailto:a@b.test", "#x", "/path", "/"]) {
      expect(safeUrl(ok), ok).toBe(ok);
    }
    for (const bad of [
      "javascript:x",
      "data:x",
      "//a.test",
      "ftp://a.test",
      "a b",
      "x\ny",
      "",
      "relative/path",
      "tel:123",
    ]) {
      expect(safeUrl(bad), JSON.stringify(bad)).toBe("");
    }
    expect(safeUrl("  https://a.test  ")).toBe("https://a.test");
  });
});
