import { describe, it, expect } from "vitest";
import { PROVIDERS } from "@/lib/providers/registry";

describe("registry", () => {
  it("defines all 8 providers", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      "anthropic", "deepseek", "gemini", "groq",
      "mistral", "openai", "openrouter", "together",
    ]);
  });

  it("anthropic uses x-api-key + version header; others use Bearer", () => {
    const a = PROVIDERS.anthropic.authHeader("sk-ant-1");
    expect(a["x-api-key"]).toBe("sk-ant-1");
    expect(a["anthropic-version"]).toBeTruthy();
    expect(PROVIDERS.openai.authHeader("sk-1")).toEqual({ Authorization: "Bearer sk-1" });
  });

  it("every provider has a baseURL, style and defaultModel", () => {
    for (const def of Object.values(PROVIDERS)) {
      expect(def.baseURL).toMatch(/^https:\/\//);
      expect(["openai", "anthropic"]).toContain(def.style);
      expect(def.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
