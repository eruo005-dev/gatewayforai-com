import { describe, it, expect } from "vitest";
import {
  fromAnthropicRequest, toAnthropicResponse, toAnthropicSSE,
} from "@/lib/anthropic-inbound";

describe("fromAnthropicRequest", () => {
  it("maps system string + user text to OpenAI messages", () => {
    const out = fromAnthropicRequest({
      model: "auto",
      max_tokens: 100,
      system: "Be terse.",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(out.messages).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
    ]);
    expect(out.model).toBe("auto");
    expect(out.max_tokens).toBe(100);
  });

  it("flattens system block-array to a string", () => {
    const out = fromAnthropicRequest({
      model: "anthropic/claude-sonnet-4-6",
      max_tokens: 50,
      system: [
        { type: "text", text: "Part A" },
        { type: "text", text: " B" },
      ],
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "Part A B" });
  });

  it("omits system message when system absent", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.messages).toEqual([{ role: "user", content: "x" }]);
  });

  it("maps tools and tool_choice {type:tool,name}", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user", content: "Weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      tool_choice: { type: "tool", name: "get_weather" },
    });
    expect(out.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ]);
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "get_weather" } });
  });

  it("maps tool_choice {type:any} to required and {type:auto} to auto", () => {
    const any = fromAnthropicRequest({
      model: "m", max_tokens: 10, messages: [{ role: "user", content: "x" }],
      tool_choice: { type: "any" },
    });
    expect(any.tool_choice).toBe("required");

    const auto = fromAnthropicRequest({
      model: "m", max_tokens: 10, messages: [{ role: "user", content: "x" }],
      tool_choice: { type: "auto" },
    });
    expect(auto.tool_choice).toBe("auto");
  });

  it("omits tool_choice when absent", () => {
    const out = fromAnthropicRequest({
      model: "m", max_tokens: 10, messages: [{ role: "user", content: "x" }],
    });
    expect(out.tool_choice).toBeUndefined();
  });

  it("translates assistant tool_use blocks to tool_calls with stringified args", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        { role: "user", content: "Weather in Paris?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "tu1", name: "get_weather", input: { city: "Paris" } },
          ],
        },
      ],
    });
    expect(out.messages[1]).toEqual({
      role: "assistant",
      content: "Let me check.",
      tool_calls: [
        { id: "tu1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
      ],
    });
  });

  it("sets content null on assistant tool_use-only message", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu1", name: "f", input: {} }],
        },
      ],
    });
    expect(out.messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "tu1", type: "function", function: { name: "f", arguments: "{}" } }],
    });
  });

  it("translates user tool_result (string content) to role:tool message", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "sunny" }],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "tu1", content: "sunny" },
    ]);
  });

  it("translates user tool_result (block-array content) flattening to string", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu2",
              content: [{ type: "text", text: "win" }, { type: "text", text: "dy" }],
            },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "tu2", content: "windy" },
    ]);
  });

  it("emits tool messages first then user text for mixed tool_result+text", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu1", content: "sunny" },
            { type: "text", text: "thanks" },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "tu1", content: "sunny" },
      { role: "user", content: "thanks" },
    ]);
  });

  it("maps stop_sequences to stop and passes max_tokens, temperature, top_p, stream", () => {
    const out = fromAnthropicRequest({
      model: "m",
      max_tokens: 77,
      messages: [{ role: "user", content: "x" }],
      stop_sequences: ["END", "STOP"],
      temperature: 0.3,
      top_p: 0.9,
      stream: true,
    });
    expect(out.stop).toEqual(["END", "STOP"]);
    expect(out.max_tokens).toBe(77);
    expect(out.temperature).toBe(0.3);
    expect(out.top_p).toBe(0.9);
    expect(out.stream).toBe(true);
  });
});

describe("toAnthropicResponse", () => {
  it("maps text-only response", () => {
    const out = toAnthropicResponse(
      {
        id: "chatcmpl-1",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      "auto",
    );
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.model).toBe("auto");
    expect(out.id).toBe("chatcmpl-1");
    expect(out.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.stop_sequence).toBeNull();
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("maps tool_calls to tool_use with parsed input and stop_reason tool_use", () => {
    const out = toAnthropicResponse(
      {
        id: "chatcmpl-2",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Checking",
              tool_calls: [
                { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
      "m",
    );
    expect(out.content).toEqual([
      { type: "text", text: "Checking" },
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } },
    ]);
    expect(out.stop_reason).toBe("tool_use");
  });

  it("emits only tool_use blocks when content is null", () => {
    const out = toAnthropicResponse(
      {
        id: "chatcmpl-3",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{bad" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      "m",
    );
    expect(out.content).toEqual([{ type: "tool_use", id: "c1", name: "f", input: {} }]);
  });

  it("maps finish_reason length to max_tokens", () => {
    const out = toAnthropicResponse(
      {
        id: "x",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "length" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "m",
    );
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("falls back to msg_gw id when openai id missing", () => {
    const out = toAnthropicResponse(
      { choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: {} },
      "m",
    );
    expect(String(out.id).startsWith("msg_gw")).toBe(true);
  });
});

describe("toAnthropicSSE", () => {
  function openaiStream(chunks: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
  }

  // Collect into [{event, data}] pairs from anthropic SSE framing.
  async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: any }>> {
    const text = await new Response(stream).text();
    const frames = text.split("\n\n").filter((f) => f.trim());
    return frames.map((f) => {
      const lines = f.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:")) ?? "";
      const dataLine = lines.find((l) => l.startsWith("data:")) ?? "";
      return {
        event: eventLine.replace(/^event:\s*/, "").trim(),
        data: JSON.parse(dataLine.replace(/^data:\s*/, "").trim()),
      };
    });
  }

  it("converts a full text round to anthropic events", async () => {
    const out = toAnthropicSSE(
      openaiStream([
        { id: "chatcmpl-1", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
        { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] },
        { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] },
        { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]),
      "auto",
    );
    const events = await collectEvents(out);
    const types = events.map((e) => e.event);
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    const start = events[0];
    expect(start.data.type).toBe("message_start");
    expect(start.data.message.type).toBe("message");
    expect(start.data.message.role).toBe("assistant");
    expect(start.data.message.model).toBe("auto");
    expect(start.data.message.content).toEqual([]);

    const cbStart = events[1];
    expect(cbStart.data.index).toBe(0);
    expect(cbStart.data.content_block).toEqual({ type: "text", text: "" });

    expect(events[2].data).toMatchObject({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } });
    expect(events[3].data.delta.text).toBe("lo");

    const msgDelta = events.find((e) => e.event === "message_delta");
    expect(msgDelta!.data.delta).toEqual({ stop_reason: "end_turn", stop_sequence: null });
  });

  it("converts a tool round to tool_use content_block_start and input_json_delta", async () => {
    const out = toAnthropicSSE(
      openaiStream([
        { id: "chatcmpl-2", choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }] },
        {
          id: "chatcmpl-2",
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-2",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }],
        },
        {
          id: "chatcmpl-2",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] }, finish_reason: null }],
        },
        { id: "chatcmpl-2", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]),
      "m",
    );
    const events = await collectEvents(out);

    const cbStart = events.find((e) => e.event === "content_block_start");
    expect(cbStart!.data.index).toBe(0);
    expect(cbStart!.data.content_block).toEqual({ type: "tool_use", id: "call_1", name: "get_weather", input: {} });

    const jsonDeltas = events.filter((e) => e.event === "content_block_delta");
    expect(jsonDeltas.map((e) => e.data.delta)).toEqual([
      { type: "input_json_delta", partial_json: '{"city":' },
      { type: "input_json_delta", partial_json: '"Paris"}' },
    ]);
    expect(jsonDeltas.every((e) => e.data.index === 0)).toBe(true);

    expect(events.some((e) => e.event === "content_block_stop")).toBe(true);

    const msgDelta = events.find((e) => e.event === "message_delta");
    expect(msgDelta!.data.delta).toEqual({ stop_reason: "tool_use", stop_sequence: null });

    expect(events.at(-1)!.event).toBe("message_stop");
  });

  it("handles input split mid-frame identically", async () => {
    const chunks = [
      { id: "c", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
      { id: "c", choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] },
      { id: "c", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }] },
      { id: "c", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const full = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const enc = new TextEncoder();
    const mid = Math.floor(full.length / 2);
    const splitStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(full.slice(0, mid)));
        c.enqueue(enc.encode(full.slice(mid)));
        c.close();
      },
    });
    const events = await collectEvents(toAnthropicSSE(splitStream, "auto"));
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });
});
