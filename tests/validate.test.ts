import { describe, it, expect } from "vitest";
import { validateConfigInput } from "@/lib/validate";

const GOOD = {
  providers: { openai: "sk-1", groq: "gsk-1" },
  fallbackChain: [
    { provider: "openai", model: "gpt-4o" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
  ],
  rateLimit: { rpm: 60 },
};

describe("validateConfigInput", () => {
  it("accepts a valid input", () => {
    const r = validateConfigInput(GOOD);
    expect(r.error).toBeUndefined();
    expect(r.value?.rateLimit.rpm).toBe(60);
  });

  it("defaults rpm to 60 when rateLimit omitted", () => {
    const { rateLimit, ...rest } = GOOD;
    expect(validateConfigInput(rest).value?.rateLimit.rpm).toBe(60);
  });

  it("rejects: no providers, unknown provider, empty key", () => {
    expect(validateConfigInput({ ...GOOD, providers: {} }).error).toMatch(/at least one/i);
    expect(validateConfigInput({ ...GOOD, providers: { nope: "k" } }).error).toMatch(/unknown provider/i);
    expect(validateConfigInput({ ...GOOD, providers: { openai: " " } }).error).toMatch(/empty/i);
  });

  it("rejects: empty chain, chain entry without a key, bad model", () => {
    expect(validateConfigInput({ ...GOOD, fallbackChain: [] }).error).toMatch(/chain/i);
    expect(
      validateConfigInput({
        ...GOOD,
        fallbackChain: [{ provider: "mistral", model: "m" }],
      }).error,
    ).toMatch(/no key/i);
    expect(
      validateConfigInput({
        ...GOOD,
        fallbackChain: [{ provider: "openai", model: "" }],
      }).error,
    ).toMatch(/model/i);
  });

  it("rejects rpm outside 1..1000", () => {
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 0 } }).error).toMatch(/rpm/i);
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 2000 } }).error).toMatch(/rpm/i);
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 1.5 } }).error).toMatch(/rpm/i);
  });
});
