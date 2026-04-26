# Install

```bash
bun install
bun link        # makes `rawdog` available globally on PATH
rawdog          # first run drops into an interactive setup — pick provider, paste key
```

After `bun link`, `rawdog` works from any directory. No per-project `.env` edit required.

## First-run setup

With no API key on the system, `rawdog` (and `rawdog login`) launches an Ink setup screen:

1. Pick a provider (OpenAI / Anthropic).
2. Paste the API key.
3. Key is written to `~/.config/rawdog/.env` (chmod 600) and the TUI continues.

The setup screen is skipped on subsequent runs because the key is loaded via the fallback chain (see "API keys" below).

## Adding or rotating keys

```bash
rawdog login              # picker
rawdog login openai       # target a specific provider
rawdog login anthropic
```

Each invocation overwrites the stored value for that provider. Inside the TUI, `/login` prints current key status and the storage path but does not mutate — use the shell subcommand to actually write.

## Running without linking

```bash
bun start
# or for hot reload during dev:
bun run --watch src/index.tsx
```

## Single binary

```bash
bun run build   # produces bin/rawdog — compiled, no Bun install needed on target
```

The built binary still reads `~/.config/rawdog/.env` and shell env at runtime.

## API keys

Resolution order (first match wins):

1. Shell env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) exported before launch
2. `./.env` in cwd (Bun auto-loads)
3. `$XDG_CONFIG_HOME/rawdog/.env` — or `$HOME/.config/rawdog/.env` if XDG unset (written by `rawdog login`)
4. `$HOME/.rawdog/.env` (legacy; still read)
5. install dir's `.env` (wherever `bun link` was run)

Headless mode (`-p` / piped stdin) with no key prints an error and exits 1 — it cannot prompt.

Relevant variables:

- `OPENAI_API_KEY` — required for OpenAI provider
- `ANTHROPIC_API_KEY` — required for Anthropic provider
- `RAWDOG_PROVIDER` — default provider (`openai` | `anthropic`)
- `XDG_CONFIG_HOME` — honored for the user-global config dir

## Verification

- `bun install` — installs deps
- `bun run typecheck` — type-check (there is no separate build step)
- `bun run build` — compile a standalone binary to `bin/rawdog`
- `bun start` — launches the TUI
