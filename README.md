# rawdog

minimal TUI agentic harness. Bun + Ink + OpenAI/Anthropic.

## Setup

```bash
cd ~/Documents/rawdog
bun install
cp .env.example .env
# edit .env, set OPENAI_API_KEY
```

## Run

```bash
bun start
```

Or:

```bash
export OPENAI_API_KEY=sk-...
bun run src/index.tsx
```

Switch providers with `RAWDOG_PROVIDER=anthropic` (requires `ANTHROPIC_API_KEY`).

## Commands

- `/exit` or `/quit` — leave
- `/clear` — clear history (in-memory only)
- `ctrl+c` — force quit

## Structure

- `src/index.tsx` — Ink TUI
- `src/agent.ts` — tool-use loop
- `src/tools.ts` — bash / read / write
- `src/providers/` — OpenAI and Anthropic backends behind one interface

## Extending

Add a tool: push an entry into `tools` in `src/tools.ts`. Schema is JSON Schema.

Add a provider: implement `Provider` in `src/providers/types.ts`, wire into `pickProvider()` in `src/index.tsx`.
