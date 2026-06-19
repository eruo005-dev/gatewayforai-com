import { describe, it, expect } from "vitest";
import { errJson, redactKeys } from "@/lib/errors";

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

  it("leaves a clean message untouched", () => {
    const msg = "The model is overloaded. Please retry.";
    expect(redactKeys(msg)).toBe(msg);
  });

  it("is safe on empty input", () => {
    expect(redactKeys("")).toBe("");
  });
});
