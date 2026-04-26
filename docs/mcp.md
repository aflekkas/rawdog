# MCP

Rawdog speaks [Model Context Protocol](https://modelcontextprotocol.io) as a stdio client. Configured servers are spawned at startup and their `tools/list` output is exposed to the agent as `mcp__<server>__<tool>`.

## Config

`<project>/.rawdog/mcp.json`:

```json
{
  "mcpServers": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp"] },
    "context7":   { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }
  }
}
```

Per-server `env` is also accepted and merges into the child's environment.

## Transport + timeouts

- Stdio JSON-RPC 2.0
- 10s init timeout
- 60s per tool call
- 2s graceful shutdown before SIGKILL
- 20 KB cap on returned content (per call)

## Inspecting servers

`/mcp` lists configured servers with their tool count or init error. `/mcp show <name>` lists the tools that server exposed (descriptions included). `/context` also surfaces a one-line per-server summary.

To add or remove a server, edit `.rawdog/mcp.json` and `/restart` — servers are spawned at startup, so the running session won't pick up config changes on its own.

## Failure handling

If one server fails to start or errors during init, rawdog logs it and keeps going with the remaining servers. `/context` shows per-server status (`name(N tools)` or `name✗ error`). A broken MCP server never kills the agent.

## Shutdown

Servers are shut down on `exit` / `quit` / process signal. Messages in flight are aborted and pending promises rejected.

## Adding more servers

Any MCP-compliant server works as long as it implements `initialize`, `tools/list`, and `tools/call`. Resources and prompts are not currently consumed.

## See also

- [tools.md](tools.md) — how MCP tools interleave with built-ins
- `src/mcp.ts` — client implementation
