import { describe, it, expect } from "vitest";
import {
  toAnthropicBody, fromAnthropicResponse, translateAnthropicSSE,
} from "@/lib/providers/anthropic";

describe("toAnthropicBody", () => {
  it("extracts system messages, maps roles, defaults max_tokens", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: [{ type: "text", text: "Part A" }, { type: "text", text: " B" }] },
      ],
      temperature: 0.5,
      stop: "END",
    });
    expect(out.system).toBe("Be terse.");
    expect(out.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Part A B" },
    ]);
    expect(out.max_tokens).toBe(4096);
    expect(out.temperature).toBe(0.5);
    expect(out.stop_sequences).toEqual(["END"]);
    expect(out.stream).toBeUndefined();
  });

  it("respects explicit max_tokens and stream flag", () => {
    const out = toAnthropicBody({
      model: "m", messages: [{ role: "user", content: "x" }], max_tokens: 99, stream: true,
    });
    expect(out.max_tokens).toBe(99);
    expect(out.stream).toBe(true);
  });
});

describe("fromAnthropicResponse", () => {
  it("maps content blocks, stop_reason and usage", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_01",
        content: [{ type: "text", text: "Hel" }, { type: "text", text: "lo" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      "anthropic/claude-sonnet-4-6",
    );
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message).toEqual({ role: "assistant", content: "Hello" });
    expect(out.choices[0].finish_reason).toBe("length");
    expect(out.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });
});

describe("translateAnthropicSSE", () => {
  function anthropicStream(events: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(stream).text();
    return text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  }

  it("converts anthropic events to OpenAI chunks ending in [DONE]", async () => {
    const out = translateAnthropicSSE(
      anthropicStream([
        { type: "message_start", message: { id: "msg_01" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
      "anthropic/claude-sonnet-4-6",
    );
    const frames = await collect(out);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunks[1].choices[0].delta.content).toBe("Hel");
    expect(chunks[2].choices[0].delta.content).toBe("lo");
    expect(chunks[3].choices[0].finish_reason).toBe("stop");
    expect(chunks.every((c) => c.object === "chat.completion.chunk")).toBe(true);
  });

  it("produces identical frames when input is split mid-frame across two chunks", async () => {
    const enc = new TextEncoder();
    const events = [
      { type: "message_start", message: { id: "msg_01" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];
    const full = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    const mid = Math.floor(full.length / 2);
    const splitStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(full.slice(0, mid)));
        c.enqueue(enc.encode(full.slice(mid)));
        c.close();
      },
    });

    const [whole, split] = await Promise.all([
      collect(translateAnthropicSSE(anthropicStream(events), "anthropic/claude-sonnet-4-6")),
      collect(translateAnthropicSSE(splitStream, "anthropic/claude-sonnet-4-6")),
    ]);

    // Same number of frames
    expect(split.length).toBe(whole.length);
    // [DONE] at the end
    expect(split.at(-1)).toBe("[DONE]");
    // Parse and compare payloads structurally (id/created differ between calls, so compare choices only)
    const wholeChoices = whole.slice(0, -1).map((f) => JSON.parse(f).choices);
    const splitChoices = split.slice(0, -1).map((f) => JSON.parse(f).choices);
    expect(splitChoices).toEqual(wholeChoices);
  });
});

describe("toAnthropicBody — tools & tool_choice", () => {
  it("translates tools and tool_choice:auto (input_schema present, type auto)", () => {
    const out = toAnthropicBody({
      model: "m",
      messages: [{ role: "user", content: "Weather?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
    });
    expect(out.tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(out.tool_choice).toEqual({ type: "auto" });
  });

  it("maps tool_choice variants: specific function, required, none", () => {
    const specific = toAnthropicBody({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(specific.tool_choice).toEqual({ type: "tool", name: "get_weather" });

    const required = toAnthropicBody({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
      tool_choice: "required",
    });
    expect(required.tool_choice).toEqual({ type: "any" });

    const none = toAnthropicBody({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
      tool_choice: "none",
    });
    expect(none.tools).toBeUndefined();
    expect(none.tool_choice).toBeUndefined();
  });

  it("omits tools and tool_choice when absent", () => {
    const out = toAnthropicBody({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });
});

describe("toAnthropicBody — tool messages", () => {
  it("translates assistant tool_calls into tool_use blocks (parsed input)", () => {
    const out = toAnthropicBody({
      model: "m",
      messages: [
        { role: "user", content: "Weather in Paris?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
          ],
        },
      ],
    });
    expect(out.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } },
      ],
    });
  });

  it("uses empty input object when tool_call arguments are malformed JSON", () => {
    const out = toAnthropicBody({
      model: "m",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_x", type: "function", function: { name: "f", arguments: "{not json" } }],
        },
      ],
    });
    expect(out.messages[0]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "call_x", name: "f", input: {} }],
    });
  });

  it("merges consecutive tool messages into one user message with multiple tool_result blocks", () => {
    const out = toAnthropicBody({
      model: "m",
      messages: [
        { role: "tool", tool_call_id: "call_1", content: "sunny" },
        { role: "tool", tool_call_id: "call_2", content: "windy" },
      ],
    });
    expect(out.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "sunny" },
          { type: "tool_result", tool_use_id: "call_2", content: "windy" },
        ],
      },
    ]);
  });
});

describe("fromAnthropicResponse — tool_use", () => {
  it("maps [text, tool_use] to content + tool_calls and finish_reason tool_calls", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_1",
        content: [
          { type: "text", text: "Checking" },
          { type: "tool_use", id: "tu1", name: "get_weather", input: { city: "Paris" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 },
      },
      "anthropic/claude-sonnet-4-6",
    );
    expect(out.choices[0].message.content).toBe("Checking");
    expect(out.choices[0].message.tool_calls).toEqual([
      { id: "tu1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
    ]);
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });

  it("sets content null when only tool_use blocks present", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_1",
        content: [{ type: "tool_use", id: "tu1", name: "f", input: {} }],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      "anthropic/claude-sonnet-4-6",
    );
    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("toAnthropicBody — cache_control passthrough", () => {
  it("preserves cache_control on user message content parts", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Long context", cache_control: { type: "ephemeral" } },
            { type: "text", text: "Short question" },
          ],
        },
      ],
    });
    expect(out.messages[0].content).toEqual([
      { type: "text", text: "Long context", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Short question" },
    ]);
  });

  it("flattens array content without cache_control to string (regression safety)", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Part A" }, { type: "text", text: " B" }],
        },
      ],
    });
    expect(out.messages[0].content).toBe("Part A B");
  });

  it("emits system as block array when cache_control present", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "system",
          content: [
            { type: "text", text: "Large system prompt", cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "user", content: "Hi" },
      ],
    });
    expect(Array.isArray(out.system)).toBe(true);
    expect(out.system).toEqual([
      { type: "text", text: "Large system prompt", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("keeps system as plain string when no cache_control in system (regression safety)", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(typeof out.system).toBe("string");
    expect(out.system).toBe("Be terse.");
  });
});

describe("translateAnthropicSSE — tool_use streaming", () => {
  function anthropicStream(events: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
  }
  async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(stream).text();
    return text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  }

  it("emits tool_calls deltas for a single tool_use block", async () => {
    const out = translateAnthropicSSE(
      anthropicStream([
        { type: "message_start", message: { id: "msg_1" } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu1", name: "get_weather" },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Paris"}' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
      "anthropic/claude-sonnet-4-6",
    );
    const frames = await collect(out);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));

    const start = chunks.find((c) => c.choices[0].delta.tool_calls?.[0]?.id);
    expect(start.choices[0].delta.tool_calls).toEqual([
      { index: 0, id: "tu1", type: "function", function: { name: "get_weather", arguments: "" } },
    ]);

    const argChunks = chunks.filter((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments && !c.choices[0].delta.tool_calls?.[0]?.id);
    expect(argChunks.map((c) => c.choices[0].delta.tool_calls[0].function.arguments)).toEqual(['{"city":', '"Paris"}']);
    expect(argChunks.every((c) => c.choices[0].delta.tool_calls[0].index === 0)).toBe(true);

    expect(chunks.find((c) => c.choices[0].finish_reason)?.choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps text and tool deltas separate (text index 0, tool index 1 → tool array index 0)", async () => {
    const out = translateAnthropicSSE(
      anthropicStream([
        { type: "message_start", message: { id: "msg_1" } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tu1", name: "f" },
        },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ]),
      "anthropic/claude-sonnet-4-6",
    );
    const frames = await collect(out);
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));

    const textChunk = chunks.find((c) => c.choices[0].delta.content === "Hi");
    expect(textChunk.choices[0].delta.tool_calls).toBeUndefined();

    const toolStart = chunks.find((c) => c.choices[0].delta.tool_calls?.[0]?.id === "tu1");
    expect(toolStart.choices[0].delta.tool_calls[0].index).toBe(0); // first tool → array index 0
    expect(toolStart.choices[0].delta.content).toBeUndefined();

    const toolArg = chunks.find((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments === "{}");
    expect(toolArg.choices[0].delta.tool_calls[0].index).toBe(0);
  });
});

// Adversarial fuzz: 16 malformed OpenAI-side request shapes — toAnthropicBody
// must translate each without throwing. callProvider runs this synchronously
// before the upstream fetch, so a throw here would otherwise be misreported as a
// provider failure by the gateway retry loop. (Class 2 — translator robustness.)
describe("toAnthropicBody — adversarial malformed-shape fuzz (never throws)", () => {
  const cases: Array<[string, any]> = [
    ["null message", { model: "m", messages: [null] }],
    ["number message", { model: "m", messages: [123] }],
    ["string message", { model: "m", messages: ["hi"] }],
    ["empty-object message", { model: "m", messages: [{}] }],
    ["message without content", { model: "m", messages: [{ role: "user" }] }],
    ["numeric content", { model: "m", messages: [{ role: "user", content: 5 }] }],
    ["null content", { model: "m", messages: [{ role: "user", content: null }] }],
    ["content array with null part", { model: "m", messages: [{ role: "user", content: [null] }] }],
    ["content array w/ null part + cache_control sibling", { model: "m", messages: [{ role: "user", content: [null, { type: "text", text: "x", cache_control: { type: "ephemeral" } }] }] }],
    ["assistant tool_calls not array", { model: "m", messages: [{ role: "assistant", tool_calls: "nope" }] }],
    ["assistant tool_calls array with null", { model: "m", messages: [{ role: "assistant", tool_calls: [null] }] }],
    ["assistant tool_call missing function", { model: "m", messages: [{ role: "assistant", tool_calls: [{ id: "x" }] }] }],
    ["assistant tool_call function null", { model: "m", messages: [{ role: "assistant", tool_calls: [{ id: "x", function: null }] }] }],
    ["tool role with array content of nulls", { model: "m", messages: [{ role: "tool", tool_call_id: "t", content: [null] }] }],
    ["tools not array", { model: "m", messages: [], tools: "nope" }],
    ["tools array with null", { model: "m", messages: [], tools: [null] }],
    ["system message block-array with null part", { model: "m", messages: [{ role: "system", content: [null, { type: "text", text: "ok", cache_control: {} }] }] }],
    ["messages not an array", { model: "m", messages: "not-an-array" }],
  ];
  for (const [name, body] of cases) {
    it(`does not throw: ${name}`, () => {
      let out: any;
      expect(() => { out = toAnthropicBody(body); }).not.toThrow();
      expect(Array.isArray(out.messages)).toBe(true);
    });
  }
});
