/**
 * Anthropic Messages <-> OpenAI chat-completions translation (inbound endpoint).
 * Mirror image of src/lib/providers/anthropic.ts (the outbound translator).
 *
 * fromAnthropicRequest:  Anthropic request body  -> OpenAI chat-completions body
 * toAnthropicResponse:   OpenAI completion        -> Anthropic Messages response
 * toAnthropicSSE:        OpenAI chunk SSE stream  -> Anthropic event SSE stream
 */

/** Flatten Anthropic content (string OR array of {type,text} blocks) to a plain string. */
function flattenContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p as { text?: string }).text ?? "").join("");
  return "";
}

/** OpenAI finish_reason -> Anthropic stop_reason. */
function mapStopReason(reason: string | null | undefined): string {
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  return "end_turn";
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

type AnthBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
};

type AnthMessage = { role: string; content?: unknown };

type AnthTool = { name: string; description?: string; input_schema?: unknown };
type AnthToolChoice = { type?: string; name?: string };

/** Anthropic tools -> OpenAI tools. Returns undefined when absent. */
function mapTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return (tools as AnthTool[]).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      ...(t.description !== undefined && { description: t.description }),
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

/** Anthropic tool_choice -> OpenAI tool_choice. Returns undefined when absent. */
function mapToolChoice(tc: AnthToolChoice | undefined | null): unknown {
  if (tc == null || typeof tc !== "object") return undefined;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && tc.name) return { type: "function", function: { name: tc.name } };
  return undefined;
}

/** Translate a single Anthropic message into one or more OpenAI messages. */
function mapMessage(m: AnthMessage): Array<Record<string, any>> {
  const content = m.content;

  // Plain string content -> pass through unchanged.
  if (typeof content === "string") {
    return [{ role: m.role, content }];
  }
  if (!Array.isArray(content)) {
    return [{ role: m.role, content: "" }];
  }

  const blocks = content as AnthBlock[];

  if (m.role === "assistant") {
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (toolUses.length > 0) {
      const msg: Record<string, any> = {
        role: "assistant",
        content: text === "" ? null : text,
        tool_calls: toolUses.map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        })),
      };
      return [msg];
    }
    return [{ role: "assistant", content: text }];
  }

  // user role: tool_result blocks become role:"tool" messages (one each, emitted
  // first); remaining text blocks collapse into a trailing user message.
  const out: Array<Record<string, any>> = [];
  const toolResults = blocks.filter((b) => b.type === "tool_result");
  for (const b of toolResults) {
    out.push({
      role: "tool",
      tool_call_id: b.tool_use_id,
      content: flattenContent(b.content),
    });
  }
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (toolResults.length === 0) {
    // No tool_result blocks -> a normal user message (text or other blocks flattened).
    out.push({ role: "user", content: text });
  } else if (text !== "") {
    out.push({ role: "user", content: text });
  }
  return out;
}

export function fromAnthropicRequest(body: Record<string, any>): Record<string, any> {
  const messages: Array<Record<string, any>> = [];

  if (body.system !== undefined && body.system !== null) {
    messages.push({ role: "system", content: flattenContent(body.system) });
  }

  for (const m of (body.messages ?? []) as AnthMessage[]) {
    messages.push(...mapMessage(m));
  }

  const tools = mapTools(body.tools);
  const toolChoice = mapToolChoice(body.tool_choice);

  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...(body.stop_sequences !== undefined && { stop: body.stop_sequences }),
    ...(tools && { tools }),
    ...(toolChoice !== undefined && { tool_choice: toolChoice }),
    ...(body.stream && { stream: true }),
  };
}

export function toAnthropicResponse(openai: Record<string, any>, model: string): Record<string, any> {
  const choice = openai.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const textContent = typeof message.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  const content: Array<Record<string, any>> = [];
  if (textContent !== "") content.push({ type: "text", text: textContent });
  for (const tc of toolCalls) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function?.name,
      input: safeJsonParse(tc.function?.arguments),
    });
  }

  const input = openai.usage?.prompt_tokens ?? 0;
  const output = openai.usage?.completion_tokens ?? 0;

  return {
    id: openai.id ?? "msg_gw" + Math.random().toString(36).slice(2, 10),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: { input_tokens: input, output_tokens: output },
  };
}

/** Re-emits an OpenAI chat.completion.chunk SSE stream as an Anthropic Messages event SSE stream. */
export function toAnthropicSSE(
  openaiStream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = "";

  const id = "msg_gw" + Math.random().toString(36).slice(2, 10);

  let started = false; // message_start emitted
  let anthIndex = -1; // current open content-block index, -1 = none open
  let openIsText = false;
  // Map OpenAI tool_calls array index -> Anthropic content-block index.
  const toolBlockByOaIndex = new Map<number, number>();

  const event = (type: string, data: object) =>
    enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

  const closeOpenBlock = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (anthIndex >= 0) {
      controller.enqueue(event("content_block_stop", { index: anthIndex }));
      anthIndex = -1;
      openIsText = false;
    }
  };

  const ensureStart = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (started) return;
    started = true;
    controller.enqueue(
      event("message_start", {
        message: {
          id,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    );
  };

  const processLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      closeOpenBlock(controller);
      controller.enqueue(event("message_stop", {}));
      return;
    }
    let chunk: Record<string, any>;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }

    ensureStart(controller);
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};

    // Text content delta.
    if (typeof delta.content === "string" && delta.content !== "") {
      if (!(anthIndex >= 0 && openIsText)) {
        closeOpenBlock(controller);
        anthIndex = nextIndex();
        openIsText = true;
        controller.enqueue(
          event("content_block_start", { index: anthIndex, content_block: { type: "text", text: "" } }),
        );
      }
      controller.enqueue(
        event("content_block_delta", {
          index: anthIndex,
          delta: { type: "text_delta", text: delta.content },
        }),
      );
    }

    // Tool-call deltas.
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const oaIndex = tc.index ?? 0;
        if (!toolBlockByOaIndex.has(oaIndex)) {
          // New tool block: close any open block, open a tool_use block.
          closeOpenBlock(controller);
          const idx = nextIndex();
          toolBlockByOaIndex.set(oaIndex, idx);
          anthIndex = idx;
          openIsText = false;
          controller.enqueue(
            event("content_block_start", {
              index: idx,
              content_block: { type: "tool_use", id: tc.id, name: tc.function?.name, input: {} },
            }),
          );
        }
        const frag = tc.function?.arguments;
        if (typeof frag === "string" && frag !== "") {
          controller.enqueue(
            event("content_block_delta", {
              index: toolBlockByOaIndex.get(oaIndex)!,
              delta: { type: "input_json_delta", partial_json: frag },
            }),
          );
        }
      }
    }

    // Finish: close open block, emit message_delta.
    if (choice.finish_reason) {
      closeOpenBlock(controller);
      controller.enqueue(
        event("message_delta", {
          delta: { stop_reason: mapStopReason(choice.finish_reason), stop_sequence: null },
          usage: { output_tokens: 0 },
        }),
      );
    }
  };

  // Anthropic content-block index counter (monotonic across text + tool blocks).
  let indexCounter = 0;
  function nextIndex(): number {
    return indexCounter++;
  }

  return openaiStream.pipeThrough(
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
