import { readFile, writeFile, mkdir, appendFile, stat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { ToolDef } from "./providers/types.ts";
import { pickProvider } from "./providers.ts";
import { listSessions, readSession, searchSessions, findProjectRoot } from "./sessions.ts";
import { loadAgent } from "./agents.ts";

const SUBAGENT_SYSTEM =
  "You are a focused subagent. Complete the given task concisely and return a summary of findings. You have the same tools as the parent.";

const MEMORY_PATH = join(homedir(), ".rawdog", "memory.md");

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export const tools: { def: ToolDef; run: ToolHandler }[] = [
  {
    def: {
      name: "bash",
      description: "Run a shell command and return stdout+stderr. 30s timeout.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
        },
        required: ["command"],
      },
    },
    run: async ({ command }) => {
      const cmd = String(command);
      try {
        const proc = Bun.spawn(["bash", "-lc", cmd], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const timeout = setTimeout(() => proc.kill(), 30_000);
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;
        clearTimeout(timeout);
        const out = [stdout, stderr].filter(Boolean).join("\n").slice(0, 20_000);
        return `exit ${code}\n${out || "(no output)"}`;
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "read",
      description: "Read a file from disk. Returns its contents.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path" },
        },
        required: ["path"],
      },
    },
    run: async ({ path }) => {
      try {
        const txt = await readFile(String(path), "utf8");
        return txt.slice(0, 50_000);
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "write",
      description: "Write a file to disk. Creates parent dirs as needed. Overwrites existing files. Prefer `edit` for modifying existing files.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write" },
          content: { type: "string", description: "File contents" },
        },
        required: ["path", "content"],
      },
    },
    run: async ({ path, content }) => {
      try {
        const p = String(path);
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, String(content), "utf8");
        return `wrote ${p} (${String(content).length} bytes)`;
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "edit",
      description: "Replace an exact string in a file. old_string must appear EXACTLY once unless replace_all is true. Include enough surrounding context to make the match unique. Prefer this over `write` for modifying files.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          old_string: { type: "string", description: "Exact string to find. Must match a single location in the file unless replace_all is true." },
          new_string: { type: "string", description: "Replacement string" },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring uniqueness" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
    run: async ({ path, old_string, new_string, replace_all }) => {
      try {
        const p = String(path);
        const before = await readFile(p, "utf8");
        const needle = String(old_string);
        const replacement = String(new_string);
        if (needle === replacement) return `error: old_string and new_string are identical`;
        if (replace_all) {
          if (!before.includes(needle)) return `error: old_string not found in ${p}`;
          const count = before.split(needle).length - 1;
          const after = before.split(needle).join(replacement);
          await writeFile(p, after, "utf8");
          return `edited ${p} (replaced ${count} occurrence${count === 1 ? "" : "s"})`;
        }
        const idx = before.indexOf(needle);
        if (idx === -1) return `error: old_string not found in ${p}`;
        if (before.indexOf(needle, idx + 1) !== -1) {
          const count = before.split(needle).length - 1;
          return `error: old_string matches ${count} locations in ${p}. Include more surrounding context to make it unique, or pass replace_all: true.`;
        }
        const after = before.slice(0, idx) + replacement + before.slice(idx + needle.length);
        await writeFile(p, after, "utf8");
        return `edited ${p}`;
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "grep",
      description: "Search for a regex pattern across files using ripgrep (falls back to grep). Returns file:line:match lines. Much faster and more targeted than piping to bash.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "File or directory to search (default: current dir)" },
          glob: { type: "string", description: "Optional glob filter, e.g. '*.ts' or '!node_modules'" },
          case_insensitive: { type: "boolean", description: "Case-insensitive match" },
          max_results: { type: "number", description: "Cap result lines (default 200)" },
        },
        required: ["pattern"],
      },
    },
    run: async ({ pattern, path, glob, case_insensitive, max_results }) => {
      const target = String(path || ".");
      const pat = String(pattern);
      const cap = Math.max(1, Math.min(2000, Number(max_results) || 200));

      const runProc = async (argv: string[]) => {
        const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;
        return { code, stdout, stderr };
      };

      const clamp = (s: string) => {
        const lines = s.split("\n");
        if (lines.length <= cap) return s.slice(0, 20_000);
        return lines.slice(0, cap).join("\n") + `\n... (+${lines.length - cap} more lines, raise max_results to see)`;
      };

      try {
        const rgArgs = ["rg", "--line-number", "--no-heading", "--color=never"];
        if (case_insensitive) rgArgs.push("-i");
        if (glob) rgArgs.push("--glob", String(glob));
        rgArgs.push("--", pat, target);
        const r = await runProc(rgArgs);
        if (r.code === 0) return clamp(r.stdout) || "(no matches)";
        if (r.code === 1) return "(no matches)";
        if (r.code !== 127 && !r.stderr.includes("command not found") && !r.stderr.includes("No such file or directory")) {
          return `error: ${r.stderr.slice(0, 1000) || `rg exited ${r.code}`}`;
        }
      } catch {}

      try {
        const grepArgs = ["grep", "-rn"];
        if (case_insensitive) grepArgs.push("-i");
        if (glob) grepArgs.push("--include", String(glob));
        grepArgs.push("-e", pat, target);
        const r = await runProc(grepArgs);
        if (r.code === 0) return clamp(r.stdout) || "(no matches)";
        if (r.code === 1) return "(no matches)";
        return `error: ${r.stderr.slice(0, 1000) || `grep exited ${r.code}`}`;
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "glob",
      description: "List files matching a glob pattern. Uses Bun.Glob. Example patterns: 'src/**/*.ts', '*.md'. Prefer this over `ls` or `find` via bash.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (relative to cwd or root)" },
          root: { type: "string", description: "Directory to search from (default: current dir)" },
          max_results: { type: "number", description: "Cap on returned paths (default 500)" },
        },
        required: ["pattern"],
      },
    },
    run: async ({ pattern, root, max_results }) => {
      try {
        const cap = Math.max(1, Math.min(5000, Number(max_results) || 500));
        const cwd = String(root || process.cwd());
        const glob = new Bun.Glob(String(pattern));
        const matches: string[] = [];
        for await (const m of glob.scan({ cwd, onlyFiles: false, dot: false })) {
          matches.push(m);
          if (matches.length >= cap) break;
        }
        if (matches.length === 0) return "(no matches)";
        matches.sort();
        return matches.join("\n");
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
  {
    def: {
      name: "spawn_agent",
      description: "Delegate a focused task to a fresh subagent with its own conversation context. Returns the subagent's final text response. Use for heavy exploration, codebase research, or any work where you don't want intermediate tool results polluting your context. Pass `name` to load a persistent named subagent from .rawdog/agents/<name>.md (its frontmatter supplies system prompt, tool allowlist, and optional model).",
      input_schema: {
        type: "object",
        properties: {
          task: { type: "string", description: "The task for the subagent" },
          system: { type: "string", description: "Optional override system prompt (ignored if `name` is set)" },
          name: { type: "string", description: "Optional name of a persistent subagent defined in .rawdog/agents/" },
        },
        required: ["task"],
      },
    },
    run: async ({ task, system, name }) => {
      const MAX_DEPTH = 3;
      const depth = Number(process.env.RAWDOG_SUBAGENT_DEPTH || "0");
      if (depth >= MAX_DEPTH) {
        return `error: subagent depth limit (${MAX_DEPTH}) reached; cannot spawn further`;
      }
      const prev = process.env.RAWDOG_SUBAGENT_DEPTH;
      process.env.RAWDOG_SUBAGENT_DEPTH = String(depth + 1);
      try {
        let sys = typeof system === "string" && system ? system : SUBAGENT_SYSTEM;
        let disabledTools: string[] | undefined;
        let provider;
        if (typeof name === "string" && name) {
          const agent = loadAgent(process.cwd(), String(name));
          if (!agent) return `error: no subagent named '${name}' in .rawdog/agents/`;
          sys = agent.system;
          if (agent.tools) {
            const allowed = new Set(agent.tools);
            disabledTools = toolDefs.filter((d) => !allowed.has(d.name)).map((d) => d.name);
          }
          try {
            provider = agent.model ? pickProvider({ model: agent.model }) : pickProvider();
          } catch (e: any) {
            return `error: failed to init provider for model '${agent.model}': ${e.message}`;
          }
        } else {
          provider = pickProvider();
        }
        const { createAgent } = await import("./agent.ts");
        const sub = createAgent(provider, sys, { disabledTools });
        let buf = "";
        for await (const ev of sub.send(String(task))) {
          if (ev.type === "text") buf += ev.text;
          if (ev.type === "error") return "subagent error: " + ev.message;
        }
        return buf || "(subagent returned no text)";
      } catch (e: any) {
        return `error: ${e.message}`;
      } finally {
        if (prev === undefined) delete process.env.RAWDOG_SUBAGENT_DEPTH;
        else process.env.RAWDOG_SUBAGENT_DEPTH = prev;
      }
    },
  },
  {
    def: {
      name: "memory",
      description: "Read, write, or append to persistent memory at ~/.rawdog/memory.md. Use to persist notes, learnings, or context across rawdog sessions.",
      input_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["read", "write", "append"],
            description: "What to do with memory",
          },
          content: { type: "string", description: "Content for write/append" },
        },
        required: ["action"],
      },
    },
    run: async ({ action, content }) => {
      try {
        const act = String(action);
        if (act === "read") {
          try {
            const txt = await readFile(MEMORY_PATH, "utf8");
            return txt || "(empty)";
          } catch (e: any) {
            if (e.code === "ENOENT") return "(empty)";
            throw e;
          }
        }
        if (act === "write") {
          if (typeof content !== "string") return "error: content required for write";
          await mkdir(dirname(MEMORY_PATH), { recursive: true });
          await writeFile(MEMORY_PATH, content, "utf8");
          return `wrote ${Buffer.byteLength(content, "utf8")} bytes`;
        }
        if (act === "append") {
          if (typeof content !== "string") return "error: content required for append";
          await mkdir(dirname(MEMORY_PATH), { recursive: true });
          const chunk = "\n\n## " + new Date().toISOString() + "\n" + content;
          try {
            await stat(MEMORY_PATH);
            await appendFile(MEMORY_PATH, chunk, "utf8");
          } catch (e: any) {
            if (e.code === "ENOENT") {
              await writeFile(MEMORY_PATH, chunk, "utf8");
            } else {
              throw e;
            }
          }
          return `appended ${Buffer.byteLength(chunk, "utf8")} bytes`;
        }
        return `error: unknown action ${act}`;
      } catch (e: any) {
        return `error: ${e.message}`;
      }
    },
  },
];

tools.push({
  def: {
    name: "sessions",
    description: "Look at prior rawdog session transcripts stored in this project's .rawdog/sessions/ directory. Use this to recall what the user and rawdog worked on before — useful for continuity across restarts. Actions: 'list' (recent sessions with previews), 'read' (full transcript by id), 'search' (regex across all sessions).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "search"], description: "Which session operation to run" },
        id: { type: "string", description: "Session id (filename without .jsonl). Required for 'read'." },
        query: { type: "string", description: "Regex to match. Required for 'search'." },
        limit: { type: "number", description: "Cap results (default 20 for list, 50 for search)" },
        case_insensitive: { type: "boolean", description: "For 'search': case-insensitive regex" },
      },
      required: ["action"],
    },
  },
  run: async ({ action, id, query, limit, case_insensitive }) => {
    try {
      const act = String(action);
      const cwd = process.cwd();
      if (act === "list") {
        const rows = listSessions(cwd, Math.max(1, Math.min(200, Number(limit) || 20)));
        if (rows.length === 0) return "(no sessions yet)";
        return rows
          .map((r) => `${r.id}  ${r.provider}:${r.model}  ${r.messages} msgs  (${r.bytes}B)\n  ${r.preview}`)
          .join("\n");
      }
      if (act === "read") {
        if (!id) return "error: 'id' required for read";
        return readSession(cwd, String(id));
      }
      if (act === "search") {
        if (!query) return "error: 'query' required for search";
        return searchSessions(cwd, String(query), {
          limit: Math.max(1, Math.min(500, Number(limit) || 50)),
          caseInsensitive: Boolean(case_insensitive),
        });
      }
      return `error: unknown action ${act}`;
    } catch (e: any) {
      return `error: ${e.message}`;
    }
  },
});

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeHtmlEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

tools.push({
  def: {
    name: "webfetch",
    description: "Fetch a URL and return its text content. Strips HTML tags when the response looks like a web page. 20s timeout.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        max_chars: { type: "number", description: "Cap on returned characters (default 15000)" },
      },
      required: ["url"],
    },
  },
  run: async ({ url, max_chars }) => {
    try {
      const u = String(url);
      const cap = Math.max(500, Math.min(200_000, Number(max_chars) || 15_000));
      const proc = Bun.spawn(["curl", "-sL", "--max-time", "20", "-A", "rawdog/0.1", u], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (code !== 0) {
        return `error: curl exited ${code}${stderr ? ": " + stderr.slice(0, 500) : ""}`;
      }
      let body = stdout;
      const head = body.slice(0, 500).toLowerCase();
      if (head.includes("<html") || head.includes("<!doctype")) {
        body = stripHtml(body);
      }
      if (body.length > cap) {
        return body.slice(0, cap) + "\n... (truncated)";
      }
      return body || "(empty response)";
    } catch (e: any) {
      return `error: ${e.message}`;
    }
  },
});

tools.push({
  def: {
    name: "websearch",
    description: "Search the web via DuckDuckGo's HTML endpoint (no API key). Returns title, URL, and snippet for each result.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Cap on returned results (default 10)" },
      },
      required: ["query"],
    },
  },
  run: async ({ query, max_results }) => {
    try {
      const q = String(query);
      const cap = Math.max(1, Math.min(50, Number(max_results) || 10));
      const proc = Bun.spawn(
        [
          "curl",
          "-sL",
          "--max-time",
          "20",
          "-A",
          "Mozilla/5.0 rawdog",
          "-d",
          "q=" + encodeURIComponent(q),
          "https://html.duckduckgo.com/html/",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (code !== 0) {
        return `error: curl exited ${code}${stderr ? ": " + stderr.slice(0, 500) : ""}`;
      }
      const html = stdout;
      const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      const links: { url: string; title: string }[] = [];
      const snippets: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html)) !== null) {
        let href = m[1] || "";
        const title = stripHtml(m[2] || "");
        if (href.startsWith("//duckduckgo.com/l/") || href.includes("duckduckgo.com/l/")) {
          const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
          if (uddgMatch) {
            try {
              href = decodeURIComponent(uddgMatch[1]!);
            } catch {}
          }
        }
        if (href.startsWith("//")) href = "https:" + href;
        links.push({ url: href, title });
        if (links.length >= cap) break;
      }
      while ((m = snippetRe.exec(html)) !== null) {
        const snip = stripHtml(m[1] || "");
        snippets.push(snip.length > 200 ? snip.slice(0, 200) + "..." : snip);
        if (snippets.length >= cap) break;
      }
      if (links.length === 0) return "(no results)";
      const out: string[] = [];
      for (let i = 0; i < links.length; i++) {
        const l = links[i]!;
        const s = snippets[i] || "";
        out.push(`${i + 1}. ${l.title}\n   ${l.url}\n   ${s}`);
      }
      return out.join("\n");
    } catch (e: any) {
      return `error: ${e.message}`;
    }
  },
});

tools.push({
  def: {
    name: "todo",
    description: "Persistent todo list scratchpad stored at <project>/.rawdog/todo.json. Use this to track multi-step work across turns — the model's own notepad that survives between messages. Actions: 'list', 'add' (text), 'done' (id), 'remove' (id), 'clear'.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "done", "remove", "clear"],
          description: "Which todo operation to run",
        },
        text: { type: "string", description: "Item text (for 'add')" },
        id: { type: "number", description: "Item id (for 'done' and 'remove')" },
      },
      required: ["action"],
    },
  },
  run: async ({ action, text, id }) => {
    try {
      const act = String(action);
      const root = findProjectRoot(process.cwd());
      const dir = join(root, ".rawdog");
      const file = join(dir, "todo.json");
      type Todo = { id: number; text: string; done: boolean; createdAt: string };
      const load = async (): Promise<Todo[]> => {
        try {
          const raw = await readFile(file, "utf8");
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e: any) {
          if (e.code === "ENOENT") return [];
          throw e;
        }
      };
      const save = async (items: Todo[]) => {
        await mkdir(dir, { recursive: true });
        await writeFile(file, JSON.stringify(items, null, 2), "utf8");
      };

      if (act === "list") {
        const items = await load();
        if (items.length === 0) return "(no todos)";
        return items
          .map((t) => `[${t.id}] [${t.done ? "x" : " "}] ${t.text}`)
          .join("\n");
      }
      if (act === "add") {
        if (typeof text !== "string" || !text) return "error: 'text' required for add";
        const items = await load();
        const nextId = items.reduce((mx, t) => Math.max(mx, t.id), 0) + 1;
        const item: Todo = {
          id: nextId,
          text: String(text),
          done: false,
          createdAt: new Date().toISOString(),
        };
        items.push(item);
        await save(items);
        return `added #${nextId}: ${item.text}`;
      }
      if (act === "done") {
        if (typeof id !== "number") return "error: 'id' required for done";
        const items = await load();
        const it = items.find((t) => t.id === id);
        if (!it) return `error: no todo #${id}`;
        it.done = true;
        await save(items);
        return `marked #${id} done: ${it.text}`;
      }
      if (act === "remove") {
        if (typeof id !== "number") return "error: 'id' required for remove";
        const items = await load();
        const idx = items.findIndex((t) => t.id === id);
        if (idx === -1) return `error: no todo #${id}`;
        const [removed] = items.splice(idx, 1);
        await save(items);
        return `removed #${id}: ${removed!.text}`;
      }
      if (act === "clear") {
        const items = await load();
        const n = items.length;
        await save([]);
        return `cleared ${n} items`;
      }
      return `error: unknown action ${act}`;
    } catch (e: any) {
      return `error: ${e.message}`;
    }
  },
});

// rawdog's install dir — resolved from this file's URL so `bun link`'d copies
// still find their bundled docs regardless of cwd.
export const RAWDOG_INSTALL_DIR = resolve(fileURLToPath(import.meta.url), "../..");
export const RAWDOG_DOCS_DIR = join(RAWDOG_INSTALL_DIR, "docs");

async function listDocFiles(): Promise<string[]> {
  try {
    const entries = await readdir(RAWDOG_DOCS_DIR);
    return entries.filter((e) => e.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

function resolveDocName(name: string): string {
  const base = name.endsWith(".md") ? name : name + ".md";
  // prevent path traversal — docs must live directly under the docs dir
  return join(RAWDOG_DOCS_DIR, base.replace(/[\\/]/g, ""));
}

tools.push({
  def: {
    name: "docs",
    description:
      "Read rawdog's own bundled documentation. Use this to answer 'what can rawdog do?' questions authoritatively instead of guessing. Actions: 'list' (every doc file with a one-line preview), 'read' (full file by name like 'tools' or 'tools.md'). Docs live at <install-dir>/docs/*.md and are the source of truth for rawdog's features.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"], description: "Which docs operation" },
        name: { type: "string", description: "Doc filename (with or without .md). Required for 'read'." },
      },
      required: ["action"],
    },
  },
  run: async ({ action, name }) => {
    try {
      const act = String(action);
      if (act === "list") {
        const files = await listDocFiles();
        if (files.length === 0) return `(no docs at ${RAWDOG_DOCS_DIR})`;
        const lines: string[] = [];
        for (const f of files) {
          try {
            const body = await readFile(join(RAWDOG_DOCS_DIR, f), "utf8");
            const firstHeading = body.split("\n").find((l) => l.startsWith("# "))?.replace(/^#\s+/, "") ?? "";
            lines.push(`${f}\t${firstHeading}`);
          } catch {
            lines.push(f);
          }
        }
        return lines.join("\n");
      }
      if (act === "read") {
        if (!name) return "error: 'name' required for read";
        const path = resolveDocName(String(name));
        try {
          const body = await readFile(path, "utf8");
          return body.slice(0, 50_000);
        } catch (e: any) {
          if (e.code === "ENOENT") {
            const files = await listDocFiles();
            return `error: no doc '${name}'. available: ${files.join(", ") || "(none)"}`;
          }
          throw e;
        }
      }
      return `error: unknown action ${act}`;
    } catch (e: any) {
      return `error: ${e.message}`;
    }
  },
});

export const toolDefs = tools.map((t) => t.def);
export const toolMap = Object.fromEntries(tools.map((t) => [t.def.name, t.run]));
