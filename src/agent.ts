import {
  createAgent as vibecliCreateAgent,
  type Agent,
  type AgentEvent,
  type LifecycleContext,
  type LifecycleEvent,
  type ToolEntry,
  type TurnUsage,
} from "@aflekkas/vibecli/agent";
import type { Provider, ToolDef } from "@aflekkas/vibecli/providers";
import { toolDefs as baseToolDefs, toolMap as baseToolMap } from "./tools.ts";
import { estimateContextWindow } from "./providers.ts";
import { runHook } from "./hooks.ts";

export type { AgentEvent, TurnUsage };

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export type AgentOptions = {
  cwd?: string;
  extraTools?: { def: ToolDef; run: ToolHandler }[];
  disabledTools?: string[];
};

export function createAgent(provider: Provider, system: string, opts: AgentOptions = {}): Agent {
  const cwd = opts.cwd ?? process.cwd();
  const disabled = new Set(opts.disabledTools ?? []);

  const tools: ToolEntry[] = [
    ...baseToolDefs
      .filter((d) => !disabled.has(d.name))
      .map((def) => ({ def, run: baseToolMap[def.name]! })),
    ...(opts.extraTools ?? []),
  ];

  const onLifecycle = async (event: LifecycleEvent, ctx: LifecycleContext) => {
    const env: Record<string, string> = {
      RAWDOG_PROVIDER: provider.name,
      RAWDOG_MODEL: provider.model,
    };
    if (event === "pre_turn") {
      await runHook("pre_turn", cwd, env);
    } else if (event === "post_turn") {
      await runHook("post_turn", cwd, { ...env, RAWDOG_STATUS: ctx.status ?? "ok" });
    } else if (event === "pre_tool") {
      await runHook("pre_tool", cwd, {
        ...env,
        RAWDOG_TOOL: ctx.tool ?? "",
        RAWDOG_TOOL_INPUT: ctx.input ?? "",
      });
    } else if (event === "post_tool") {
      await runHook("post_tool", cwd, {
        ...env,
        RAWDOG_TOOL: ctx.tool ?? "",
        RAWDOG_TOOL_INPUT: ctx.input ?? "",
        RAWDOG_TOOL_OUTPUT: ctx.output ?? "",
      });
    }
  };

  return vibecliCreateAgent(provider, system, {
    tools,
    contextWindow: estimateContextWindow(provider) ?? undefined,
    onLifecycle,
  });
}
