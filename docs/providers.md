# Providers

Rawdog ships with two backends.

- `openai` — chat completions + tool calling
- `anthropic` — messages API + tool_use + prompt caching

Selection order at launch:

1. `-m` / `--model` CLI flag (provider inferred from prefix or model name)
2. `.rawdog/config.json` → `defaultProvider`, `defaultModel`, `openaiModel`, `anthropicModel`
3. `RAWDOG_PROVIDER` env var
4. Hard default: OpenAI with `gpt-4.1` unless overridden

If the selected provider's API key is missing, rawdog launches an **interactive setup screen** in a TTY (pick provider, paste key, saved to `~/.config/rawdog/.env` chmod 600). In headless mode (`-p` / piped stdin) it prints an error and exits 1 — piped mode can't prompt. See [install.md](install.md#first-run-setup) and the `rawdog login` subcommand.

## Model spec

```
<model>                     # provider inferred
<provider>:<model>          # explicit
```

Examples: `gpt-5-mini`, `gpt-4.1`, `openai:gpt-5`, `anthropic:claude-opus-4-7`, `anthropic:claude-sonnet-4-6`.

## Switching mid-session

`/model <spec>` swaps the provider/model while preserving conversation history. The existing message log is replayed on the next turn.

## Pricing

`pricePerMTok()` in `src/index.tsx` holds rough per-million-token input/output prices. `/cost` uses this table. Unknown models report "unknown" rather than zero.

## Implementation

- `src/providers.ts` — `pickProvider()`, `parseProviderSpec()`, context-window estimator
- `src/providers/types.ts` — shared `Provider` interface and content-block types
- `src/providers/adapter.ts` — `AiSdkProvider`, the Vercel AI SDK wrapper that both backends extend
- `src/providers/openai.ts`, `src/providers/anthropic.ts` — thin subclasses that inject the right AI SDK model + API key

## Adding a provider

Both backends go through the Vercel AI SDK (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`) via `AiSdkProvider` in `src/providers/adapter.ts`. Adding a new vendor is typically: install `@ai-sdk/<vendor>`, write a ~15-line subclass that mirrors `src/providers/openai.ts`, wire it into `pickProvider()` in `src/providers.ts`, add pricing in `pricePerMTok()`, and update this doc.
