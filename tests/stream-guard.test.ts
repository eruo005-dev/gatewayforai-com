import { describe, it, expect } from "vitest";
import { guardFirstToken, StreamDiedAtBirth } from "@/lib/stream-guard";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Builds a ReadableStream that emits each chunk (string → bytes) in order, then closes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else c.close();
    },
  });
}

/** Collects a stream into a single decoded string. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

describe("guardFirstToken", () => {
  it("data: in first chunk → resolves; output identical to input", async () => {
    const input = ['data: {"a":1}\n\n', 'data: {"b":2}\n\n', "data: [DONE]\n\n"];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    expect(await collect(guarded)).toBe(input.join(""));
  });

  it("preamble (: ping) then data → resolves; preserves preamble + data + rest in order", async () => {
    const input = [": ping\n\n", 'data: {"a":1}\n\n', 'data: {"b":2}\n\n'];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    expect(await collect(guarded)).toBe(input.join(""));
  });

  it("stream closes after zero data frames → throws StreamDiedAtBirth", async () => {
    const input = [": ping\n\n", ": keep-alive\n\n"];
    await expect(guardFirstToken(streamOf(input), 1000)).rejects.toBeInstanceOf(StreamDiedAtBirth);
  });

  it("stream errors immediately → throws StreamDiedAtBirth", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("boom");
      },
    });
    await expect(guardFirstToken(body, 1000)).rejects.toBeInstanceOf(StreamDiedAtBirth);
  });

  it("timeout on hanging stream → throws StreamDiedAtBirth", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // never enqueues, never closes
        return new Promise<void>(() => {});
      },
    });
    await expect(guardFirstToken(body, 30)).rejects.toBeInstanceOf(StreamDiedAtBirth);
  });

  it("data: split across two chunks at line start → still commits", async () => {
    const input = ["da", 'ta: {"a":1}\n\n', "data: [DONE]\n\n"];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    expect(await collect(guarded)).toBe(input.join(""));
  });

  it("preamble with mid-line 'data:' substring then close → throws (no false commit)", async () => {
    // ": note about data: uris\n\n" contains the substring `data:` but NOT at
    // the start of any line — the old includes() check would have falsely
    // committed. With line-anchored detection this must die at birth.
    const input = [": note about data: uris\n\n"];
    await expect(guardFirstToken(streamOf(input), 1000)).rejects.toBeInstanceOf(StreamDiedAtBirth);
  });

  it("real 'data: {...}' line still commits; output byte-identical", async () => {
    const input = ['data: {"a":1}\n\n', "data: [DONE]\n\n"];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    expect(await collect(guarded)).toBe(input.join(""));
  });

  it("comment line containing 'data:' then a real data line → commits, both preserved", async () => {
    const input = [": data: in a comment\n", "data: real\n\n"];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    expect(await collect(guarded)).toBe(input.join(""));
  });

  it("a 'data:' LINE split across two chunks AFTER a complete preamble line → commits (lineBuf carry)", async () => {
    // chunk 1 ends a complete preamble comment line, THEN starts the next line
    // with a bare "da" (no newline yet). chunk 2 supplies "ta: real\n\n".
    // The detector must CARRY the partial "da" across the chunk boundary and only
    // then see a complete "data: real" line. A mutation that resets the line
    // buffer per chunk would see neither chunk start a line with "data:" and would
    // hang → StreamDiedAtBirth on timeout. This pins the cross-chunk carry.
    const input = [": ready\nda", "ta: real\n\n", "data: [DONE]\n\n"];
    const guarded = await guardFirstToken(streamOf(input), 1000);
    // Output is byte-identical to the concatenated input (carry is detection-only).
    expect(await collect(guarded)).toBe(input.join(""));
  });
});
