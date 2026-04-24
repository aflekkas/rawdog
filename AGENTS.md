# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the full application. `src/index.tsx` is the Ink entrypoint and TUI, `src/agent.ts` runs the provider/tool loop, `src/tools.ts` defines built-in file and shell tools, and `src/providers/` contains backend-specific adapters plus shared types. Root files are intentionally minimal: `package.json` for Bun scripts, `tsconfig.json` for strict TypeScript settings, and `.env.example` for local configuration.

## Build, Test, and Development Commands
Install dependencies with `bun install`. Start the TUI with `bun start`. Use `bun run --watch src/index.tsx` during development for automatic reloads. Run `bunx tsc --noEmit` before opening a PR; there is no separate build output, so type-checking is the main verification step.

## Coding Style & Naming Conventions
This repo uses TypeScript ESM with strict mode enabled. Follow the existing style: 2-space indentation, double quotes, semicolons, and explicit `.ts` imports such as `./agent.ts`. Use `PascalCase` for React components and provider classes, `camelCase` for functions and variables, and keep modules small and single-purpose. Prefer concise comments only where the control flow is not obvious.

## Testing Guidelines
There is no formal test suite yet. For now, verify changes with `bunx tsc --noEmit` and a manual TUI run via `bun start`, especially for provider selection, tool execution, and command handling like `/clear` or `/exit`. If you add automated tests, colocate them under `src/` using `*.test.ts` naming so they stay close to the code they cover.

## Commit & Pull Request Guidelines
Recent commits use short, imperative summaries in lowercase, for example `fail fast on missing api key` and `default to gpt-4.1`. Keep commit messages focused on one behavioral change. PRs should include a brief description, note any env or provider changes, link related issues when relevant, and include terminal screenshots or sample output when the TUI behavior changes.

## Configuration Notes
Keep secrets in `.env`, not in source. Document new variables in `.env.example` and update `README.md` whenever setup, providers, or available tools change.

## TUI Scalability (hard rule)
Terminal panes can be any width, and lines committed to ink's `<Static>` end up in scrollback — which terminals can't reflow. Anything added to the UI must hold up at ~40 cols, render cleanly at ~200 cols, and survive a live resize.

- No `width={columns}` / `width={process.stdout.columns}` on boxes. Let ink auto-size to content, or use flex (`flexGrow`).
- Prefer ink's native `borderStyle` / `paddingX` / `justifyContent` over hand-drawn border chars (`╭─╮│╰╯`). Manual borders bake a fixed width into scrollback and break on resize.
- When a hard-coded width string is unavoidable (e.g. a divider in the live region), recompute it each render from `process.stdout.columns` so resize reflows it. Never put such a string inside `<Static>`.
- Cap long prose (welcome banners, help blurbs) at a readable character count (~72) instead of stretching to the terminal. Stretched text looks fine at startup and catastrophic after a resize.
- Before shipping a UI change, mentally run it at three widths: narrow tmux split (~40), default (~100), huge monitor (~200). If it only looks good at one, redesign.

## Documentation (hard rule)
Rawdog ships its own manual under `docs/`. It is load-bearing — both for humans and for rawdog itself at runtime via the `docs` tool and `/docs` slash command. Docs and code land together.

**Any behavioral change MUST update the relevant file under `docs/` in the same commit.** Non-exhaustive list:

- Tool added/removed/renamed/modified → `docs/tools.md`
- Slash command change → `docs/slash-commands.md`
- CLI flag, model spec, resolution order → `docs/cli.md`, `docs/providers.md`
- New `.rawdog/` file or config key → `docs/config.md` plus the relevant feature doc
- Hook event or lifecycle change → `docs/hooks.md`
- MCP capability change → `docs/mcp.md`
- Provider wiring or pricing → `docs/providers.md`
- TUI keybinding or input feature → `docs/tui.md`
- New doc file → also add a line to `docs/index.md`

If a change ships without updating docs, the change is incomplete. No "follow-up PR." See `docs/docs-system.md` for the full rule and how the docs are surfaced at runtime.
