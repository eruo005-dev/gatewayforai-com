import { describe, it, expect } from "vitest";
import { errJson, gatewayHeaders, redactKeys } from "@/lib/errors";

describe("errJson", () => {
  it("emits OpenAI-style error JSON with mapped type", async () => {
    const res = errJson(429, "rate_limit_exceeded", "Slow down.", undefined, {
      "retry-after": "12",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    const body = await res.json();
    expect(body).toEqual({
      error: { message: "Slow down.", type: "rate_limit_error", code: "rate_limit_exceeded" },
    });
  });

  it("includes extra fields inside error when given", async () => {
    const res = errJson(502, "all_providers_failed", "Everything burned.", {
      attempts: [{ provider: "openai", status: 500 }],
    });
    const body = await res.json();
    expect(body.error.attempts).toHaveLength(1);
    expect(body.error.type).toBe("api_error");
  });
});

// ─── FIX 5: redactKeys — strip provider-key fingerprints from error messages ──
describe("redactKeys", () => {
  it("redacts an OpenAI masked-key fingerprint (last-4 leak)", () => {
    const out = redactKeys("Incorrect API key provided: sk-proj-****…9999. Check your key.");
    expect(out).not.toContain("9999");
    expect(out).not.toContain("sk-proj-");
    expect(out).toContain("sk-***redacted***");
  });

  it("redacts a full sk- key and an sk-ant- key", () => {
    expect(redactKeys("bad key sk-abc123DEF456")).toBe("bad key sk-***redacted***");
    expect(redactKeys("auth failed for sk-ant-api03-xyz")).toContain("sk-***redacted***");
  });

  it("redacts Groq gsk_ and Google AIza fingerprints", () => {
    expect(redactKeys("Invalid: gsk_AbCdEf123456")).toBe("Invalid: gsk_***redacted***");
    expect(redactKeys("key AIzaSyABCDEF12345 rejected")).toContain("AIza***redacted***");
  });

  it("redacts xAI xai- and Replicate r8_ fingerprints", () => {
    expect(redactKeys("xAI rejected key xai-AbCdEf123456")).toBe("xAI rejected key xai-***redacted***");
    const r8 = redactKeys("Replicate: r8_AbCdEf123456 invalid");
    expect(r8).toContain("r8_***redacted***");
    expect(r8).not.toContain("AbCdEf");
  });

  it("redacts sk-or- (OpenRouter) via the general sk- rule", () => {
    const out = redactKeys("OpenRouter key sk-or-v1-abcdef123456 rejected");
    expect(out).toContain("sk-***redacted***");
    expect(out).not.toContain("abcdef");
  });

  it("does NOT over-redact normal prose with these tokens as substrings", () => {
    // Bare prefixes / short tokens must not match (the {2,} minimum guards this).
    // "task r8" / "the xai team" / "ask the desk" must survive untouched.
    expect(redactKeys("Provider returned status 503; retry after the desk reopens.")).toBe(
      "Provider returned status 503; retry after the desk reopens.",
    );
    expect(redactKeys("Sprint r8 review with the xAI team next week.")).toBe(
      "Sprint r8 review with the xAI team next week.",
    );
  });

  it("leaves a clean message untouched", () => {
    const msg = "The model is overloaded. Please retry.";
    expect(redactKeys(msg)).toBe(msg);
  });

  it("is safe on empty input", () => {
    expect(redactKeys("")).toBe("");
  });
});

// ─── gatewayHeaders — whitelist upstream → client response headers ────────────
describe("gatewayHeaders", () => {
  function upstreamWithLeakyHeaders(): Response {
    return new Response("body", {
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "content-encoding": "gzip",
        "transfer-encoding": "chunked",
        "set-cookie": "sess=abc",
        "x-error-json": "eyJrZXkiOiJzay1wcm9qLTk5OTkifQ==",
        "x-openai-version": "1",
        "x-oai-internal": "secret",
        "openai-organization": "org-123",
        "x-request-id": "req-xyz",
        "cf-ray": "abc123",
        "x-ratelimit-remaining": "0",
      },
    });
  }

  it("copies ONLY upstream content-type plus the gateway headers", () => {
    const out = gatewayHeaders(upstreamWithLeakyHeaders(), {
      "x-gateway-provider": "openai",
      "x-gateway-fallback-count": "0",
    });
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("x-gateway-provider")).toBe("openai");
    expect(out.get("x-gateway-fallback-count")).toBe("0");
  });

  it("drops every leaky / framing upstream header", () => {
    const out = gatewayHeaders(upstreamWithLeakyHeaders(), { "x-gateway-provider": "openai" });
    for (const h of [
      "content-length",
      "content-encoding",
      "transfer-encoding",
      "set-cookie",
      "x-error-json",
      "x-openai-version",
      "x-oai-internal",
      "openai-organization",
      "x-request-id",
      "cf-ray",
      "x-ratelimit-remaining",
    ]) {
      expect(out.get(h)).toBeNull();
    }
  });

  it("accepts a null upstream (synthesized stream) and still emits gateway headers", () => {
    const out = gatewayHeaders(null, { "content-type": "text/event-stream", "x-gateway-provider": "groq" });
    expect(out.get("content-type")).toBe("text/event-stream");
    expect(out.get("x-gateway-provider")).toBe("groq");
  });
});
