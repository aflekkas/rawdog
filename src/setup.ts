import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function userConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), ".config");
  return join(base, "rawdog");
}

export function userEnvPath(): string {
  return join(userConfigDir(), ".env");
}

export function userConfigJsonPath(): string {
  return join(userConfigDir(), "config.json");
}

export function hasAnyApiKey(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// Parse a .env file into an ordered list of (key, value, raw) rows so we can
// rewrite it preserving unknown keys + comments.
type EnvRow =
  | { kind: "kv"; key: string; value: string }
  | { kind: "raw"; line: string };

function parseEnv(text: string): EnvRow[] {
  const rows: EnvRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) {
      rows.push({ kind: "raw", line });
      continue;
    }
    let val = m[2]!;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    rows.push({ kind: "kv", key: m[1]!, value: val });
  }
  return rows;
}

function serialize(rows: EnvRow[]): string {
  return rows
    .map((r) => (r.kind === "raw" ? r.line : `${r.key}=${r.value}`))
    .join("\n");
}

// Merge updates into the user-global .env, preserving unknown keys/comments.
// Creates the config dir + file with 0700/0600 perms on first write.
export function writeUserEnv(updates: Record<string, string>): void {
  const dir = userConfigDir();
  const path = userEnvPath();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    try { chmodSync(dir, 0o700); } catch {}
  }

  let rows: EnvRow[] = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : [];
  const seen = new Set<string>();
  rows = rows.map((r) => {
    if (r.kind !== "kv") return r;
    if (r.key in updates) {
      seen.add(r.key);
      return { kind: "kv", key: r.key, value: updates[r.key]! };
    }
    return r;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) rows.push({ kind: "kv", key: k, value: v });
  }

  const body = serialize(rows);
  const final = body.endsWith("\n") ? body : body + "\n";
  writeFileSync(path, final, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}

  // Reflect into current process so the caller can continue without restart.
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }
}
