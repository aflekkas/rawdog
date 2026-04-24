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
