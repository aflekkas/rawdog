import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileSink, Subprocess } from "bun";
import type { ToolDef } from "@aflekkas/vibecli/providers";
import { findProjectRoot } from "./sessions.ts";

export type McpTool = {
  def: ToolDef;
  run: (input: Record<string, unknown>) => Promise<string>;
};

export type McpServerInfo = {
  name: string;
  tools: number;
  error?: string;
};

export type McpSession = {
  tools: McpTool[];
  shutdown: () => Promise<void>;
  serverInfo: McpServerInfo[];
};

type ServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  mcpServers?: Record<string, ServerConfig>;
};

type Pending = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

const MAX_CONTENT_CHARS = 20_000;
const INIT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

class McpClient {
  readonly name: string;
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private stdin: FileSink | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stdoutBuffer = "";
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private closed = false;

  constructor(name: string) {
    this.name = name;
  }

  async start(cfg: ServerConfig): Promise<void> {
    const cmd = [cfg.command, ...(cfg.args ?? [])];
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (cfg.env) for (const [k, v] of Object.entries(cfg.env)) env[k] = v;

    const proc = Bun.spawn(cmd, {
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }) as Subprocess<"pipe", "pipe", "pipe">;

    this.proc = proc;
    this.stdin = proc.stdin;
    void this.readStdout();
    // best-effort drain of stderr so pipe doesn't fill
    void this.drainStderr();
  }

  private async readStdout(): Promise<void> {
    if (!this.proc) return;
    const stream = this.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        this.stdoutBuffer += this.decoder.decode(value, { stream: true });
        this.drainLines();
      }
    } catch {
      // reader closed
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  private drainLines(): void {
    // Try line-delimited first; if a line fails to parse, buffer until balanced.
    while (true) {
      const nl = this.stdoutBuffer.indexOf("\n");
      if (nl < 0) {
        // no newline yet; try parsing the whole buffer (some servers don't terminate)
        const trimmed = this.stdoutBuffer.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed);
          this.stdoutBuffer = "";
          this.dispatch(msg);
        } catch {
          // wait for more
        }
        return;
      }
      const line = this.stdoutBuffer.slice(0, nl).trim();
      const rest = this.stdoutBuffer.slice(nl + 1);
      if (!line) {
        this.stdoutBuffer = rest;
        continue;
      }
      try {
        const msg = JSON.parse(line);
        this.stdoutBuffer = rest;
        this.dispatch(msg);
      } catch {
        // Maybe pretty-printed JSON split across lines: try progressively larger slices.
        // Find next newline that yields a parseable prefix.
        let consumed = false;
        for (let i = nl + 1; i <= this.stdoutBuffer.length; i++) {
          if (i < this.stdoutBuffer.length && this.stdoutBuffer[i] !== "\n") continue;
          const candidate = this.stdoutBuffer.slice(0, i).trim();
          if (!candidate) continue;
          try {
            const msg = JSON.parse(candidate);
            this.stdoutBuffer = this.stdoutBuffer.slice(i + 1);
            this.dispatch(msg);
            consumed = true;
            break;
          } catch {
            // keep searching
          }
        }
        if (!consumed) return; // wait for more bytes
      }
    }
  }

  private dispatch(msg: JsonRpcResponse | any): void {
    // Notifications (no id) — ignore.
    if (msg == null || typeof msg !== "object") return;
    if (msg.id === undefined || msg.id === null) return;
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error(`jsonrpc error ${msg.error.code}: ${msg.error.message}`));
    } else {
      p.resolve(msg.result);
    }
  }

  private async drainStderr(): Promise<void> {
    if (!this.proc) return;
    const stream = this.proc.stderr as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    try {
      while (!this.closed) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // ignore
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async request(method: string, params: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<any> {
    if (!this.stdin) throw new Error("client not started");
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const done = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.stdin.write(this.encoder.encode(payload));
    this.stdin.flush();
    return done;
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (!this.stdin) throw new Error("client not started");
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.stdin.write(this.encoder.encode(payload));
    this.stdin.flush();
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // reject any pending
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("client shutting down"));
    }
    this.pending.clear();
    try { await this.stdin?.end(); } catch {}
    const proc = this.proc;
    if (!proc) return;
    try { proc.kill("SIGTERM"); } catch {}
    const exited = proc.exited;
    const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS));
    const result = await Promise.race([exited.then(() => "exited" as const), timer]);
    if (result === "timeout") {
      try { proc.kill("SIGKILL"); } catch {}
      try { await proc.exited; } catch {}
    }
  }
}

function loadConfig(cwd: string): McpConfig | null {
  const root = findProjectRoot(cwd);
  const path = join(root, ".rawdog", "mcp.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as McpConfig;
  } catch (e: any) {
    process.stderr.write(`mcp: failed to parse ${path}: ${e?.message ?? e}\n`);
    return null;
  }
}

function extractText(result: any): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as any).content;
  let text = "";
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
        text += block.text;
      }
    }
  }
  const prefix = (result as any).isError ? "error: " : "";
  const out = prefix + text;
  if (out.length > MAX_CONTENT_CHARS) {
    return out.slice(0, MAX_CONTENT_CHARS) + `\n... (truncated ${out.length - MAX_CONTENT_CHARS} chars)`;
  }
  return out;
}

export async function startMcp(cwd: string): Promise<McpSession> {
  const config = loadConfig(cwd);
  const servers = config?.mcpServers;
  if (!servers || Object.keys(servers).length === 0) {
    return { tools: [], shutdown: async () => {}, serverInfo: [] };
  }

  const clients: McpClient[] = [];
  const tools: McpTool[] = [];
  const serverInfo: McpServerInfo[] = [];

  await Promise.all(
    Object.entries(servers).map(async ([name, cfg]) => {
      const client = new McpClient(name);
      try {
        await client.start(cfg);
        await client.request(
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            clientInfo: { name: "rawdog", version: "0.1" },
          },
          INIT_TIMEOUT_MS,
        );
        await client.notify("notifications/initialized", {});
        const listed = await client.request("tools/list", {}, INIT_TIMEOUT_MS);
        const rawTools: any[] = Array.isArray(listed?.tools) ? listed.tools : [];
        clients.push(client);
        for (const t of rawTools) {
          const toolName = String(t?.name ?? "");
          if (!toolName) continue;
          const schema = t?.inputSchema && typeof t.inputSchema === "object"
            ? t.inputSchema
            : { type: "object", properties: {} };
          // Normalize — Anthropic/OpenAI both expect type:"object"
          if (schema.type !== "object") schema.type = "object";
          if (!schema.properties || typeof schema.properties !== "object") schema.properties = {};
          const def: ToolDef = {
            name: `mcp__${name}__${toolName}`,
            description: String(t?.description ?? ""),
            input_schema: schema,
          };
          const run = async (input: Record<string, unknown>): Promise<string> => {
            try {
              const result = await client.request("tools/call", { name: toolName, arguments: input });
              return extractText(result);
            } catch (e: any) {
              return `error: ${e?.message ?? String(e)}`;
            }
          };
          tools.push({ def, run });
        }
        serverInfo.push({ name, tools: rawTools.length });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        process.stderr.write(`mcp: server "${name}" failed: ${msg}\n`);
        serverInfo.push({ name, tools: 0, error: msg });
        try { await client.shutdown(); } catch {}
      }
    }),
  );

  const shutdown = async () => {
    await Promise.all(clients.map((c) => c.shutdown().catch(() => {})));
  };

  return { tools, shutdown, serverInfo };
}
