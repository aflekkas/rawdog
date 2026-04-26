import { existsSync, mkdirSync, readdirSync, appendFileSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Message } from "@aflekkas/vibecli/providers";

// Walk from cwd up toward / looking for an existing .rawdog/ dir. Fall back
// to cwd if none is found — the session machinery auto-creates it.
export function findProjectRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".rawdog"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(cwd);
}

export function sessionsDir(cwd: string): string {
  return join(findProjectRoot(cwd), ".rawdog", "sessions");
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function tsId(): string {
  // 2026-04-23T14-32-00_a1b2c3d4 — filesystem-safe, sortable, collision-proof
  // (the short uuid suffix keeps multiple rawdog instances started in the same
  // second from stomping each other's session file).
  const ts = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
  const uuid = crypto.randomUUID().slice(0, 8);
  return `${ts}_${uuid}`;
}

// Strip base64 image data so transcripts stay small and greppable.
function scrub(msg: Message): Message {
  if (typeof msg.content === "string") return msg;
  return {
    role: msg.role,
    content: msg.content.map((b) => {
      if (b.type === "image") return { type: "text", text: `<image omitted: ${b.mediaType}>` } as any;
      return b;
    }),
  };
}

export type SessionHandle = {
  id: string;
  path: string;
  flushed: number;
};

export function startSession(cwd: string, meta: { provider: string; model: string }): SessionHandle {
  const dir = sessionsDir(cwd);
  ensureDir(dir);
  const id = tsId();
  const path = join(dir, `${id}.jsonl`);
  appendFileSync(
    path,
    JSON.stringify({ kind: "meta", startedAt: new Date().toISOString(), cwd: resolve(cwd), ...meta }) + "\n",
    "utf8",
  );
  return { id, path, flushed: 0 };
}

export function flushMessages(handle: SessionHandle, messages: Message[]): number {
  const chunks: string[] = [];
  for (let i = handle.flushed; i < messages.length; i++) {
    const m = messages[i]!;
    chunks.push(JSON.stringify({ kind: "message", ts: new Date().toISOString(), ...scrub(m) }));
  }
  if (chunks.length === 0) return 0;
  appendFileSync(handle.path, chunks.join("\n") + "\n", "utf8");
  const added = messages.length - handle.flushed;
  handle.flushed = messages.length;
  return added;
}

export type SessionSummary = {
  id: string;
  path: string;
  startedAt: string;
  cwd: string;
  provider: string;
  model: string;
  messages: number;
  preview: string;
  title: string;
  bytes: number;
};

function parseJsonl(path: string): any[] {
  try {
    const txt = readFileSync(path, "utf8");
    const out: any[] = [];
    for (const line of txt.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

function firstUserPreview(lines: any[]): string {
  for (const l of lines) {
    if (l.kind !== "message" || l.role !== "user") continue;
    if (typeof l.content === "string") return l.content.slice(0, 140);
    if (Array.isArray(l.content)) {
      for (const b of l.content) {
        if (b.type === "text" && b.text) return String(b.text).slice(0, 140);
      }
    }
  }
  return "(no user text)";
}

function deriveTitle(lines: any[]): string {
  for (const l of lines) {
    if (l.kind === "title" && typeof l.title === "string") {
      return l.title.replace(/\s+/g, " ").trim().slice(0, 60);
    }
  }
  const preview = firstUserPreview(lines);
  if (preview === "(no user text)") return preview;
  const cleaned = preview.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
}

export function listSessions(cwd: string, limit = 20): SessionSummary[] {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return files.map(({ f, path }) => {
    const lines = parseJsonl(path);
    const meta = lines.find((l) => l.kind === "meta") ?? {};
    const msgs = lines.filter((l) => l.kind === "message");
    const bytes = statSync(path).size;
    return {
      id: f.replace(/\.jsonl$/, ""),
      path,
      startedAt: meta.startedAt ?? "?",
      cwd: meta.cwd ?? "?",
      provider: meta.provider ?? "?",
      model: meta.model ?? "?",
      messages: msgs.length,
      preview: firstUserPreview(lines),
      title: deriveTitle(lines),
      bytes,
    };
  });
}

export function writeSessionTitle(handle: SessionHandle, title: string): void {
  const cleaned = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!cleaned) return;
  appendFileSync(
    handle.path,
    JSON.stringify({ kind: "title", ts: new Date().toISOString(), title: cleaned }) + "\n",
    "utf8",
  );
}

export function readSession(cwd: string, id: string, maxChars = 40_000): string {
  const dir = sessionsDir(cwd);
  const path = join(dir, `${id}.jsonl`);
  if (!existsSync(path)) return `error: no session ${id} in ${dir}`;
  const lines = parseJsonl(path);
  const out: string[] = [];
  for (const l of lines) {
    if (l.kind === "meta") {
      out.push(`# session ${id}  (${l.startedAt}, ${l.provider}:${l.model})`);
      out.push(`# cwd: ${l.cwd}`);
      continue;
    }
    if (l.kind !== "message") continue;
    const role = l.role;
    let text = "";
    if (typeof l.content === "string") text = l.content;
    else if (Array.isArray(l.content)) {
      for (const b of l.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") text += `\n[tool ${b.name} ${JSON.stringify(b.input).slice(0, 200)}]`;
        else if (b.type === "tool_result") text += `\n[tool_result ${String(b.content).slice(0, 400)}]`;
      }
    }
    out.push(`\n---- ${role} ----\n${text}`);
  }
  const joined = out.join("\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars) + `\n\n... (truncated ${joined.length - maxChars} chars, session has more)`;
}

export function searchSessions(
  cwd: string,
  query: string,
  opts: { limit?: number; caseInsensitive?: boolean } = {},
): string {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return `(no sessions dir at ${dir})`;
  const limit = opts.limit ?? 50;
  const flags = opts.caseInsensitive ? "i" : "";
  let re: RegExp;
  try { re = new RegExp(query, flags); } catch (e: any) { return `error: bad regex: ${e.message}`; }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const hits: string[] = [];
  for (const { f, path } of files) {
    const lines = parseJsonl(path);
    for (const l of lines) {
      if (l.kind !== "message") continue;
      let text = "";
      if (typeof l.content === "string") text = l.content;
      else if (Array.isArray(l.content)) {
        for (const b of l.content) {
          if (b.type === "text") text += " " + b.text;
          else if (b.type === "tool_use") text += " " + JSON.stringify(b.input);
          else if (b.type === "tool_result") text += " " + b.content;
        }
      }
      if (re.test(text)) {
        const id = f.replace(/\.jsonl$/, "");
        hits.push(`${id} [${l.role}] ${text.replace(/\s+/g, " ").slice(0, 200)}`);
        if (hits.length >= limit) break;
      }
    }
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) return "(no matches)";
  return hits.join("\n");
}

// Load a previous session's messages for resume. Returns the Message[] stripped
// of the meta line. Used by a future /resume command; exported now so the shape
// is fixed.
export function loadSessionMessages(cwd: string, id: string): Message[] | null {
  const path = join(sessionsDir(cwd), `${id}.jsonl`);
  if (!existsSync(path)) return null;
  const lines = parseJsonl(path);
  const msgs: Message[] = [];
  for (const l of lines) {
    if (l.kind !== "message") continue;
    msgs.push({ role: l.role, content: l.content });
  }
  return msgs;
}
