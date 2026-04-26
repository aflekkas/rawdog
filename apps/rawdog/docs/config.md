# Config

Rawdog reads two JSON config files and merges them. Project values win on conflict; `tools.disabled` is unioned so a user-level disable can't be silently re-enabled by a project that omits the field.

1. **User-global** — `$XDG_CONFIG_HOME/rawdog/config.json` (defaults to `~/.config/rawdog/config.json`)
2. **Per-project** — `<project>/.rawdog/config.json` (project root = nearest ancestor containing `.rawdog/`, via `findProjectRoot()` in `src/sessions.ts`)

Both files are optional. Missing file → empty object. Invalid JSON → stderr warning + empty object.

## Schema

```json
{
  "defaultProvider": "openai" | "anthropic",
  "defaultModel":    "<model>",
  "openaiModel":     "<model>",
  "anthropicModel":  "<model>",
  "tools": {
    "disabled": ["<tool_name>", "..."]
  }
}
```

All fields optional. Unknown fields are ignored.

## Field semantics

- `defaultProvider` — initial provider when no `-m` flag. Accepts only `"openai"` or `"anthropic"`.
- `defaultModel` — applied if no `-m` flag and no provider-specific override matches.
- `openaiModel` / `anthropicModel` — used when the resolved provider matches and no explicit model was passed.
- `tools.disabled` — array of built-in or MCP tool names to strip from `toolDefs` at startup. The tools physically don't exist on the agent this session.

## Example (user global)

`~/.config/rawdog/config.json`:

```json
{
  "defaultProvider": "openai",
  "openaiModel": "gpt-4.1-mini"
}
```

## Example (per-project override)

`./myapp/.rawdog/config.json`:

```json
{
  "defaultModel": "gpt-4.1",
  "tools": { "disabled": ["websearch"] }
}
```

In `myapp/`, the merged config is `defaultProvider: openai`, `defaultModel: gpt-4.1`, `openaiModel: gpt-4.1-mini`, `tools.disabled: ["websearch"]`.

## Resolution order (provider + model)

1. CLI `-m` / `--model`
2. Merged config (project overrides user)
3. Env (`RAWDOG_PROVIDER`) + hard defaults

See [providers.md](providers.md) for full model-spec grammar.

## API keys

Keys are **not** in `config.json` — they live in `.env` files (see [install.md](install.md#api-keys)). `rawdog login` writes to `~/.config/rawdog/.env`.
