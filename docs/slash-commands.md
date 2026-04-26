# Slash commands

Built-in commands are handled in the TUI directly (they don't hit the model). Custom commands are prompt templates under `.rawdog/commands/*.md`; see [custom-commands.md](custom-commands.md).

## Built-in

| Command | Description |
|---|---|
| `/help` | List commands, including any custom ones |
| `/usage` | Token totals for this session |
| `/context` | Show loaded AGENTS.md / `.rawdog/*` / config / MCP / custom commands |
| `/sessions` | Resume a recent session |
| `/model <spec>` | Switch provider/model mid-session, preserves history |
| `/login` | Show current key status + storage path; to rotate, run `rawdog login` in a shell |
| `/resume [id]` | Resume a recent session; `/resume <id>` loads a specific one directly |
| `/todo` | Show persistent todo list (`<project>/.rawdog/todo.json`) |
| `/agents` | Show / spawn / remove / create subagents |
| `/skills` | Show / remove skills; `/skills new <name>` builds one |
| `/mcp` | List MCP servers and status; `/mcp show <name>` lists that server's tools |
| `/compact` | Ask for a history summary to free context |
| `/init` | Create or update `AGENTS.md` at the repo root |
| `/docs [name]` | Read rawdog's bundled docs; `/docs <name>` opens a specific one directly |
| `/clear`, `/new` | Wipe the chat log (in-memory only) |
| `/paste` | Paste image from clipboard |
| `/attach <path>` | Attach an image file |
| `/drop` | Clear all pending attachments |
| `/restart` | Restart rawdog in place |
| `/exit`, `/quit` | Leave |

Reserved names cannot be overridden by a custom command — rawdog warns and skips on collision.

## Adding a new built-in

See [extending.md](extending.md). Push into `BUILTIN_COMMANDS` in `src/index.tsx` and add a handler in `submit()`.
