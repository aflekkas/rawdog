import { createAnthropic } from "@ai-sdk/anthropic";
import { AiSdkProvider } from "@aflekkas/vibecli/providers/adapter";

export class AnthropicProvider extends AiSdkProvider {
  constructor(model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    const anthropic = createAnthropic({ apiKey });
    super({ name: "anthropic", model, languageModel: anthropic(model) });
  }
}
