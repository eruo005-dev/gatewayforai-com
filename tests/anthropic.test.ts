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
