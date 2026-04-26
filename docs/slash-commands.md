# Slash commands

Built-in commands are handled in the TUI directly (they don't hit the model). Custom commands are prompt templates under `.rawdog/commands/*.md`; see [custom-commands.md](custom-commands.md).

## Built-in

| Command | Description |
|---|---|
| `/help` | List commands, including any custom ones |
| `/cost` | Token usage + estimated USD spend (based on provider/model price table) |
| `/context` | Show loaded AGENTS.md / `.rawdog/*` / config / MCP / custom commands |
| `/sessions` | List recent session transcripts |
| `/model <spec>` | Switch provider/model mid-session, preserves history |
| `/login` | Show current key status + storage path; to rotate, run `rawdog login` in a shell |
| `/resume [id]` | List sessions, or hydrate one into the current session |
| `/todo` | Show persistent todo list (`<project>/.rawdog/todo.json`) |
| `/agents` | List / show / rm named subagents; `/agents new <name>` builds one |
| `/compact` | Ask for a history summary to free context |
| `/init` | Create or update `AGENTS.md` at the repo root |
| `/docs [name]` | List rawdog's bundled docs, or read one by name |
| `/clear`, `/new` | Wipe the chat log (in-memory only) |
| `/paste` | Paste image from clipboard |
| `/attach <path>` | Attach an image file |
| `/drop` | Clear all pending attachments |
| `/restart` | Restart rawdog in place |
| `/exit`, `/quit` | Leave |

Reserved names cannot be overridden by a custom command — rawdog warns and skips on collision.

## Adding a new built-in

See [extending.md](extending.md). Push into `BUILTIN_COMMANDS` in `src/index.tsx` and add a handler in `submit()`.
