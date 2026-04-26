# 🐕 rawdog

> The AI CLI that does whatever it wants

## Docs

Full manual lives under [`docs/`](docs/). Start at [`docs/index.md`](docs/index.md). Rawdog ships with a `docs` tool and a `/docs` slash command so the agent can read its own manual without leaving the TUI — the `docs` tool is the source of truth when you ask "what can rawdog do?".

**Contributor rule:** any behavioral change updates the relevant file under `docs/` in the same commit. See [`docs/docs-system.md`](docs/docs-system.md) and `AGENTS.md`.

## Setup

```bash
bun install
bun link        # makes `rawdog` available globally
rawdog          # first run drops into an interactive setup — pick provider, paste key
```

The key is saved to `~/.config/rawdog/.env` (chmod 600) and reused on every run. No per-project `.env` needed.

To rotate or add a second provider:

```bash
rawdog login            # provider picker
rawdog login openai
rawdog login anthropic
```

Inside the TUI, `/login` prints current key status and the storage path.

### Single binary (optional)

```bash
bun run build   # produces bin/rawdog — a compiled binary, no Bun install needed on target
```

## Run

Interactive TUI from anywhere, once linked:

```bash
rawdog
```

Or from the project dir without linking:

```bash
bun start
```

Switch providers with `RAWDOG_PROVIDER=anthropic`, `-m anthropic:<model>`, or `/model` inside the TUI.

### CLI

```bash
rawdog                                      # interactive TUI
rawdog "fix the bug in src/agent.ts"        # TUI, prompt auto-submits
rawdog -p "summarize the repo"              # headless, prints and exits
echo "what's in package.json?" | rawdog -p  # stdin piping (auto-headless)
rawdog -m gpt-5-mini                        # override model for this run
rawdog -m anthropic:claude-opus-4-7 "..."   # explicit provider:model
rawdog --resume                             # resume most recent session
rawdog --resume 2026-04-23T14-32-00_abc123  # resume specific session
rawdog -h                                   # help
```

If stdin is piped, rawdog auto-enters headless mode since Ink needs a TTY for keyboard input.

### API keys

Bun auto-loads `.env` from the current directory. When `rawdog` is launched outside its own source tree, it also checks (in order):

1. `$HOME/.config/rawdog/.env`
2. `$HOME/.rawdog/.env`
3. the install dir's `.env` (i.e. `~/Documents/rawdog/.env`)

Already-exported shell env vars always win.

## Slash commands

- `/help` — list commands (includes any custom ones)
- `/cost` — token usage + estimated spend
- `/context` — show loaded AGENTS.md / CLAUDE.md / config / MCP / custom commands
- `/sessions` — list recent session transcripts
- `/model <spec>` — switch provider/model mid-session, preserves history
- `/resume [id]` — list sessions or hydrate one into the current session
- `/todo` — show persistent todo list (stored at `.rawdog/todo.json`)
- `/compact` — ask for a history summary to free context
- `/init` — create `AGENTS.md` in the cwd
- `/clear` / `/new` — wipe the chat log (in-memory only)
- `/paste` / `/attach <path>` / `/drop` — image attachments
- `/restart` — restart in place
- `/exit` or `/quit` — leave
- `ctrl+c` — force quit
- `esc` — abort current turn mid-stream

## Input features

- **`@path` mentions** — `@src/agent.ts what does this do?` reads the file and inlines its contents into the prompt. Works with multiple paths, skips missing files silently.
- **Drag-drop images** — drop an image file into the terminal; its path gets auto-attached.
- **`ctrl+v`** — paste an image from the clipboard.

## Project context

rawdog walks up from cwd to root and loads any `AGENTS.md` or `CLAUDE.md` it finds into every turn's system prompt (nearest first).

Run `/init` to scaffold an `AGENTS.md` in the current directory.

## `.rawdog/` directory

Everything else project-scoped lives here. Walk-up lookup from cwd, so nested dirs inherit.

```
.rawdog/
├── config.json        # per-project defaults (provider, model, disabled tools)
├── mcp.json           # MCP servers to spawn
├── commands/*.md      # custom slash commands
├── hooks/*.sh         # lifecycle hook scripts
├── sessions/*.jsonl   # chat transcripts, auto-appended
└── todo.json          # persistent todo list
```

### Config

`config.json` overrides defaults at startup:

```json
{
  "defaultProvider": "anthropic",
  "anthropicModel": "claude-opus-4-7",
  "openaiModel": "gpt-5-mini",
  "tools": { "disabled": ["websearch"] }
}
```

### MCP servers

`mcp.json` connects external tool servers via stdio:

```json
{
  "mcpServers": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp"] },
    "context7":   { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }
  }
}
```

Their tools become available as `mcp__<server>__<tool>`. Failures in one server don't kill the others — rawdog logs the failure and keeps going.

### Hooks

Drop a bash script at `.rawdog/hooks/<event>.sh` and it runs at that lifecycle point:

- `pre_turn.sh`, `post_turn.sh` — around each user turn (env: `RAWDOG_PROVIDER`, `RAWDOG_MODEL`, `RAWDOG_STATUS`)
- `pre_tool.sh`, `post_tool.sh` — around each tool call (env: `RAWDOG_TOOL`, `RAWDOG_TOOL_INPUT`, `RAWDOG_TOOL_OUTPUT`)

Hooks are best-effort: 5s timeout, stdout/stderr swallowed, a broken hook never takes the agent down.

### Custom slash commands

Drop a markdown file at `.rawdog/commands/<name>.md` and `/<name>` becomes a slash command. Body is the prompt template. `$ARGS` is replaced with whatever the user typed after the command name. Reserved builtin names are skipped with a warning.

Example — `.rawdog/commands/review.md`:

```
Review the staged diff and flag anything risky: $ARGS
Run: git diff --staged
Focus on: security, error handling, unnecessary abstractions.
```

Invoke: `/review extra attention to auth changes`.

### Skills

Skills are slash commands with YAML frontmatter and invisible prompt injection (the Claude Code skill pattern). Drop `.rawdog/skills/<name>/SKILL.md` (project) or `~/.rawdog/skills/<name>/SKILL.md` (user-global). Project wins on name collision. Skills take precedence over custom commands.

```
---
name: review
description: review the staged diff for bugs, security, and abstractions
invisible: true
---

Run git diff --staged and flag anything risky. Focus: $ARGS
```

Frontmatter keys:
- `name` — override dirname as the slash name (optional)
- `description` — shown in `/help` and injected into the system prompt so the model knows the skill exists
- `invisible` — default `true`. When true, the expanded body goes to the model but the log shows just `/<name>` (like a Claude Code skill). Set `false` to mirror the legacy custom-command behavior where the expanded body is visible.

`$ARGS` substitution works the same as custom commands. The builtin `/init` uses this same split-payload pattern hardcoded.

Meta-commands for managing skills:

- `/skills` — list (reloads from disk)
- `/skills show <name>` — print SKILL.md
- `/skills rm <name>` — delete the skill dir (project-scoped only; user-global must be removed manually)
- `/skills new <name>` — launches an interactive builder that asks for description, args, body, visibility, then writes `SKILL.md` for you

### Sessions

Every conversation gets appended to `.rawdog/sessions/<iso-ts>_<uuid>.jsonl` as it happens. Scrubbed of base64 image blobs.

rawdog has a `sessions` tool (list/read/search), so the model itself can recall prior work — ask it "what did we last do on the auth refactor?" and it'll grep its own history. The `/sessions` slash command shows recent ones; `/resume <id>` hydrates one into the current session.

Add `.rawdog/sessions/` to your `.gitignore` if you don't want chat logs in git.

## Tools

Built-in: `bash`, `read`, `write`, `edit`, `grep`, `glob`, `spawn_agent`, `memory`, `sessions`, `webfetch`, `websearch`, `todo`.

MCP tools show up as `mcp__<server>__<name>`.

Disable with `config.tools.disabled: [...]` — names are stripped from `toolDefs` at startup.

## Structure

- `src/index.tsx` — Ink TUI + CLI entrypoint
- `src/agent.ts` — tool-use loop, truncation, auto-compact, hook firing
- `src/tools.ts` — bash / read / write / edit / grep / glob / spawn_agent / memory / sessions / webfetch / websearch / todo
- `src/retry.ts` — retry wrapper for the initial (non-stream) provider call
- `src/providers/` — OpenAI and Anthropic backends (Anthropic uses prompt caching)
- `src/sessions.ts` — JSONL transcript read/write, project-root walker
- `src/config.ts`, `src/hooks.ts`, `src/commands.ts`, `src/mcp.ts`, `src/highlight.ts`

## Extending

Add a tool: push an entry into `tools` in `src/tools.ts`. Schema is JSON Schema.

Add a provider: implement `Provider` in `src/providers/types.ts`, wire into `pickProvider()` in `src/providers.ts`.

Add a slash command: push an entry into `BUILTIN_COMMANDS` in `src/index.tsx` and add a handler in `submit()`. Users can also drop custom commands into `.rawdog/commands/*.md` without touching the source.

## Explicitly excluded

rawdog will NOT grow these, by design. If you open a PR adding one, it gets closed.

- **No permission system, approval flow, bash denylist, or sandbox** — the whole product thesis. If you want seatbelts, use Claude Code or Codex.
- **No external editor integration** — no `$EDITOR` / vim handoff, no ctrl+x-to-editor, no "open this diff in your IDE." You type into the TUI, or you use `@path` mentions.
- **No git worktree isolation** — no `/fork`, no worktree spawning, no parallel branch sandboxes. The model has bash; it can `git worktree` itself if you ask. rawdog itself stays minimal.
