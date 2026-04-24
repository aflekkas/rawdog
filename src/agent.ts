import type { ContentBlock, Message, Provider, ToolDef } from "./providers/types.ts";
import { toolDefs as baseToolDefs, toolMap as baseToolMap } from "./tools.ts";
import { estimateContextWindow } from "./providers.ts";
import { runHook } from "./hooks.ts";

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export type TurnUsage = { input: number; output: number; cacheRead?: number };

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; output: string }
  | { type: "turn_done"; usage?: TurnUsage }
  | { type: "truncated"; count: number }
  | { type: "compacted"; messagesBefore: number; messagesAfter: number; summaryTokens?: number }
  | { type: "aborted" }
  | { type: "error"; message: string };

export type AgentOptions = {
  cwd?: string;
  extraTools?: { def: ToolDef; run: ToolHandler }[];
  disabledTools?: string[];
};

export type AgentState = {
  messages: Message[];
};

function truncateOldToolResults(messages: Message[]): number {
  // Preserve tool_results in the last 8 messages; truncate older ones.
  const cutoff = Math.max(0, messages.length - 8);
  let count = 0;
  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i];
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;
      if (typeof block.content !== "string") continue;
      if (block.content.startsWith("[truncated ")) continue;
      const originalLength = block.content.length;
      block.content = `[truncated ${originalLength} chars]`;
      count++;
    }
  }
  return count;
}

export function createAgent(
  provider: Provider,
  system: string,
  agentOpts: AgentOptions = {},
) {
  const state: AgentState = { messages: [] };
  let currentSystem = system;
  const cwd = agentOpts.cwd ?? process.cwd();
  const disabled = new Set(agentOpts.disabledTools ?? []);
  const toolDefs: ToolDef[] = [
    ...baseToolDefs.filter((d) => !disabled.has(d.name)),
    ...(agentOpts.extraTools ?? []).map((t) => t.def),
  ];
  const toolMap: Record<string, ToolHandler> = {
    ...baseToolMap,
    ...Object.fromEntries((agentOpts.extraTools ?? []).map((t) => [t.def.name, t.run])),
  };
  for (const name of disabled) delete toolMap[name];

  async function* send(
    userInput: string | ContentBlock[],
    sendOpts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentEvent> {
    const signal = sendOpts.signal;
    state.messages.push({ role: "user", content: userInput });
    await runHook("pre_turn", cwd, { RAWDOG_PROVIDER: provider.name, RAWDOG_MODEL: provider.model });

    // Loop until the model stops calling tools
    for (let iter = 0; iter < 20; iter++) {
      if (signal?.aborted) {
        yield { type: "aborted" };
        await runHook("post_turn", cwd, { RAWDOG_STATUS: "aborted" });
        return;
      }

      // Feature 1: truncate old tool_result blocks before each stream call
      const truncatedCount = truncateOldToolResults(state.messages);
      if (truncatedCount > 0) {
        yield { type: "truncated", count: truncatedCount };
      }

      const assistantBlocks: ContentBlock[] = [];
      let textBuf = "";
      const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let stopReason = "end_turn";
      let usage: TurnUsage | undefined;

      try {
        for await (const ev of provider.stream({
          system: currentSystem,
          messages: state.messages,
          tools: toolDefs,
          signal,
        })) {
          if (ev.type === "text_delta") {
            textBuf += ev.text;
            yield { type: "text", text: ev.text };
          } else if (ev.type === "thinking_delta") {
            yield { type: "thinking", text: ev.text };
          } else if (ev.type === "tool_call") {
            toolCalls.push(ev.call);
          } else if (ev.type === "done") {
            stopReason = ev.stopReason;
            usage = ev.usage;
          }
        }
      } catch (e: any) {
        if (signal?.aborted || e?.name === "AbortError") {
          yield { type: "aborted" };
          await runHook("post_turn", cwd, { RAWDOG_STATUS: "aborted" });
          return;
        }
        yield { type: "error", message: e.message || String(e) };
        return;
      }

      if (textBuf) assistantBlocks.push({ type: "text", text: textBuf });
      for (const c of toolCalls) {
        assistantBlocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
      state.messages.push({ role: "assistant", content: assistantBlocks });

      if (toolCalls.length === 0 || stopReason === "end_turn" || stopReason === "stop") {
        yield { type: "turn_done", usage };
        await runHook("post_turn", cwd, { RAWDOG_STATUS: "ok" });

        // Feature 2: auto-compact at 75% threshold
        const window = estimateContextWindow(provider);
        if (window && usage && typeof usage.input === "number" && usage.input / window > 0.75) {
          const messagesBefore = state.messages.length;
          const keep = 8;
          const cutoff = Math.max(0, state.messages.length - keep);
          const olderMessages = state.messages.slice(0, cutoff);
          const lastFourTurns = state.messages.slice(cutoff);

          if (olderMessages.length > 0) {
            const synthesisPrompt: Message = {
              role: "user",
              content: "Summarize the conversation above in about 500 tokens. Preserve: decisions made, open questions, files/paths touched, current goal. Output only the summary, no preamble.",
            };

            let summary = "";
            let summaryTokens: number | undefined;
            try {
              for await (const ev of provider.stream({
                system: currentSystem,
                messages: [...olderMessages, synthesisPrompt],
                tools: [],
              })) {
                if (ev.type === "text_delta") {
                  summary += ev.text;
                } else if (ev.type === "done") {
                  summaryTokens = ev.usage?.output;
                }
              }
            } catch (e: any) {
              yield { type: "error", message: `compaction failed: ${e.message || String(e)}` };
              return;
            }

            state.messages = [
              { role: "user", content: "<context-summary>\n" + summary + "\n</context-summary>" },
              { role: "assistant", content: "Got it, continuing from that summary." },
              ...lastFourTurns,
            ];

            yield {
              type: "compacted",
              messagesBefore,
              messagesAfter: state.messages.length,
              summaryTokens,
            };
          }
        }
        return;
      }

      // Run tools, gather results
      const results: ContentBlock[] = [];
      for (const call of toolCalls) {
        if (signal?.aborted) {
          yield { type: "aborted" };
          await runHook("post_turn", cwd, { RAWDOG_STATUS: "aborted" });
          return;
        }
        yield { type: "tool_start", name: call.name, input: call.input };
        const handler = toolMap[call.name];
        const toolInputJson = (() => {
          try { return JSON.stringify(call.input); } catch { return ""; }
        })();
        await runHook("pre_tool", cwd, {
          RAWDOG_TOOL: call.name,
          RAWDOG_TOOL_INPUT: toolInputJson.slice(0, 4000),
        });
        let output: string;
        if (!handler) {
          output = `error: unknown tool ${call.name}`;
        } else {
          try {
            output = await handler(call.input);
          } catch (e: any) {
            output = `error: ${e.message}`;
          }
        }
        yield { type: "tool_end", name: call.name, output };
        await runHook("post_tool", cwd, {
          RAWDOG_TOOL: call.name,
          RAWDOG_TOOL_INPUT: toolInputJson.slice(0, 4000),
          RAWDOG_TOOL_OUTPUT: output.slice(0, 2000),
        });
        results.push({ type: "tool_result", tool_use_id: call.id, content: output });
      }
      state.messages.push({ role: "user", content: results });
    }

    yield { type: "error", message: "hit 20 iteration limit" };
  }

  function setSystem(s: string) {
    currentSystem = s;
  }

  return { send, state, setSystem };
}
