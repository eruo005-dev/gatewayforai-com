import type { ProviderId } from "../types";

export interface ProviderDef {
  label: string;
  baseURL: string;
  style: "openai" | "anthropic";
  defaultModel: string;
  authHeader: (key: string) => Record<string, string>;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    style: "openai",
    defaultModel: "gpt-4o",
    authHeader: bearer,
  },
  anthropic: {
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    style: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    authHeader: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    style: "openai",
    defaultModel: "gemini-2.0-flash",
    authHeader: bearer,
  },
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    style: "openai",
    defaultModel: "llama-3.3-70b-versatile",
    authHeader: bearer,
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    style: "openai",
    defaultModel: "mistral-large-latest",
    authHeader: bearer,
  },
  together: {
    label: "Together",
    baseURL: "https://api.together.xyz/v1",
    style: "openai",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    authHeader: bearer,
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    style: "openai",
    defaultModel: "deepseek-chat",
    authHeader: bearer,
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    style: "openai",
    defaultModel: "openrouter/auto",
    authHeader: bearer,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
