# Sessions

Every rawdog conversation is appended, as it happens, to a JSONL transcript at `<project>/.rawdog/sessions/<iso-ts>_<uuid>.jsonl`. Filename is sortable and collision-proof (multiple rawdogs in the same second can't stomp each other).

The project root is found by walking up from cwd for an existing `.rawdog/` dir (`findProjectRoot()`).

## File format

JSONL. First line is a `meta` record with `startedAt`, `cwd`, `provider`, `model`. Subsequent lines are `message` records with `ts`, `role`, `content`. Base64 image blobs are replaced with `<image omitted: <mediaType>>` so transcripts stay greppable.

## Slash commands

- `/sessions` — list recent session summaries (id, message count, preview of first user message)
- `/resume` — list sessions, or `/resume <id>` to hydrate a prior session into the current one (replaces the in-memory message log)

## The `sessions` tool

Exposes the same operations to the model so it can recall past work:

| Action | Args | Returns |
|---|---|---|
| `list` | `limit` | recent sessions with preview |
| `read` | `id` | full transcript (truncated at 40 KB) |
| `search` | `query`, `limit`, `case_insensitive` | regex across all sessions |

Use it when the user references prior work — "what did we last do on the auth refactor?" — instead of guessing.

## Resume at launch

```bash
rawdog --resume                               # most recent
rawdog --resume 2026-04-23T14-32-00_abc123
```

## Gitignore

Add `.rawdog/sessions/` to `.gitignore` if you don't want chat logs committed.
