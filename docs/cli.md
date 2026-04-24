# CLI

```
rawdog [options] [prompt...]
echo "prompt" | rawdog -p
```

## Options

| Flag | Description |
|---|---|
| `-p`, `--print` | Headless mode. Reads stdin or positional prompt, streams response, exits. |
| `-m <spec>`, `--model <spec>` | Override model for this run. See model spec below. |
| `--resume [id]` | Resume a prior session. Omit id for most recent. |
| `-h`, `--help` | Print help and exit. |

## Positional prompt

Any non-flag arguments are joined with spaces and used as the initial prompt. In TUI mode it auto-submits on first render. In headless mode it combines with stdin.

```bash
rawdog "fix the bug in src/agent.ts"
rawdog -p "summarize the repo"
echo "what's in package.json?" | rawdog -p
```

## stdin piping

If stdin is not a TTY, rawdog auto-enters headless mode (Ink needs a real TTY for keyboard input). Stdin contents are prepended to the positional prompt with a blank-line separator.

## Model spec

Passed via `-m`. Forms accepted:

- `gpt-5` — bare model, provider inferred from model name (`gpt-*` → openai, `claude-*` → anthropic)
- `openai:gpt-5-mini` — explicit provider:model
- `anthropic:claude-opus-4-7` — explicit provider:model

Resolution order at launch: CLI `-m` → `.rawdog/config.json` → env defaults.

## Resume

```bash
rawdog --resume                               # most recent session
rawdog --resume 2026-04-23T14-32-00_abc123    # specific session id
```

Sessions are discovered by walking up from cwd; see [sessions.md](sessions.md).

## Exit codes

- `0` — normal exit
- `1` — missing API key, bad model spec, or headless run with no prompt
