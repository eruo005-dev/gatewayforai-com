/** OpenAI chat-completions <-> Anthropic Messages translation (text + tool calling). */

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p as { text?: string }).text ?? "").join("");
  return "";
}

function mapStop(reason: string | null | undefined): string {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return "stop"; // end_turn, stop_sequence, anything else
}

function safeJsonParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

type OpenAITool = { type?: string; function?: { name: string; description?: string; parameters?: unknown } };
type OpenAIToolChoice = string | { type?: string; function?: { name?: string } };

/** OpenAI tools -> Anthropic tools. Returns undefined when absent. */
function mapTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return (tools as OpenAITool[]).map((t) => {
    const fn = t.function ?? ({} as NonNullable<OpenAITool["function"]>);
    return {
      name: fn.name,
      ...(fn.description !== undefined && { description: fn.description }),
      input_schema: fn.parameters ?? { type: "object", properties: {} },
    };
  });
}

/** OpenAI tool_choice -> Anthropic tool_choice. Returns undefined when absent/none. */
function mapToolChoice(tc: OpenAIToolChoice | undefined): Record<string, unknown> | undefined {
  if (tc === undefined || tc === null) return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (tc === "none") return undefined;
  if (typeof tc === "object" && tc.type === "function" && tc.function?.name) {
    return { type: "tool", name: tc.function.name };
  }
  return undefined;
}

type OAMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

/** Translate OpenAI messages (excluding system) into Anthropic messages, merging consecutive tool results. */
function mapMessages(messages: OAMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: contentText(m.content),
      };
      // Merge into a preceding user message that holds only tool_result blocks.
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.role === "user" &&
        Array.isArray(prev.content) &&
        (prev.content as Array<{ type?: string }>).every((b) => b.type === "tool_result")
      ) {
        (prev.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      const text = contentText(m.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function?.name,
          input: safeJsonParse(tc.function?.arguments),
        });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    out.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: contentText(m.content),
    });
  }
  return out;
}

export function toAnthropicBody(body: Record<string, any>): Record<string, any> {
  const messages = (body.messages ?? []) as OAMessage[];
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");

  // tool_choice "none" means: strip tools entirely (Anthropic has no field equivalent we use).
  const stripTools = body.tool_choice === "none";
  const tools = stripTools ? undefined : mapTools(body.tools);
  const toolChoice = mapToolChoice(body.tool_choice);

  return {
    model: body.model,
    ...(system && { system }),
    messages: mapMessages(messages),
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...(body.stop && { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] }),
    ...(tools && { tools }),
    ...(toolChoice && { tool_choice: toolChoice }),
    ...(body.stream && { stream: true }),
  };
}

export function fromAnthropicResponse(a: Record<string, any>, model: string): Record<string, any> {
  const input = a.usage?.input_tokens ?? 0;
  const output = a.usage?.output_tokens ?? 0;
  const blocks = (a.content ?? []) as Array<Record<string, any>>;

  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  const message: Record<string, any> = {
    role: "assistant",
    // OpenAI convention: content is null when only tool calls are present.
    content: toolCalls.length > 0 && text === "" ? null : text,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: a.id ?? "chatcmpl-gw",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
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

  // Map Anthropic content-block index -> OpenAI tool_calls array index (counts tool_use blocks only).
  const toolIndexByBlock = new Map<number, number>();
  let nextToolIndex = 0;

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

  const processLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) return;
    let evt: Record<string, any>;
    try { evt = JSON.parse(line.slice(5).trim()); } catch { return; }

    if (evt.type === "message_start") {
      controller.enqueue(frame({ role: "assistant", content: "" }));
    } else if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
      const toolIndex = nextToolIndex++;
      toolIndexByBlock.set(evt.index, toolIndex);
      controller.enqueue(
        frame({
          tool_calls: [
            {
              index: toolIndex,
              id: evt.content_block.id,
              type: "function",
              function: { name: evt.content_block.name, arguments: "" },
            },
          ],
        }),
      );
    } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      controller.enqueue(frame({ content: evt.delta.text }));
    } else if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta") {
      const toolIndex = toolIndexByBlock.get(evt.index) ?? 0;
      controller.enqueue(
        frame({
          tool_calls: [{ index: toolIndex, function: { arguments: evt.delta.partial_json } }],
        }),
      );
    } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
      controller.enqueue(frame({}, mapStop(evt.delta.stop_reason)));
    } else if (evt.type === "message_stop") {
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
    }
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(part, controller) {
        buffer += dec.decode(part, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line, controller);
      },
      flush(controller) {
        const remaining = buffer.trim();
        if (remaining) processLine(remaining, controller);
      },
    }),
  );
}
