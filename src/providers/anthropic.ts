import Anthropic from "@anthropic-ai/sdk";
import type { Message, Provider, StreamEvent, ToolDef } from "./types.ts";

export class AnthropicProvider implements Provider {
  name = "anthropic";
  model: string;
  private client: Anthropic;

  constructor(model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7") {
    this.model = model;
    this.client = new Anthropic();
  }

  async *stream(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
  }): AsyncIterable<StreamEvent> {
    // Cache system + tools. Top-level cache_control auto-places on the last cacheable block.
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: opts.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        // put cache breakpoint on the last tool so tools + system cache together
        ...(i === opts.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      messages: opts.messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content as any,
      })),
      thinking: { type: "adaptive" },
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
      }
    }

    const final = await stream.finalMessage();
    for (const block of final.content) {
      if (block.type === "tool_use") {
        yield {
          type: "tool_call",
          call: { id: block.id, name: block.name, input: block.input as Record<string, unknown> },
        };
      }
    }

    yield {
      type: "done",
      stopReason: final.stop_reason ?? "end_turn",
      usage: {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
