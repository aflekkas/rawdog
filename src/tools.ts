import { $ } from "bun";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDef } from "./providers/types.ts";

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
      description: "Write a file to disk. Creates parent dirs as needed. Overwrites existing files.",
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
];

export const toolDefs = tools.map((t) => t.def);
export const toolMap = Object.fromEntries(tools.map((t) => [t.def.name, t.run]));
