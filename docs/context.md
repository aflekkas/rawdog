# Project context

Every turn's system prompt is `BASE_SYSTEM` + a block of project-context files, loaded from the filesystem at each turn.

## Walk-up lookup

From `cwd`, rawdog walks up toward `/` (capped at 20 levels) and at each directory checks for:

- `AGENTS.md`
- `CLAUDE.md`
- `.rawdog/AGENTS.md`
- `.rawdog/CLAUDE.md`
- `.rawdog/context.md`

Every file that exists (and is non-empty) is appended. Nearest directory first. Each appears wrapped in `<context src="<abspath>">...</context>` so the model sees the provenance.

## `/init`

Creates an empty `.rawdog/AGENTS.md` in the current directory to seed project context. Refuses to overwrite an existing one.

## `/context`

Prints the full list of currently-loaded context files plus config / MCP / custom-command summary.

## When to use which

- `AGENTS.md` in repo root — project-wide conventions, commands, goals
- `.rawdog/AGENTS.md` — rawdog-specific overrides or extra guidance
- `.rawdog/context.md` — scratch context you don't want in the committed `AGENTS.md`

Global user-level docs (the ones at `~/.claude/CLAUDE.md`) are not loaded by rawdog. Keep anything you want rawdog to see under the project tree.
