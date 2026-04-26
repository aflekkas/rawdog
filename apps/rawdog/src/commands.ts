import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "./sessions.ts";

export type CustomCommand = {
  name: string;
  body: string;
  description: string;
  path: string;
};

const RESERVED = new Set([
  "help", "cost", "context", "sessions", "compact", "init", "clear", "new",
  "paste", "attach", "drop", "restart", "exit", "quit", "model", "resume", "todo",
]);

function deriveDescription(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    return line.length > 80 ? line.slice(0, 79) + "…" : line;
  }
  return "(custom)";
}

export function loadCommands(cwd: string): CustomCommand[] {
  const dir = join(findProjectRoot(cwd), ".rawdog", "commands");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CustomCommand[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -3).toLowerCase();
    if (RESERVED.has(name)) {
      process.stderr.write(`rawdog: skipping custom command '${name}' (reserved builtin name)\n`);
      continue;
    }
    const path = join(dir, entry);
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    out.push({ name, body, description: deriveDescription(body), path });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function expandCommand(cmd: CustomCommand, args: string): string {
  return cmd.body.split("$ARGS").join(args ?? "");
}
