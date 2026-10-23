const API_URL = "https://api.anthropic.com/v1/messages";

export class AiUnavailableError extends Error {}
export class AiRequestError extends Error {}

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** One-shot text completion through the Messages API. The key never leaves the server. */
export async function generateText(input: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiUnavailableError("ANTHROPIC_API_KEY is not set");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: input.maxTokens ?? 1500,
      output_config: { effort: "low" }, // thinking counts against max_tokens: keep it small so the text is never crowded out
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: unknown) => {
    throw new AiRequestError(e instanceof Error ? e.message : "request failed");
  });
  if (!response.ok) throw new AiRequestError(`Anthropic API returned ${response.status}`);

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiRequestError("empty response");
  return text;
}
