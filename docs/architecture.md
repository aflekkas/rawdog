# Architecture

## Module map

Rawdog is a single-package CLI. Generic Ink + AI SDK primitives live in a separate repo, [`vibecli`](https://github.com/aflekkas/vibecli) at `~/Documents/Projects/vibecli/`, and are consumed via the `vibecli` npm package. Paths below are relative to this repo's root.

### `src/` (rawdog-specific)

| File | Role |
|---|---|
| `index.tsx` | Ink TUI, CLI entrypoint, slash-command dispatcher, system-prompt builder, pricing table |
| `agent.ts` | Tool-use loop, streaming, truncation, auto-compact, hook firing |
| `providers.ts` | `pickProvider()`, `parseProviderSpec()`, context-window estimator |
| `providers/openai.ts` | OpenAI provider (extends `@aflekkas/vibecli/providers/adapter`) |
| `providers/anthropic.ts` | Anthropic provider (extends `@aflekkas/vibecli/providers/adapter`) |
| `tools.ts` | All built-in tool definitions and handlers |
| `sessions.ts` | JSONL transcript read/write, `findProjectRoot()`, list/read/search |
| `config.ts` | `.rawdog/config.json` loader |
| `hooks.ts` | Lifecycle hook runner |
| `commands.ts` | Custom slash command loader |
| `agents.ts` | Custom subagent loader |
| `skills.ts` | Skills loader |
| `mcp.ts` | MCP stdio client |
| `setup.ts`, `setup-ui.tsx` | First-run API-key setup flow |
| `welcome.ts` | Randomized welcome banner lines |

### `vibecli` (separate repo, consumed as a package)

| Subpath | Role |
|---|---|
| `@aflekkas/vibecli/text-input` | Ink text-input widget (cursor, paste, undo) |
| `@aflekkas/vibecli/clipboard` | Image paste / drag-drop helpers |
| `@aflekkas/vibecli/highlight` | Terminal syntax highlighting |
| `@aflekkas/vibecli/ui` | Shared Ink components (color math, wrap, gradient text) |
| `@aflekkas/vibecli/retry` | Exponential-backoff retry wrapper |
| `@aflekkas/vibecli/providers` | `Provider` interface, `Message`, `ContentBlock`, `ToolDef` |
| `@aflekkas/vibecli/providers/adapter` | Vercel AI SDK adapter (`AiSdkProvider`) |

Imported as e.g., `import { TextInput } from "@aflekkas/vibecli/text-input"`. Currently `bun link`'d to `~/Documents/Projects/vibecli/` for local development; once published to npm, this repo will pin a version.

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
