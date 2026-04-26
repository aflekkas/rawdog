# Architecture

## Module map

| File | Role |
|---|---|
| `src/index.tsx` | Ink TUI, CLI entrypoint, slash-command dispatcher, system-prompt builder, pricing table |
| `src/agent.ts` | Tool-use loop, streaming, truncation, auto-compact, hook firing |
| `src/providers.ts` | `pickProvider()`, `parseProviderSpec()`, context-window estimator |
| `src/providers/types.ts` | `Provider` interface, `Message`, `ContentBlock`, `ToolDef` |
| `src/providers/openai.ts` | OpenAI chat completions + tool-call adapter |
| `src/providers/anthropic.ts` | Anthropic messages + prompt caching |
| `src/tools.ts` | All built-in tool definitions and handlers |
| `src/retry.ts` | Retry wrapper for the initial non-stream provider call |
| `src/sessions.ts` | JSONL transcript read/write, `findProjectRoot()`, list/read/search |
| `src/config.ts` | `.rawdog/config.json` loader |
| `src/hooks.ts` | Lifecycle hook runner |
| `src/commands.ts` | Custom slash command loader |
| `src/mcp.ts` | MCP stdio client |
| `src/clipboard.ts` | Image paste / drag-drop helpers |
| `src/highlight.ts` | Terminal syntax highlighting |
| `src/text-input.tsx` | Ink text-input widget |
| `src/ui.tsx` | Shared Ink components |
| `src/welcome.ts` | Randomized welcome banner lines |

## Per-turn data flow

1. User submits text in the TUI (or passes a prompt via CLI/stdin).
2. `loadProjectContext(cwd)` walks up for `AGENTS.md` / `CLAUDE.md` / `.rawdog/*.md` and appends them as `<context src="...">…</context>` blocks to `BASE_SYSTEM`.
3. `createAgent()` owns the `messages[]` plus any resumed session state. `extraTools` (MCP) and `disabledTools` are applied.
4. `agent.send(userInput)` streams provider text + tool calls. Each tool call runs, the result is appended, and the loop continues until the provider returns no more tool calls.
5. Pre/post hooks fire around each turn and each tool call (see [hooks.md](hooks.md)).
6. `flushMessages()` appends new messages to the session JSONL.
7. Auto-compact: when history nears the context-window threshold, rawdog summarizes older turns.

## Tool registration

`toolDefs` + `toolMap` are exported from `src/tools.ts`. At agent creation, MCP tools (`mcp__<server>__<name>`) are merged in; disabled names are stripped.

## Subagents

`spawn_agent` creates a fresh `createAgent()` with the parent's provider but a separate message log. Depth is capped at 3 via `RAWDOG_SUBAGENT_DEPTH`.

## Failure behavior

- Missing API key → fail fast on stderr before TUI render
- MCP server init failure → log, keep going with the others
- Hook failure or timeout → swallowed
- Tool error → returned as an `error: ...` string to the model, which decides what to do
