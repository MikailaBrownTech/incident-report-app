import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";

/** Only these link targets survive: web links, mail links, in-page anchors and same-site paths. */
const SAFE_URL = /^(https?:|mailto:)/i;
const isRelative = (url: string) => url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//"));

/** Anything else (javascript:, data:, vbscript:, protocol-relative //host, ...) becomes an empty URL. */
export function safeUrl(url: string): string {
  const trimmed = url.trim();
  // Browsers ignore control characters and whitespace inside the scheme ("java\tscript:"), so reject those outright.
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return "";
  return SAFE_URL.test(trimmed) || isRelative(trimmed) ? trimmed : "";
}

const heading = (Tag: "h3" | "h4" | "h5") =>
  function Heading({ children }: { children?: ReactNode }) {
    return <Tag className="mb-2 mt-4 font-semibold">{children}</Tag>;
  };

/**
 * Renders user-written markdown safely: raw HTML is dropped (never rendered), links are limited to
 * http(s)/mailto/relative and open in a new tab without referrer, and images are not loaded at all
 * (no tracking pixels). Headings are demoted so the page keeps a single h1.
 */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div
      className={`max-w-prose break-words [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-bg [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_pre]:mb-3 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-bg [&_pre]:p-3 [&_pre_code]:bg-transparent [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 ${className}`}
    >
      <ReactMarkdown
        skipHtml
        urlTransform={safeUrl}
        components={{
          h1: heading("h3"),
          h2: heading("h3"),
          h3: heading("h4"),
          h4: heading("h5"),
          h5: heading("h5"),
          h6: heading("h5"),
          img: () => null,
          a: ({ href, children }: ComponentPropsWithoutRef<"a">) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-accent underline underline-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
