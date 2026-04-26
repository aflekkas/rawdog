# TUI

Rendered with Ink. Streams provider output line-by-line. Tool calls render as dimmed `⎿ name summary` rows below the turn.

## Keybindings

| Key | Effect |
|---|---|
| `enter` | Submit |
| `shift+enter` / `opt+enter` / `\` + `enter` | Insert newline |
| `up` on first line | Pull queued messages into editor (appended to current input). On non-first lines moves cursor up. |
| `esc` | Abort the current turn mid-stream, or clear queued messages if none running |
| `ctrl+c` | Force quit |
| `ctrl+v` | Paste image from clipboard |
| Drag-drop image into terminal | Auto-attach the file |

## Input features

- **`@path` mentions** — `@src/agent.ts what does this do?` reads the file and inlines its contents into the prompt. Works with multiple paths. Missing files are skipped silently.
- **Drag-drop images** — drop an image file into the terminal; path gets auto-attached as an image block.
- **Clipboard paste** — `ctrl+v` reads a PNG/JPEG from the system clipboard.
- **`/attach <path>`** — attach an image file explicitly.
- **`/paste`** — same as `ctrl+v`.
- **`/drop`** — clear all pending attachments.

## Headless mode

When invoked with `-p` or stdin is piped, the TUI is skipped. The agent streams text to stdout and exits when the turn completes. See [cli.md](cli.md).

## Startup banner

Every launch clears the scrollback and prints a randomized welcome line from `src/welcome.ts`. The banner uses ink's native `borderStyle` so it auto-sizes to content — no hand-drawn border chars, no forced-width boxes.

## Resize behaviour

The live region (composer, dividers, prompt, slash-command picker) uses ink's native `borderStyle` / `flexGrow` primitives and re-renders on every frame, so it reflows when the terminal resizes. Anything committed to `<Static>` (the startup banner and every past log entry) stays in scrollback at its original width — terminals can't reflow committed lines. UI code must therefore avoid baking absolute widths into `<Static>` content. See `AGENTS.md` "TUI Scalability" for the full rule set.

## Scrolling while streaming

While rawdog is actively streaming output, the terminal may feel "pinned" to the bottom — scrolling up with the mouse wheel snaps back. Two causes:

1. **tmux without mouse mode.** In tmux, the scroll wheel only scrolls the pane's scrollback if `set -g mouse on` is in `~/.tmux.conf` (or `set-option -g mouse on`). Without it, the wheel sends arrow keys to rawdog instead of scrolling. This is a tmux config, not a rawdog bug.
2. **High-frequency re-paints.** Token streams arrive many times per second; rawdog coalesces live-region updates to ~25 fps so the terminal isn't repainting on every chunk. If you still see snap-to-bottom behavior in a bare terminal (no tmux), that's the terminal's "scroll-lock on output" preference — iTerm2 calls it *Edit → Marks and Notes*, most terminals have an equivalent.

Tool outputs are committed to scrollback as they finish (via `<Static>`), which does append to history — that's intentional, so past tool results stay visible after the turn ends.
