import { AsyncLocalStorage } from "node:async_hooks";

export type TestUser = { id: string; email: string; name: string } | null;

const als = new AsyncLocalStorage<{ user: TestUser }>();

/** Read by the mocked getSession(): "who is signed in" for the request currently being handled. */
export const currentTestUser = () => als.getStore()?.user ?? null;

/** Mail captured by the mocked sendEmail, newest last. Look up by recipient (unique per test). */
export const mailbox: { to: string; subject: string; text: string }[] = [];

export function inviteTokenSentTo(email: string): string {
  const mail = [...mailbox].reverse().find((m) => m.to === email);
  const token = mail && /\/invite\/([\w-]+)/.exec(mail.text)?.[1];
  if (!token) throw new Error(`no invite mail captured for ${email}`);
  return token;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;

/** Invoke a route handler directly, as `user` (null = signed out). Returns status + parsed JSON. */
export async function call(user: TestUser, handler: Handler, path: string, options: CallOptions = {}) {
  const hasBody = options.body !== undefined;
  const request = new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const response = await als.run({ user }, () => handler(request, { params: Promise.resolve(options.params ?? {}) }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
