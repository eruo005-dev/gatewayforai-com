/** OpenAI chat-completions <-> Anthropic Messages translation. Text-only (v1). */

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p as { text?: string }).text ?? "").join("");
  return "";
}

function mapStop(reason: string | null | undefined): string {
  if (reason === "max_tokens") return "length";
  return "stop"; // end_turn, stop_sequence, anything else
}

export function toAnthropicBody(body: Record<string, any>): Record<string, any> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");
  return {
    model: body.model,
    ...(system && { system }),
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: contentText(m.content),
      })),
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...(body.stop && { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] }),
    ...(body.stream && { stream: true }),
  };
}

export function fromAnthropicResponse(a: Record<string, any>, model: string): Record<string, any> {
  const input = a.usage?.input_tokens ?? 0;
  const output = a.usage?.output_tokens ?? 0;
  return {
    id: a.id ?? "chatcmpl-gw",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: ((a.content ?? []) as Array<{ text?: string }>).map((b) => b.text ?? "").join(""),
        },
        finish_reason: mapStop(a.stop_reason),
      },
    ],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

/** Re-emits an Anthropic SSE stream as OpenAI chat.completion.chunk SSE frames. */
export function translateAnthropicSSE(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = "";
  const id = "chatcmpl-gw" + Math.random().toString(36).slice(2, 10);
  const created = Math.floor(Date.now() / 1000);

  const frame = (delta: object, finish: string | null = null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(part, controller) {
        buffer += dec.decode(part, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let evt: Record<string, any>;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "message_start") {
            controller.enqueue(frame({ role: "assistant", content: "" }));
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            controller.enqueue(frame({ content: evt.delta.text }));
          } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
            controller.enqueue(frame({}, mapStop(evt.delta.stop_reason)));
          } else if (evt.type === "message_stop") {
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
          }
        }
      },
    }),
  );
}
