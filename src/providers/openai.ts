import OpenAI from "openai";
import type { Message, Provider, StreamEvent, ToolDef } from "./types.ts";

export class OpenAIProvider implements Provider {
  name = "openai";
  model: string;
  private client: OpenAI;

  constructor(model = process.env.OPENAI_MODEL || "gpt-5") {
    this.model = model;
    this.client = new OpenAI();
  }

  async *stream(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
  }): AsyncIterable<StreamEvent> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.system },
      ...toOpenAIMessages(opts.messages),
    ];

    const tools: OpenAI.Chat.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: tools.length ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });

    // Accumulate tool call args across deltas (OpenAI streams JSON in fragments)
    const pending: Record<number, { id: string; name: string; args: string }> = {};
    let stopReason = "end_turn";
    let usage: { input: number; output: number } | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        yield { type: "text_delta", text: choice.delta.content };
      }
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index;
          if (!pending[idx]) pending[idx] = { id: "", name: "", args: "" };
          if (tc.id) pending[idx].id = tc.id;
          if (tc.function?.name) pending[idx].name = tc.function.name;
          if (tc.function?.arguments) pending[idx].args += tc.function.arguments;
        }
      }
      if (choice?.finish_reason) {
        stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason;
      }
      if (chunk.usage) {
        usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      }
    }

    for (const idx of Object.keys(pending).map(Number).sort((a, b) => a - b)) {
      const p = pending[idx];
      let input: Record<string, unknown> = {};
      try {
        input = p.args ? JSON.parse(p.args) : {};
      } catch {
        input = { _raw: p.args };
      }
      yield { type: "tool_call", call: { id: p.id, name: p.name, input } };
    }

    yield { type: "done", stopReason, usage };
  }
}

function toOpenAIMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role as "user" | "assistant", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
      const toolUses = m.content.filter((b) => b.type === "tool_use") as any[];
      out.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolUses.length
          ? toolUses.map((tu) => ({
              id: tu.id,
              type: "function" as const,
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            }))
          : undefined,
      });
    } else if (m.role === "user" || m.role === "tool") {
      for (const block of m.content) {
        if (block.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        } else if (block.type === "text") {
          out.push({ role: "user", content: block.text });
        }
      }
    }
  }
  return out;
}
