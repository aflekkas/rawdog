# Extending

## Add a tool

Push a new `{ def, run }` entry into `tools` in `src/tools.ts`.

- `def` is a standard JSON-Schema tool definition (`name`, `description`, `input_schema`).
- `run(input)` returns a string that becomes the tool result shown to the model.

Rules of thumb:

- Keep output under ~20 KB; truncate if longer.
- Errors: return a string starting with `error:` rather than throwing.
- If the tool invokes shell commands, add a sensible timeout.
- Document the tool in [tools.md](tools.md) in the same change.

## Add a provider

Implement `Provider` from `src/providers/types.ts` under `src/providers/<name>.ts` and wire it into `pickProvider()` / `parseProviderSpec()` in `src/providers.ts`. Add pricing in `pricePerMTok()` in `src/index.tsx` if you want `/cost` to work. Update [providers.md](providers.md).

## Add a slash command

For a built-in: push an entry into `BUILTIN_COMMANDS` in `src/index.tsx` and add a matching branch in `submit()`. Update [slash-commands.md](slash-commands.md) and, if the command is user-visible, the `HELP_TEXT` string.

For a user-authored one: they drop a markdown file at `.rawdog/commands/<name>.md`. No source change needed. See [custom-commands.md](custom-commands.md).

## Rejected ideas

The product-thesis list in [overview.md](overview.md). PRs that add a permission system, approval flow, bash denylist, sandbox, `$EDITOR` integration, or git worktree isolation get closed.

## Doc rule

Feature changes land with doc changes. Every doc file has a purpose; when that purpose shifts, the doc shifts with it. See [docs-system.md](docs-system.md).
