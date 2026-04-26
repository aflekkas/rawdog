# rawdog docs

Self-contained reference for what rawdog is and everything it can do. Every page is a plain markdown file under `docs/` in the rawdog install directory. Rawdog ships with a `docs` tool and a `/docs` slash command so the running agent can read its own manual without leaving the TUI.

## Contents

- [overview.md](overview.md) — what rawdog is, design thesis, what it deliberately won't do
- [install.md](install.md) — install, link, env setup, API keys
- [cli.md](cli.md) — command-line flags, headless mode, stdin piping, model spec
- [tui.md](tui.md) — TUI behavior, input features, keybindings, attachments
- [slash-commands.md](slash-commands.md) — built-in slash commands, custom commands
- [tools.md](tools.md) — every built-in tool, its schema, and when to use it
- [providers.md](providers.md) — OpenAI / Anthropic backends, model selection, pricing
- [config.md](config.md) — `.rawdog/config.json` schema and per-project defaults
- [context.md](context.md) — project-context walk-up, AGENTS.md / CLAUDE.md loading
- [sessions.md](sessions.md) — session transcripts, resume, search
- [hooks.md](hooks.md) — lifecycle hook scripts
- [mcp.md](mcp.md) — MCP server wiring and tool exposure
- [custom-commands.md](custom-commands.md) — authoring `.rawdog/commands/*.md`
- [docs-system.md](docs-system.md) — how docs are stored, accessed, and maintained
- [extending.md](extending.md) — adding tools, providers, and commands in source
- [architecture.md](architecture.md) — module layout and data flow

## Maintaining these docs

Docs are load-bearing — both for humans and for rawdog itself at runtime. The hard rule lives in [docs-system.md](docs-system.md) and is repeated in `AGENTS.md`. Summary: **if you change behavior, update the relevant doc in the same change.** No exceptions for "I'll do it later."
