import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text; also used as the dev-console fallback. */
  text: string;
  html: string;
}

/**
 * Sends through Resend when RESEND_API_KEY is set. Otherwise (development only) the
 * message is printed to the server console, so magic links work with zero setup.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "The Crypt <onboarding@resend.dev>",
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
    return;
  }

  // E2E_OUTBOX lets the Playwright run (a production build) read links from disk; never set it in real deployments.
  if (process.env.NODE_ENV === "production" && !process.env.E2E_OUTBOX) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  console.log(`\n[email → ${message.to}] ${message.subject}\n${message.text}\n`);
  // Also drop the latest message per recipient on disk so e2e tests can read links.
  const dir = join(process.cwd(), ".dev-outbox");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${message.to.replace(/[^a-z0-9@._-]/gi, "_")}.json`), JSON.stringify(message));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One button, one paragraph. All wording is passed in from the copy dictionary. */
export function buildActionEmail(input: {
  to: string;
  subject: string;
  body: string;
  button: string;
  url: string;
  footer: string;
}): EmailMessage {
  const { to, subject, body, button, url, footer } = input;
  return {
    to,
    subject,
    text: `${body}\n\n${button}: ${url}\n\n${footer}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px">
<p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#2f4fd0;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="color:#555;font-size:13px">${escapeHtml(footer)}</p></div>`,
  };
}
