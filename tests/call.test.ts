import { describe, it, expect, vi } from "vitest";
import { callProvider } from "@/lib/providers/call";

describe("callProvider — openai style", () => {
  it("POSTs to {baseURL}/chat/completions with bearer auth and swapped model", async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    await callProvider({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      body: { model: "groq/llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] },
      apiKey: "gsk-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk-1");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("llama-3.3-70b-versatile"); // provider prefix stripped
  });

  it("aborts after timeoutMs", async () => {
    const fetchFn = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    await expect(
      callProvider({
        provider: "openai",
        model: "gpt-4o",
        body: { messages: [] },
        apiKey: "sk-1",
        timeoutMs: 30,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});

describe("callProvider — anthropic style", () => {
  it("translates body, calls /messages, translates non-stream response back", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const sent = JSON.parse(init.body as string);
      expect(sent.system).toBe("Be terse.");
      expect(sent.max_tokens).toBe(4096);
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-1");
      return Response.json({
        id: "msg_01",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2 },
      });
    });
    const res = await callProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      body: {
        messages: [
          { role: "system", content: "Be terse." },
          { role: "user", content: "hi" },
        ],
      },
      apiKey: "sk-ant-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello");
  });

  it("passes anthropic error responses through untranslated", async () => {
    const fetchFn = vi.fn(async () => Response.json({ error: "overloaded" }, { status: 529 }));
    const res = await callProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "hi" }] },
      apiKey: "sk-ant-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.status).toBe(529);
  });
});
