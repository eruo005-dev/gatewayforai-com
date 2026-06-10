import { describe, it, expect } from "vitest";
import { errJson } from "@/lib/errors";

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
