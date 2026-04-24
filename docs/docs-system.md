# The docs system

Rawdog ships its own manual. The files under `docs/` in the install directory are the single source of truth for what rawdog does. They are readable from the agent at runtime via the `docs` tool and the `/docs` slash command.

## Where they live

`<install-dir>/docs/*.md`

"Install dir" is resolved at runtime from `import.meta.url` of `src/tools.ts` → `..` (the package root). That is also where `package.json` lives. Works whether rawdog was started from its source tree, via `bun link`, or invoked from any unrelated cwd.

## How they're accessed

### `docs` tool

```
docs action=list
docs action=read name=<basename>
```

- `list` — returns every `.md` filename in the docs dir with a one-line preview
- `read` — takes a name like `tools`, `tools.md`, or the full filename; returns the full file text

Output is capped so a huge doc file can't blow up context.

### `/docs` slash command

- `/docs` — lists doc files in the TUI
- `/docs <name>` — prints the contents of the named file in the TUI

Slash version is for the user; tool version is for the agent. They read the same files.

## Hard rule: keep docs in sync

**Any change to rawdog's behavior MUST update the corresponding doc in the same change.**

This applies to:

- Adding, removing, or modifying a tool (`tools.md`)
- Adding, removing, or modifying a slash command (`slash-commands.md`)
- New CLI flags, model specs, resolution order (`cli.md`, `providers.md`)
- New `.rawdog/` files or config keys (`config.md`, relevant feature doc)
- New hook events, lifecycle changes (`hooks.md`)
- New MCP capabilities (`mcp.md`)
- Provider wiring / pricing changes (`providers.md`)
- TUI keybindings or input features (`tui.md`)

Doc updates are not a "follow-up PR." They land with the code. If you are about to ship a change without touching docs, something is wrong — either the change is broken, or the docs are.

This rule is baked into the system prompt so the agent enforces it on itself, and mirrored in `AGENTS.md` so humans see it too.

## When docs belong elsewhere

`README.md` stays a short top-level pointer at the project. `AGENTS.md` is about contributing (style, tests, PRs). Everything descriptive about features goes under `docs/`. If you're tempted to expand `README.md` with feature detail, write a doc file and link to it instead.
