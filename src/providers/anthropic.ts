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
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent> {
    // Index of the second-to-last user message (so the prior turn becomes a cached prefix).
    let cacheUserIdx = -1;
    {
      const userIdxs: number[] = [];
      for (let i = 0; i < opts.messages.length; i++) {
        const r = opts.messages[i]!.role;
        if (r === "user" || r === "tool") userIdxs.push(i);
      }
      if (userIdxs.length >= 2) cacheUserIdx = userIdxs[userIdxs.length - 2]!;
    }

    // Cache system + tools. Top-level cache_control auto-places on the last cacheable block.
    const stream = this.client.messages.stream(
      {
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
        messages: opts.messages.map((m, i) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: toAnthropicContent(m.content, i === cacheUserIdx),
        })),
        thinking: { type: "adaptive" },
      },
      { signal: opts.signal },
    );

    for await (const event of stream) {
      if (opts.signal?.aborted) break;
      if (event.type !== "content_block_delta") continue;
      const delta = event.delta;
      if (delta.type === "text_delta") {
        yield { type: "text_delta", text: delta.text };
      } else if (delta.type === "thinking_delta") {
        yield { type: "thinking_delta", text: delta.thinking ?? "" };
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
        cacheRead:
          (final.usage.cache_read_input_tokens ?? 0) +
          (final.usage.cache_creation_input_tokens ?? 0),
      },
    };
  }
}

function toAnthropicContent(content: Message["content"], cacheLast = false): any {
  // Normalize to block form so we can stamp cache_control on the last block.
  const blocks: any[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : content.map((b) => {
          if (b.type === "image") {
            return {
              type: "image",
              source: { type: "base64", media_type: b.mediaType, data: b.data },
            };
          }
          return { ...b };
        });

  if (cacheLast && blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    last.cache_control = { type: "ephemeral" };
  }

  return blocks;
}
