import type { Provider } from "@aflekkas/vibecli/providers";
import { OpenAIProvider } from "./providers/openai.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";

export type PickOptions = {
  provider?: "openai" | "anthropic";
  model?: string;
  openaiModel?: string;
  anthropicModel?: string;
};

export function pickProvider(opts: PickOptions = {}): Provider {
  const pick =
    opts.provider ?? ((process.env.RAWDOG_PROVIDER || "").toLowerCase() as "openai" | "anthropic" | "");
  const wantAnthropic =
    pick === "anthropic" ||
    (!pick && !process.env.OPENAI_API_KEY && process.env.ANTHROPIC_API_KEY);
  const wantOpenAI =
    pick === "openai" || (!pick && process.env.OPENAI_API_KEY);

  if (wantAnthropic) {
    const model = opts.model ?? opts.anthropicModel ?? process.env.ANTHROPIC_MODEL ?? undefined;
    return new AnthropicProvider(model);
  }
  if (wantOpenAI) {
    const model = opts.model ?? opts.openaiModel ?? process.env.OPENAI_MODEL ?? undefined;
    return new OpenAIProvider(model);
  }
  throw new Error("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}

// "gpt-4.1", "openai:gpt-5-mini", "claude-sonnet-4-5", "anthropic:claude-opus-4-7"
export function parseProviderSpec(spec: string): PickOptions {
  const s = spec.trim();
  if (!s) return {};
  const [maybeProvider, ...rest] = s.split(":");
  if (rest.length && (maybeProvider === "openai" || maybeProvider === "anthropic")) {
    return { provider: maybeProvider as "openai" | "anthropic", model: rest.join(":") };
  }
  // bare model name — infer provider
  if (/^claude/i.test(s)) return { provider: "anthropic", model: s };
  if (/^(gpt-|o\d|chatgpt)/i.test(s)) return { provider: "openai", model: s };
  return { model: s };
}

export function estimateContextWindow(provider: Provider): number | null {
  const m = provider.model.toLowerCase();
  if (provider.name === "anthropic" || m.includes("claude")) return 200_000;
  if (m.startsWith("gpt-4.1")) return 1_047_576;
  if (
    m.startsWith("gpt-4o") ||
    m.startsWith("gpt-4-turbo") ||
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3")
  ) {
    return 128_000;
  }
  return null;
}
