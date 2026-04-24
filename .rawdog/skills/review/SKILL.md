---
name: review
description: review the staged diff for bugs, security, and unnecessary abstractions
invisible: true
---

Review the currently-staged diff.

Steps:
1. Run `git diff --staged` (and `git status` for context).
2. Flag anything risky: correctness bugs, security issues, missing error handling at real boundaries, unnecessary abstractions, dead code, accidentally-committed secrets or build artifacts.
3. Keep the review tight — one bullet per real issue, location + problem + suggested fix. Skip praise. Don't re-describe the diff.

Extra focus: $ARGS

If no diff is staged, say so and stop.
