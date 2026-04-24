# Custom slash commands

Drop a markdown file at `<project>/.rawdog/commands/<name>.md` and `/<name>` becomes a slash command. The file body is a prompt template; typing `/<name> some args` submits it as a user message.

## Template syntax

- `$ARGS` is replaced with whatever the user typed after the command name. Use it once, use it many times, or omit it.
- The rest of the body is pasted verbatim.

## Description

The first non-empty, non-comment line of the file is used as the `/help` description. Truncated to 80 chars.

## Reserved names

These built-in names cannot be overridden — rawdog prints a warning to stderr and skips the file:

```
help cost context sessions compact init clear new
paste attach drop restart exit quit model resume todo
```

## Example

`.rawdog/commands/review.md`:

```
Review the staged diff and flag anything risky: $ARGS
Run: git diff --staged
Focus on: security, error handling, unnecessary abstractions.
```

Invoke: `/review extra attention to auth changes`.

## Loading

`loadCommands()` in `src/commands.ts` reads the directory at TUI startup. Edits to a command require a restart (or `/restart`). Filenames are lowercased for matching.
