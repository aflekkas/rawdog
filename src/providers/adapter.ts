import { streamText, stepCountIs, jsonSchema, tool, type ModelMessage, type LanguageModel } from "ai";
import type { Message, Provider, StreamEvent, ToolDef } from "./types.ts";
import { withRetry } from "../retry.ts";

export type AdapterOpts = {
  name: string;
  model: string;
  languageModel: LanguageModel;
};

export class AiSdkProvider implements Provider {
  name: string;
  model: string;
  private lm: LanguageModel;
  private sessionId: string;

  constructor(opts: AdapterOpts) {
    this.name = opts.name;
    this.model = opts.model;
    this.lm = opts.languageModel;
    this.sessionId = crypto.randomUUID();
  }

  async *stream(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent> {
    const isAnthropic = this.name === "anthropic";
    const isOpenAI = this.name === "openai";

    const cacheUserIdx = isAnthropic ? findSecondToLastUserIdx(opts.messages) : -1;

    const modelMessages: ModelMessage[] = [
      {
        role: "system",
        content: opts.system,
        ...(isAnthropic
          ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
          : {}),
      },
      ...toModelMessages(opts.messages, { anthropicCacheUserIdx: cacheUserIdx }),
    ];

    const tools = Object.fromEntries(
      opts.tools.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: jsonSchema(t.input_schema as any),
        }),
      ]),
    );

    const providerOptions: Record<string, Record<string, any>> = {};
    if (isAnthropic) {
      providerOptions.anthropic = { thinking: { type: "adaptive" } };
    }
    if (isOpenAI) {
      providerOptions.openai = {
        promptCacheKey: this.sessionId,
        user: `rawdog-${this.sessionId}`,
      };
    }

    const result = await withRetry(() =>
      Promise.resolve(
        streamText({
          model: this.lm,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(1),
          abortSignal: opts.signal,
          providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined,
          ...(isAnthropic ? { maxOutputTokens: 8192 } : {}),
        }),
      ),
    );

    let stopReason = "end_turn";
    let usage: { input: number; output: number; cacheRead?: number } | undefined;

    try {
      for await (const chunk of result.fullStream) {
        if (opts.signal?.aborted) break;
        switch (chunk.type) {
          case "text-delta":
            yield { type: "text_delta", text: (chunk as any).text ?? (chunk as any).delta ?? "" };
            break;
          case "reasoning-delta":
            yield { type: "thinking_delta", text: (chunk as any).text ?? (chunk as any).delta ?? "" };
            break;
          case "tool-call":
            yield {
              type: "tool_call",
              call: {
                id: chunk.toolCallId,
                name: chunk.toolName,
                input: (chunk.input ?? {}) as Record<string, unknown>,
              },
            };
            break;
          case "finish-step":
          case "finish": {
            const anyC = chunk as any;
            const reason = anyC.finishReason;
            if (reason) {
              stopReason = reason === "tool-calls" ? "tool_use" : reason === "stop" ? "end_turn" : reason;
            }
            const u = anyC.usage ?? anyC.totalUsage;
            if (u) {
              usage = {
                input: u.inputTokens ?? 0,
                output: u.outputTokens ?? 0,
                cacheRead: u.cachedInputTokens ?? 0,
              };
            }
            break;
          }
          case "error": {
            const err = (chunk as any).error;
            throw err instanceof Error ? err : new Error(String(err));
          }
        }
      }
    } catch (e: any) {
      if (opts.signal?.aborted || e?.name === "AbortError") {
        yield { type: "done", stopReason: "aborted", usage };
        return;
      }
      throw e;
    }

    yield { type: "done", stopReason, usage };
  }
}

function findSecondToLastUserIdx(messages: Message[]): number {
  const userIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const r = messages[i]!.role;
    if (r === "user" || r === "tool") userIdxs.push(i);
  }
  return userIdxs.length >= 2 ? userIdxs[userIdxs.length - 2]! : -1;
}

function toModelMessages(
  msgs: Message[],
  opts: { anthropicCacheUserIdx: number },
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    const stampCache = i === opts.anthropicCacheUserIdx;

    if (typeof m.content === "string") {
      if (m.role === "assistant") {
        out.push({ role: "assistant", content: m.content });
      } else {
        out.push({
          role: "user",
          content: stampCache
            ? [
                {
                  type: "text",
                  text: m.content,
                  providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
                },
              ]
            : m.content,
        });
      }
      continue;
    }

    if (m.role === "assistant") {
      const parts: any[] = [];
      for (const b of m.content) {
        if (b.type === "text") parts.push({ type: "text", text: b.text });
        else if (b.type === "tool_use") {
          parts.push({
            type: "tool-call",
            toolCallId: b.id,
            toolName: b.name,
            input: b.input,
          });
        }
      }
      if (parts.length) out.push({ role: "assistant", content: parts });
      continue;
    }

    // role 'user' or 'tool' — split tool_result blocks into a tool-role message
    const toolResults = m.content.filter((b) => b.type === "tool_result") as Extract<
      (typeof m.content)[number],
      { type: "tool_result" }
    >[];
    const others = m.content.filter((b) => b.type !== "tool_result");

    if (toolResults.length) {
      out.push({
        role: "tool",
        content: toolResults.map((b, idx) => {
          const isLast = idx === toolResults.length - 1;
          return {
            type: "tool-result",
            toolCallId: b.tool_use_id,
            toolName: b.tool_name ?? "unknown",
            output: { type: "text", value: b.content },
            ...(b.is_error ? { isError: true } : {}),
            ...(stampCache && isLast
              ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
              : {}),
          } as any;
        }),
      });
    }

    if (others.length) {
      const parts: any[] = [];
      for (let j = 0; j < others.length; j++) {
        const b = others[j]!;
        const isLast = j === others.length - 1;
        const stamp = stampCache && isLast && !toolResults.length;
        if (b.type === "text") {
          parts.push({
            type: "text",
            text: b.text,
            ...(stamp
              ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
              : {}),
          });
        } else if (b.type === "image") {
          parts.push({
            type: "image",
            image: b.data,
            mediaType: b.mediaType,
          });
        }
      }
      if (parts.length) out.push({ role: "user", content: parts });
    }
  }
  return out;
}
