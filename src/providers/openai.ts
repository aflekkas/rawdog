import { createOpenAI } from "@ai-sdk/openai";
import { AiSdkProvider } from "@aflekkas/vibecli/providers/adapter";

export class OpenAIProvider extends AiSdkProvider {
  constructor(model = process.env.OPENAI_MODEL || "gpt-4.1") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }
    const openai = createOpenAI({ apiKey });
    super({ name: "openai", model, languageModel: openai(model) });
  }
}
