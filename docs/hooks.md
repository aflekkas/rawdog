# Hooks

Bash scripts at `<project>/.rawdog/hooks/<event>.sh` run at lifecycle points.

## Events

| Script | When | Env vars |
|---|---|---|
| `pre_turn.sh` | Before each user turn is sent to the provider | `RAWDOG_PROVIDER`, `RAWDOG_MODEL`, `RAWDOG_STATUS` |
| `post_turn.sh` | After each turn finishes | same + final status |
| `pre_tool.sh` | Before each tool call | `RAWDOG_TOOL`, `RAWDOG_TOOL_INPUT` |
| `post_tool.sh` | After each tool call | `RAWDOG_TOOL`, `RAWDOG_TOOL_INPUT`, `RAWDOG_TOOL_OUTPUT` |

## Execution rules

- Run as `bash <script>` with cwd = project root
- 5 second timeout; exceeded → hook is killed
- stdout and stderr are fully drained and discarded
- Any error (spawn failure, non-zero exit, timeout) is swallowed — a broken hook never takes the agent down

## Use cases

- Log every tool call to a file
- Notify a desktop handler (`terminal-notifier`) on turn completion
- Trigger a formatter or lint pass after writes

## What they can't do

- Cancel a tool call — hooks are fire-and-wait, the tool runs regardless
- Modify the tool input/output — the string shown to the model is unchanged
- Communicate back into the conversation — stdout is discarded

If you need the model to react to external state, expose it as a tool instead.
