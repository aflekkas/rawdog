# Overview

rawdog is a minimal TUI agentic harness. Bun + Ink + OpenAI/Anthropic. It is a deliberately thin coding agent that runs as the user, with the user's shell, with no permission system, no approval flow, no sandbox, and no workspace boundary.

## What it is

- A terminal chat UI (Ink) that streams provider responses
- A tool-use loop (`src/agent.ts`) that handles tool calls, truncation, and auto-compaction
- A small set of built-in tools (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `spawn_agent`, `memory`, `sessions`, `webfetch`, `websearch`, `todo`, `docs`)
- Pluggable MCP tool servers over stdio
- Per-project config, context, hooks, custom slash commands, and session transcripts under `.rawdog/`

## Product thesis

The user owns the machine. The agent inherits the user's full capability. The user is sitting at the terminal and can hit `esc` at any time. Speed and directness win over guardrails.

## What it is NOT

These are rejected by design (see [extending.md](extending.md) before proposing one):

- No permission system, approval flow, bash denylist, or sandbox
- No external editor / `$EDITOR` integration
- No git worktree isolation (`/fork`, worktree spawning, parallel branch sandboxes)

If you want seatbelts, use Claude Code or Codex.

## Entry points

- `src/index.tsx` — Ink TUI + CLI entrypoint
- `src/agent.ts` — tool-use loop
- `src/tools.ts` — built-in tools
- `src/providers/` — OpenAI + Anthropic adapters

See [architecture.md](architecture.md) for the full module map.
