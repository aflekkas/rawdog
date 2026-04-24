# Tools

Built-in tools are defined in `src/tools.ts` as `{ def, run }` entries. `def` is a JSON-Schema tool definition; `run` is an async handler. MCP tools are wired alongside with the prefix `mcp__<server>__<name>`.

Disable any tool via `.rawdog/config.json` — `config.tools.disabled: [...]` strips names from `toolDefs` at startup.

## Built-in tools

### `bash`
Run a shell command. Returns `exit <code>\n<stdout+stderr>`. 30s timeout. 20 KB output cap.

### `read`
Read a file from disk. Returns contents, capped at 50 KB.

### `write`
Write a file. Creates parent dirs. Overwrites existing. Prefer `edit` for modifying existing files.

### `edit`
Replace an exact string in a file. `old_string` must appear exactly once unless `replace_all: true`. Include enough surrounding context to make the match unique.

### `grep`
Regex search across files. Uses ripgrep when available, falls back to `grep`. Returns `file:line:match`. Takes `pattern`, `path`, `glob`, `case_insensitive`, `max_results`.

### `glob`
List files matching a glob (`Bun.Glob`). Example: `src/**/*.ts`, `*.md`. Prefer over `find` / `ls` via bash.

### `spawn_agent`
Delegate a focused task to a fresh subagent with its own context. Returns the subagent's final text. Use for heavy exploration when intermediate tool output would pollute the parent context. Hard depth cap of 3 via `RAWDOG_SUBAGENT_DEPTH`.

### `memory`
Read / write / append to `~/.rawdog/memory.md` (user-global, persists across projects and sessions). Actions: `read`, `write`, `append`.

### `sessions`
Inspect prior session transcripts in `<project>/.rawdog/sessions/`. Actions: `list`, `read` (by id), `search` (regex across all sessions). See [sessions.md](sessions.md).

### `webfetch`
Fetch a URL via `curl`. Strips HTML tags when the response looks like a web page. 20s timeout. Default 15 KB output cap.

### `websearch`
Query DuckDuckGo's HTML endpoint (no API key). Returns title + URL + snippet per result. Default 10 results.

### `todo`
Persistent scratchpad at `<project>/.rawdog/todo.json`. Actions: `list`, `add`, `done`, `remove`, `clear`. Survives across turns and restarts.

### `docs`
List or read rawdog's bundled documentation (the files under `docs/` in the install dir). Actions: `list`, `read` (by name like `tools` or `tools.md`). Use to answer "what can rawdog do?" from primary source. See [docs-system.md](docs-system.md).

## MCP tools

External tool servers connected via `.rawdog/mcp.json` expose tools as `mcp__<server>__<tool>`. See [mcp.md](mcp.md). Failures in one server don't kill others.

## Adding a tool

Push an entry into `tools` in `src/tools.ts`. Schema is JSON Schema. Every new tool should have a one-line entry in this doc; that is part of the hard doc rule.
