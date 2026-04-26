import { existsSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "./sessions.ts";

export type HookEvent = "pre_tool" | "post_tool" | "pre_turn" | "post_turn";

function hookPath(event: HookEvent, cwd: string): { root: string; script: string } {
  const root = findProjectRoot(cwd);
  return { root, script: join(root, ".rawdog", "hooks", `${event}.sh`) };
}

export function hasHook(event: HookEvent, cwd: string): boolean {
  return existsSync(hookPath(event, cwd).script);
}

// Fire-and-wait: run the user's hook script, swallow all output, never throw.
// A broken hook should never take the agent down with it.
export async function runHook(
  event: HookEvent,
  cwd: string,
  env?: Record<string, string>,
): Promise<void> {
  const { root, script } = hookPath(event, cwd);
  if (!existsSync(script)) return;

  try {
    const proc = Bun.spawn(["bash", script], {
      cwd: root,
      env: { ...process.env, ...(env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill(); } catch {}
    }, 5000);

    try {
      await proc.exited;
    } finally {
      clearTimeout(timer);
    }

    // Drain pipes so they don't leak. We intentionally discard the content.
    try { await new Response(proc.stdout).text(); } catch {}
    try { await new Response(proc.stderr).text(); } catch {}
    void killed;
  } catch {
    // swallow — hooks are best-effort
  }
}
