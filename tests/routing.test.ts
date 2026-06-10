import { describe, it, expect } from "vitest";
import { sortChain } from "@/lib/routing";
import type { ChainEntry } from "@/lib/types";

const CHAIN: ChainEntry[] = [
  { provider: "openai", model: "gpt-4o" },          // in: 2.5, out: 10 → 12.5
  { provider: "gemini", model: "gemini-2.0-flash" }, // in: 0.1, out: 0.4 → 0.5
  { provider: "anthropic", model: "claude-sonnet-4-6" }, // in: 3, out: 15 → 18
  { provider: "groq", model: "llama-3.3-70b-versatile" }, // in: 0.59, out: 0.79 → 1.38
];

describe("sortChain — cheapest", () => {
  it("puts gemini-flash before gpt-4o", () => {
    const sorted = sortChain(CHAIN, "cheapest");
    const providers = sorted.map((e) => e.provider);
    expect(providers.indexOf("gemini")).toBeLessThan(providers.indexOf("openai"));
  });

  it("orders cheapest first overall: gemini, groq, openai, anthropic", () => {
    const sorted = sortChain(CHAIN, "cheapest");
    expect(sorted.map((e) => e.provider)).toEqual(["gemini", "groq", "openai", "anthropic"]);
  });

  it("unknown-price models go last, preserving their relative order", () => {
    const withUnknown: ChainEntry[] = [
      { provider: "openai", model: "gpt-unknown-x" },   // Infinity (not in PRICES)
      { provider: "gemini", model: "gemini-unknown-y" }, // Infinity
      { provider: "groq", model: "llama-3.3-70b-versatile" }, // known: 1.38
    ];
    const sorted = sortChain(withUnknown, "cheapest");
    // groq (known) first, then the two unknowns in original order
    expect(sorted[0].provider).toBe("groq");
    expect(sorted[1]).toEqual(withUnknown[0]); // openai/gpt-unknown-x
    expect(sorted[2]).toEqual(withUnknown[1]); // gemini/gemini-unknown-y
  });

  it("does not mutate the original array", () => {
    const original = [...CHAIN];
    sortChain(CHAIN, "cheapest");
    expect(CHAIN).toEqual(original);
  });
});

describe("sortChain — fastest", () => {
  it("puts groq first", () => {
    const sorted = sortChain(CHAIN, "fastest");
    expect(sorted[0].provider).toBe("groq");
  });

  it("orders by speed rank: groq, gemini, openai, anthropic", () => {
    const sorted = sortChain(CHAIN, "fastest");
    expect(sorted.map((e) => e.provider)).toEqual(["groq", "gemini", "openai", "anthropic"]);
  });

  it("unknown-provider entries go last preserving relative order", () => {
    const withUnknown: ChainEntry[] = [
      { provider: "openrouter" as any, model: "x" }, // rank 8
      { provider: "groq", model: "llama-3.3-70b-versatile" }, // rank 1
    ];
    const sorted = sortChain(withUnknown, "fastest");
    expect(sorted[0].provider).toBe("groq");
    expect(sorted[1].provider).toBe("openrouter");
  });

  it("does not mutate the original array", () => {
    const original = [...CHAIN];
    sortChain(CHAIN, "fastest");
    expect(CHAIN).toEqual(original);
  });
});
