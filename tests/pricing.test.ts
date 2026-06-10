import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "@/lib/pricing";

describe("estimateCostUsd", () => {
  it("computes correct cost for known model (gpt-4o, 1000 in / 500 out)", () => {
    // gpt-4o: $2.5/M in, $10/M out
    // (1000 * 2.5 + 500 * 10) / 1_000_000 = (2500 + 5000) / 1_000_000 = 0.0075
    const result = estimateCostUsd("openai/gpt-4o", { prompt_tokens: 1000, completion_tokens: 500 });
    expect(result).toBe(0.0075);
  });

  it("returns null for unknown model", () => {
    expect(estimateCostUsd("openai/gpt-99-turbo", { prompt_tokens: 100, completion_tokens: 50 })).toBeNull();
  });

  it("returns null for unknown provider", () => {
    expect(estimateCostUsd("acme/model-x", { prompt_tokens: 100, completion_tokens: 50 })).toBeNull();
  });

  it("returns null when usage is undefined", () => {
    expect(estimateCostUsd("openai/gpt-4o", undefined)).toBeNull();
  });

  it("returns null when both token counts are missing", () => {
    expect(estimateCostUsd("openai/gpt-4o", {})).toBeNull();
  });

  it("handles 0 completion tokens gracefully", () => {
    // 1000 * 2.5 / 1_000_000 = 0.0025
    const result = estimateCostUsd("openai/gpt-4o", { prompt_tokens: 1000, completion_tokens: 0 });
    expect(result).toBe(0.0025);
  });

  it("computes correctly for anthropic/claude-sonnet-4-6", () => {
    // $3/M in, $15/M out
    // (500 * 3 + 200 * 15) / 1_000_000 = (1500 + 3000) / 1_000_000 = 0.0045
    const result = estimateCostUsd("anthropic/claude-sonnet-4-6", { prompt_tokens: 500, completion_tokens: 200 });
    expect(result).toBe(0.0045);
  });
});
