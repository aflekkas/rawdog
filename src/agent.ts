import type { ContentBlock, Message, Provider, ToolDef } from "./providers/types.ts";
import { toolDefs, toolMap } from "./tools.ts";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; output: string }
  | { type: "turn_done"; usage?: { input: number; output: number; cacheRead?: number } }
  | { type: "error"; message: string };

export type AgentState = {
  messages: Message[];
};

export function createAgent(provider: Provider, system: string) {
  const state: AgentState = { messages: [] };

  async function* send(userInput: string): AsyncGenerator<AgentEvent> {
    state.messages.push({ role: "user", content: userInput });

    // Loop until the model stops calling tools
    for (let iter = 0; iter < 20; iter++) {
      const assistantBlocks: ContentBlock[] = [];
      let textBuf = "";
      const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let stopReason = "end_turn";
      let usage: AgentEvent extends { type: "turn_done" } ? any : any;

      try {
        for await (const ev of provider.stream({
          system,
          messages: state.messages,
          tools: toolDefs,
        })) {
          if (ev.type === "text_delta") {
            textBuf += ev.text;
            yield { type: "text", text: ev.text };
          } else if (ev.type === "tool_call") {
            toolCalls.push(ev.call);
          } else if (ev.type === "done") {
            stopReason = ev.stopReason;
            usage = ev.usage;
          }
        }
      } catch (e: any) {
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
        return;
      }

      // Run tools, gather results
      const results: ContentBlock[] = [];
      for (const call of toolCalls) {
        yield { type: "tool_start", name: call.name, input: call.input };
        const handler = toolMap[call.name];
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
        results.push({ type: "tool_result", tool_use_id: call.id, content: output });
      }
      state.messages.push({ role: "user", content: results });
    }

    yield { type: "error", message: "hit 20 iteration limit" };
  }

  return { send, state };
}
