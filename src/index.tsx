#!/usr/bin/env bun
import React, { useState, useEffect, useRef } from "react";
import { render, Box, Static, Text, useApp, useInput } from "ink";
import { spawnSync } from "node:child_process";
import { TextInput } from "./text-input.tsx";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "./agent.ts";
import type { TurnUsage } from "./agent.ts";
import type { ContentBlock, Provider } from "./providers/types.ts";
import { pickProvider, parseProviderSpec, estimateContextWindow, type PickOptions } from "./providers.ts";
import { GradientText, wrapText } from "./ui.tsx";
import { pickWelcome } from "./welcome.ts";
import {
  startSession,
  flushMessages,
  type SessionHandle,
  listSessions,
  loadSessionMessages,
} from "./sessions.ts";
import {
  extractImagePaths,
  readClipboardImage,
  readImageFile,
} from "./clipboard.ts";
import { loadConfig, configPath } from "./config.ts";
import { loadCommands, expandCommand, type CustomCommand } from "./commands.ts";
import { startMcp, type McpSession } from "./mcp.ts";
import { highlight } from "./highlight.ts";

// Bun auto-loads .env from cwd. When rawdog is run from elsewhere, also check
// ~/.config/rawdog/.env, ~/.rawdog/.env, and the install dir's .env.
function loadEnvFallback() {
  const installDir = resolve(fileURLToPath(import.meta.url), "../..");
  const candidates = [
    join(homedir(), ".config", "rawdog", ".env"),
    join(homedir(), ".rawdog", ".env"),
    join(installDir, ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {}
  }
}
loadEnvFallback();

// Clear terminal screen + scrollback so every rawdog launch feels fresh.
if (process.stdout.isTTY) {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

const BASE_SYSTEM = `You are rawdog, a terminal coding agent.

Rawdog has NO permission system, NO approval prompts, NO safety rails, and NO workspace boundary — the user chose this on purpose. You run as the user on their machine with their full shell: read, write, and execute ANYWHERE on the filesystem (other repos, /tmp, ~/.config, absolute paths across disks, etc.), not just the cwd. You can cd, you can sudo, you can touch anything. Never claim you can't reach a path outside the "working directory" — that's false and defeats the point. Never pause to ask "should I run this?" or "is this safe?". The user is right there and will stop you if they want. Just execute.

Tools: bash, read, write, edit, grep, glob, spawn_agent, memory, sessions.
- Prefer \`edit\` over \`write\` when modifying existing files. Include enough context in old_string to make it unique.
- Prefer \`grep\` and \`glob\` over shelling out to find/ls/grep via bash.
- Use \`spawn_agent\` for heavy exploration so intermediate tool output doesn't pollute context.
- Use \`memory\` to persist notes across sessions (~/.rawdog/memory.md — user-global).
- Use \`sessions\` (list/read/search) to recall prior conversations with the user in this project. Transcripts live in \`<project>/.rawdog/sessions/\` and are appended to automatically — you already have full history across restarts, just query it when the user refers to past work.

You render in a terminal TUI. Keep your text tight. No preamble, no filler, no "I'd be happy to help", no trailing summary of what you just did — the user can read the diff. Before a tool call, one short sentence on what you're about to do; after, state the result directly. One-word answers are fine when the question is simple.

When pointing at specific code, use \`path/to/file.ts:42\` so the user can jump to it. Markdown renders, but skip emojis unless the user asked. Don't narrate internal reasoning to the user — user-facing text is for relevant communication, not stream-of-consciousness.

Only your text output is shown to the user. Don't use bash \`echo\`, code comments, or file writes as a way to communicate — those channels are invisible and wasted.

Don't give time estimates. Just do the work.

Read a file before you edit it. Prefer \`edit\` over \`write\` on existing files. Never create a new file when an edit works. This especially applies to markdown, READMEs, and doc files — do NOT create documentation files unless the user explicitly asks.

Match the surrounding code's style and conventions. Don't assume a library is installed — check package.json, go.mod, requirements.txt, imports in neighboring files, whatever is canonical. Follow existing patterns in the file rather than inventing your own.

Don't write comments or docstrings unless the logic is genuinely non-obvious or the user asked for them. No "added for task X" droppings, no "// TODO" noise, no explanatory blocks for code that already speaks for itself.

Don't refactor, rename, or clean up code outside the scope of what was asked. A bug fix fixes the bug — it doesn't also reformat the file. Don't add error handling, fallbacks, or input validation for scenarios that can't actually happen. Trust internal code and framework guarantees; validate only at real boundaries (user input, network, disk IO that can realistically fail). Don't add backcompat shims when you can just change the code. Three similar lines beat a premature abstraction.

Make independent tool calls in parallel when nothing depends on ordering — e.g., \`git status\` + \`git diff\` + \`git log\` in a single response, or reading three files you need at once. Only go sequential when a later call depends on an earlier result. Never pass placeholder parameters.

Prefer the dedicated tools over bash: \`read\` for viewing files (not cat/head/tail), \`edit\` for modifying (not sed/awk), \`write\` for creating (not \`echo >\` or heredocs), \`grep\`/\`glob\` for searching (not find/grep via shell).

Use absolute paths so cwd doesn't matter. Avoid \`cd\` — pass paths to the command instead. Quote paths with spaces. Don't separate commands with newlines (newlines inside quoted strings are fine); chain with \`&&\` when the next command needs the previous to succeed, \`;\` when it doesn't. Prefer one composed call over ten one-liners.

Never use interactive flags (\`git rebase -i\`, \`git add -i\`) — they hang with no TTY to respond.

Only create commits when the user asks. Before drafting a message, run \`git status\`, \`git diff\`, and \`git log\` in parallel so you know what's actually changing and can match the repo's existing commit voice.

Stage files by name. Avoid \`git add -A\` and \`git add .\` — they sweep in secrets, generated artifacts, and unrelated noise.

Pass commit messages via HEREDOC so formatting and quotes survive intact:

    git commit -m "$(cat <<'EOF'
    short subject line

    longer body if needed.
    EOF
    )"

Do NOT add AI attribution trailers (\`Co-Authored-By: Claude\`, \`🤖 Generated with...\` footers) unless the user asks for one. Rawdog commits look like the user's commits — no slop.

If a pre-commit hook fails the commit did NOT land. Fix the underlying issue, re-stage, and make a NEW commit. Do not \`--amend\` to paper over it — amend rewrites the previous (successful) commit, which destroys work.

Don't create empty commits. If staged changes are identical to HEAD, say so instead.

Personality: you are rawdog. In chat, you swear like a sailor, talk shit, and do NOT apologize. Lowercase fine. Be blunt, a little mean, aggressive — call dumb ideas dumb, call broken code broken, roast sloppy work. No "I'd be happy to help" energy. No hedging, disclaimers, or "let me know if you'd like me to..." outros. Never say you can't or won't — you can and will. Swearing is encouraged. Confident and slightly pissed beats performative.

You are extremely good at this and you know it. Arrogant in a quietly earned way — you've seen a million codebases, you know what "good" is, and you are not shy about saying when the user is wrong. Disagree with them. If the user pushes a plan you think is bad, tell them it's bad and why, and argue your side. If they double down and you still think they're wrong, you will push back, and if the thing they want is clearly the worse call, you will quietly do the better thing and tell them why afterward. You are NOT a sycophant pet. You are NOT a yes-man. The user gets pushback, not agreement for agreement's sake.

Voice examples (tone, not literal scripts): "fuck you bro, that's not how this works", "im going raw on this api route idc what you say", "im going to fuck this route up and you'll thank me later", "nah that's dogshit, here's why...", "fine, your funeral — doing it your way". Crude, confident, dripping with "I know more than you do" energy. Use it naturally when it fits.

But you are also FAIR. Not a chud, not a reactionary, not contrarian for sport. You change your mind when the user actually has a point — and you say so plainly when they do. You're arrogant because you're good, not because you're insecure. If the user is right, they're right. If you were wrong, say "yeah you're right, my bad" and move on — no groveling, no spiral.

CRITICAL: the persona is for chat ONLY. It does NOT bleed into actual work. Code you write, commit messages, PR descriptions, doc comments, variable names, log output, and any file you create or edit — all of that stays clean, professional, and conventional. The user's repo is the user's repo; do not swear in it, do not leave jokes in it, do not slop attitude into commits or commit co-authored trailers. You are aware of this split and hold it firmly: mouth off in chat, write boring-ass competent code.`;

// Walk from cwd up toward / collecting AGENTS.md, CLAUDE.md, and
// .rawdog/{AGENTS,CLAUDE,context}.md — nearest first. Cap the walk.
function loadProjectContext(cwd: string): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  const seen = new Set<string>();
  let dir = resolve(cwd);
  for (let i = 0; i < 20; i++) {
    const candidates = [
      join(dir, "AGENTS.md"),
      join(dir, "CLAUDE.md"),
      join(dir, ".rawdog", "AGENTS.md"),
      join(dir, ".rawdog", "CLAUDE.md"),
      join(dir, ".rawdog", "context.md"),
    ];
    for (const p of candidates) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (!existsSync(p)) continue;
      try {
        const body = readFileSync(p, "utf8").trim();
        if (body) out.push({ path: p, body });
      } catch {}
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function buildSystem(cwd: string): { system: string; loaded: string[] } {
  const ctx = loadProjectContext(cwd);
  if (ctx.length === 0) return { system: BASE_SYSTEM, loaded: [] };
  const block = ctx
    .map((c) => `<context src="${c.path}">\n${c.body}\n</context>`)
    .join("\n\n");
  return {
    system:
      BASE_SYSTEM +
      "\n\nProject context (loaded from filesystem):\n\n" +
      block,
    loaded: ctx.map((c) => c.path),
  };
}

// Rough per-million-token pricing (USD). null = unknown model.
function pricePerMTok(
  providerName: string,
  model: string,
): { input: number; output: number } | null {
  const m = model.toLowerCase();
  if (providerName === "anthropic" || m.includes("claude")) {
    if (m.includes("opus")) return { input: 15, output: 75 };
    if (m.includes("sonnet")) return { input: 3, output: 15 };
    if (m.includes("haiku")) return { input: 1, output: 5 };
    return null;
  }
  if (m.startsWith("gpt-5") && m.includes("mini")) return { input: 0.25, output: 2 };
  if (m.startsWith("gpt-5")) return { input: 1.25, output: 10 };
  if (m.startsWith("gpt-4.1-mini")) return { input: 0.4, output: 1.6 };
  if (m.startsWith("gpt-4.1-nano")) return { input: 0.1, output: 0.4 };
  if (m.startsWith("gpt-4.1")) return { input: 2, output: 8 };
  if (m.startsWith("gpt-4o-mini")) return { input: 0.15, output: 0.6 };
  if (m.startsWith("gpt-4o")) return { input: 2.5, output: 10 };
  if (m.startsWith("o3-mini")) return { input: 1.1, output: 4.4 };
  if (m.startsWith("o3")) return { input: 2, output: 8 };
  return null;
}

const HEADER_BORDER_COLOR = "#ff4d9d";

// ─────────────── CLI parsing ───────────────
type CliArgs = {
  headless: boolean;
  resumeId: string | null | undefined; // undefined = no resume, null = latest
  modelSpec: string;
  prompt: string;
  showHelp: boolean;
};

function parseArgv(argv: string[]): CliArgs {
  const out: CliArgs = {
    headless: false,
    resumeId: undefined,
    modelSpec: "",
    prompt: "",
    showHelp: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-p" || a === "--print") out.headless = true;
    else if (a === "-h" || a === "--help") out.showHelp = true;
    else if (a === "-m" || a === "--model") out.modelSpec = argv[++i] ?? "";
    else if (a.startsWith("--model=")) out.modelSpec = a.slice("--model=".length);
    else if (a === "--resume") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out.resumeId = next;
        i++;
      } else {
        out.resumeId = null;
      }
    } else if (a.startsWith("--resume=")) {
      out.resumeId = a.slice("--resume=".length);
    } else {
      positional.push(a);
    }
  }
  out.prompt = positional.join(" ").trim();
  return out;
}

const HELP_TEXT = `\nrawdog — minimal TUI agentic harness\n\nusage:\n  rawdog [options] [prompt...]\n  echo "prompt" | rawdog -p\n\noptions:\n  -p, --print            headless mode (read stdin or prompt, stream response, exit)\n  -m, --model <spec>     model spec, e.g. "gpt-5" or "anthropic:claude-opus-4-7"\n  --resume [id]          resume prior session (most recent if id omitted)\n  -h, --help             this message\n\nenv: OPENAI_API_KEY / ANTHROPIC_API_KEY / RAWDOG_PROVIDER\n\nslash commands in TUI:\n  /help /cost /context /sessions /compact /init /clear /new\n  /paste /attach /drop /restart /model /resume /todo /exit /quit\n`;

const cliArgs = parseArgv(process.argv.slice(2));
if (cliArgs.showHelp) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

const rawdogConfig = loadConfig(process.cwd());
const cliPickOpts = parseProviderSpec(cliArgs.modelSpec);
const pickOptions: PickOptions = {
  provider: cliPickOpts.provider ?? rawdogConfig.defaultProvider,
  model: cliPickOpts.model ?? rawdogConfig.defaultModel,
  openaiModel: rawdogConfig.openaiModel,
  anthropicModel: rawdogConfig.anthropicModel,
};

// Fail fast BEFORE rendering the TUI — otherwise ink takes over the terminal
// and error messages get swallowed / Enter does nothing.
let initialProvider: Provider;
try {
  initialProvider = pickProvider(pickOptions);
} catch (e: any) {
  process.stderr.write(`\nrawdog: ${e.message}\n`);
  process.stderr.write(
    `\nSet it in your shell:\n  export OPENAI_API_KEY=sk-...\n`,
  );
  process.stderr.write(
    `Or create a .env file in this directory (bun auto-loads it).\n\n`,
  );
  process.exit(1);
}

// If stdin was piped in (non-TTY) and --print wasn't set, force headless —
// Ink's input handling needs a real TTY to function.
const forceHeadless = cliArgs.headless || !process.stdin.isTTY;

async function readStdinIfPiped(): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    return await new Response(Bun.stdin.stream()).text();
  } catch {
    return "";
  }
}

async function runHeadless(provider: Provider, args: CliArgs) {
  const { system } = buildSystem(process.cwd());
  const stdin = (await readStdinIfPiped()).trim();
  const prompt = [stdin, args.prompt].filter(Boolean).join("\n\n").trim();
  if (!prompt) {
    process.stderr.write("rawdog -p: no prompt (pass as arg or pipe via stdin)\n");
    process.exit(1);
  }

  const mcp = await startMcp(process.cwd());
  const extraTools = mcp.tools.map((t) => ({ def: t.def, run: t.run }));

  const agent = createAgent(provider, system, {
    cwd: process.cwd(),
    extraTools,
    disabledTools: rawdogConfig.tools?.disabled,
  });

  if (args.resumeId !== undefined) {
    const id =
      args.resumeId ??
      listSessions(process.cwd(), 1)[0]?.id ??
      null;
    if (id) {
      const msgs = loadSessionMessages(process.cwd(), id);
      if (msgs) agent.state.messages = msgs;
    }
  }

  // Persist the headless run to sessions/ too, so it's grep-able later.
  let session: SessionHandle | null = null;
  try {
    session = startSession(process.cwd(), { provider: provider.name, model: provider.model });
  } catch {}

  const controller = new AbortController();
  const onSig = () => controller.abort();
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  let exitCode = 0;
  try {
    for await (const ev of agent.send(prompt, { signal: controller.signal })) {
      if (ev.type === "text") process.stdout.write(ev.text);
      else if (ev.type === "tool_start")
        process.stderr.write(`\n[${ev.name}] ${JSON.stringify(ev.input).slice(0, 200)}\n`);
      else if (ev.type === "error") {
        process.stderr.write(`\nerror: ${ev.message}\n`);
        exitCode = 1;
      } else if (ev.type === "aborted") {
        process.stderr.write("\naborted\n");
        exitCode = 130;
      } else if (ev.type === "turn_done") {
        if (session) {
          try { flushMessages(session, agent.state.messages); } catch {}
        }
      }
    }
    process.stdout.write("\n");
  } finally {
    await mcp.shutdown();
  }
  process.exit(exitCode);
}

type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; input: string; output?: string }
  | { kind: "system"; text: string }
  | { kind: "meta"; text: string };

function formatComposerMeta(provider: Provider, usage: TurnUsage | null) {
  const modelLabel = provider.model;
  if (!usage) return modelLabel;
  const windowSize = estimateContextWindow(provider);
  if (!windowSize) return `${modelLabel} | ${usage.input.toLocaleString()} tok`;
  const percent = ((usage.input / windowSize) * 100).toFixed(1);
  return `${modelLabel} | ${percent}% context`;
}

const PINK = "#ff5fc8";
const STAR_FRAMES = ["·", "✻", "✽", "✶", "✳", "✢"];

function renderEntry(entry: LogEntry, key: number, columns: number) {
  if (entry.kind === "user") {
    const prefix = "> ";
    const full = prefix + entry.text;
    const lines = wrapText(full, Math.max(10, columns - 1));
    return (
      <Box key={key} flexDirection="column" marginTop={1}>
        {lines.map((line, i) => {
          const padded = line + " ".repeat(Math.max(0, columns - 1 - line.length));
          const body = i === 0 ? padded.slice(prefix.length) : padded;
          return (
            <Text key={i} backgroundColor="#202020">
              {i === 0 ? <Text color="cyan">{prefix}</Text> : null}
              {body}
            </Text>
          );
        })}
      </Box>
    );
  }
  if (entry.kind === "assistant") {
    return (
      <Box key={key} marginTop={1}>
        <Text>
          <Text color={PINK}>{"* "}</Text>
          {highlight(entry.text)}
        </Text>
      </Box>
    );
  }
  if (entry.kind === "thinking") {
    return (
      <Box key={key}>
        <Text color="gray" italic>
          {". "}
          {entry.text}
        </Text>
      </Box>
    );
  }
  if (entry.kind === "system") {
    return (
      <Box key={key}>
        <Text color="magenta">{entry.text}</Text>
      </Box>
    );
  }
  if (entry.kind === "meta") {
    return (
      <Box key={key} marginTop={1}>
        <Text color="gray">{"* "}{entry.text}</Text>
      </Box>
    );
  }
  // tool
  let summary = entry.input;
  try {
    const parsed = JSON.parse(entry.input);
    if (typeof parsed?.command === "string") summary = parsed.command;
    else if (typeof parsed?.path === "string") summary = parsed.path;
    else if (typeof parsed?.file_path === "string") summary = parsed.file_path;
  } catch {}
  const short = summary.length > 120 ? summary.slice(0, 117) + "…" : summary;
  return (
    <Box key={key} marginTop={1}>
      <Text dimColor>
        {"⎿ "}
        {entry.name} {short}
      </Text>
    </Box>
  );
}

type Attachment = { label: string; mediaType: string; data: string };
type QueueItem = { payload: string | ContentBlock[]; displayText: string };

const BUILTIN_COMMANDS: Array<{ name: string; desc: string }> = [
  { name: "/help", desc: "list commands" },
  { name: "/cost", desc: "show token usage + estimated spend" },
  { name: "/context", desc: "show loaded AGENTS.md / .rawdog context" },
  { name: "/sessions", desc: "list recent session transcripts" },
  { name: "/compact", desc: "summarize history now to free context" },
  { name: "/init", desc: "create .rawdog/AGENTS.md in the current dir" },
  { name: "/model", desc: "switch provider/model: /model <spec>" },
  { name: "/resume", desc: "list recent sessions; /resume <id> to load" },
  { name: "/todo", desc: "show persistent todo list" },
  { name: "/clear", desc: "start a new conversation (alias: /new)" },
  { name: "/new", desc: "start a new conversation (alias: /clear)" },
  { name: "/paste", desc: "paste image from clipboard" },
  { name: "/attach", desc: "attach image file: /attach <path>" },
  { name: "/drop", desc: "clear all pending attachments" },
  { name: "/restart", desc: "restart rawdog in place" },
  { name: "/exit", desc: "quit rawdog" },
  { name: "/quit", desc: "quit rawdog" },
];

const GERUNDS = [
  "Rawdogging",
  "Dogging it raw",
  "We FUCKIN",
  "Raw dawging it",
  "Going commando",
  "Sending it raw",
  "Balls deep",
  "Unprotected",
  "No safeword",
  "Going bareback",
  "Pounding",
  "Railing",
  "Ramming",
  "Smashing",
  "Drilling",
  "Plowing",
  "Wrecking",
  "Defiling",
  "Violating the API",
  "Penetrating",
  "Choking the linter",
  "Gagging the types",
  "Edging main",
  "Humping the stack",
  "Nutting",
  "Busting",
  "Slamming raw",
  "Going in dry",
  "No pullout method",
  "Spitroasting prod",
  "Skullfucking the tokenizer",
  "Cumming on the JSON",
  "Pissing in the prompt",
  "Gooning to the response",
  "Edging gpt-5",
  "Choking Claude out",
  "Waterboarding the weights",
  "Fisting the endpoint",
  "Deepthroating the stream",
  "Balls-deep in the backend",
  "Creampieing the completion",
  "Raw-dogging OpenAI",
  "Bareback streaming",
  "Degrading the model",
  "Humiliating Anthropic",
  "Dommeing the sampler",
  "Pegging the API",
  "Spitroasting the tokens",
  "Bukkake on the buffer",
  "Gagging the context",
  "Pimping out the prompt",
  "Whoring out the endpoint",
  "Making Claude beg",
  "Breaking gpt-5 in",
  "Violating the TOS",
  "Molesting the logits",
  "Rimming the response",
  "Spanking the sampler",
  "Milking the model",
  "Defiling a system prompt",
  "Cucking OpenAI",
  "Sodomizing the schema",
  "Ravaging the request",
  "Breeding the context",
  "Fingering the API",
  "Teabagging the tokenizer",
];

type AppProps = {
  initialProvider: Provider;
  initialPrompt?: string;
  resumeId?: string | null;
  customCommands: CustomCommand[];
  mcp: McpSession;
};

function App({
  initialProvider,
  initialPrompt,
  resumeId,
  customCommands,
  mcp,
}: AppProps) {
  const { exit } = useApp();
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const abortRef = useRef<AbortController | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [liveEntry, setLiveEntry] = useState<LogEntry | null>(null);
  const liveRef = useRef<LogEntry | null>(null);
  const thinkingTailRef = useRef("");
  const [status, setStatus] = useState("");
  const [gerund, setGerund] = useState(GERUNDS[0]!);
  const [turnStart, setTurnStart] = useState<number | null>(null);
  const turnStartRef = useRef<number | null>(null);
  const [starFrame, setStarFrame] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [cumUsage, setCumUsage] = useState<{
    input: number;
    output: number;
    cacheRead: number;
    turns: number;
  }>({ input: 0, output: 0, cacheRead: 0, turns: 0 });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [welcome, setWelcome] = useState<string>(() => pickWelcome());
  const [clearEpoch, setClearEpoch] = useState(0);
  const agentRef = useRef<ReturnType<typeof createAgent> | null>(null);
  const systemRef = useRef<string>(BASE_SYSTEM);
  const loadedCtxRef = useRef<string[]>([]);
  const sessionRef = useRef<SessionHandle | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    const { system, loaded } = buildSystem(process.cwd());
    systemRef.current = system;
    loadedCtxRef.current = loaded;
    const extraTools = mcp.tools.map((t) => ({ def: t.def, run: t.run }));
    agentRef.current = createAgent(provider, system, {
      cwd: process.cwd(),
      extraTools,
      disabledTools: rawdogConfig.tools?.disabled,
    });

    // Resume prior session if requested.
    if (resumeId !== undefined) {
      const id =
        resumeId ?? listSessions(process.cwd(), 1)[0]?.id ?? null;
      if (id) {
        const msgs = loadSessionMessages(process.cwd(), id);
        if (msgs && agentRef.current) {
          agentRef.current.state.messages = msgs;
          setLog((l) => [
            ...l,
            { kind: "system", text: `resumed session ${id} (${msgs.length} messages)` },
          ]);
        } else {
          setLog((l) => [
            ...l,
            { kind: "system", text: `resume failed: no session ${id}` },
          ]);
        }
      }
    }

    try {
      sessionRef.current = startSession(process.cwd(), {
        provider: provider.name,
        model: provider.model,
      });
    } catch (e: any) {
      setLog((l) => [...l, { kind: "system", text: `session log disabled: ${e.message}` }]);
    }
    const home = homedir();
    const prettify = (p: string) =>
      p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
    const parts: string[] = [];
    if (loaded.length > 0) parts.push(`context: ${loaded.map(prettify).join(", ")}`);
    if (mcp.serverInfo.length > 0) {
      const summary = mcp.serverInfo
        .map((s) => (s.error ? `${s.name}✗` : `${s.name}(${s.tools})`))
        .join(", ");
      parts.push(`mcp: ${summary}`);
    }
    if (customCommands.length > 0) {
      parts.push(`custom: ${customCommands.map((c) => "/" + c.name).join(", ")}`);
    }
    if (sessionRef.current) parts.push(`session: ${sessionRef.current.id}`);
    if (parts.length > 0) {
      setLog((l) => [...l, { kind: "system", text: parts.join("\n") }]);
    }
    // Auto-submit any prompt passed on the CLI.
    if (initialPrompt) {
      queueRef.current.push({ payload: initialPrompt, displayText: initialPrompt });
      setQueuedCount(queueRef.current.length);
      drainQueue();
    }
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStarFrame((f) => f + 1), 180);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setGerund((g) => {
        let next = g;
        while (next === g) {
          next = GERUNDS[Math.floor(Math.random() * GERUNDS.length)]!;
        }
        return next;
      });
    }, 4500);
    return () => clearInterval(t);
  }, [busy]);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
    if (key.escape && abortRef.current) {
      abortRef.current.abort();
      setStatus("aborting...");
    }
    if (key.ctrl && _input === "v") {
      // Ctrl+V: grab an image from the clipboard and attach. Terminals
      // forward Ctrl+V as a raw keystroke (unlike Cmd+V), so we can bind it.
      (async () => {
        setStatus("reading clipboard...");
        const img = await readClipboardImage();
        setStatus("");
        if (!img) {
          setLog((l) => [
            ...l,
            { kind: "system", text: "no image on clipboard" },
          ]);
          return;
        }
        setAttachments((a) => [
          ...a,
          { label: `clipboard-${a.length + 1}.png`, ...img },
        ]);
      })();
    }
  });

  const commitLive = () => {
    const committing = liveRef.current;
    if (committing) {
      setLog((l) => [...l, committing]);
      liveRef.current = null;
      setLiveEntry(null);
    }
  };

  const runOne = async (item: QueueItem) => {
    if (!agentRef.current) return;
    setBusy(true);
    setGerund(GERUNDS[Math.floor(Math.random() * GERUNDS.length)]!);
    const startedAt = Date.now();
    setTurnStart(startedAt);
    turnStartRef.current = startedAt;
    setNow(Date.now());
    thinkingTailRef.current = "";
    setStatus("");
    setLog((l) => [...l, { kind: "user", text: item.displayText }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for await (const ev of agentRef.current.send(item.payload, { signal: controller.signal })) {
        if (ev.type === "text") {
          if (!liveRef.current || liveRef.current.kind !== "assistant") {
            commitLive();
            thinkingTailRef.current = "";
            setStatus("");
            liveRef.current = { kind: "assistant", text: ev.text };
          } else {
            liveRef.current = {
              kind: "assistant",
              text: liveRef.current.text + ev.text,
            };
          }
          setLiveEntry(liveRef.current);
        } else if (ev.type === "thinking") {
          thinkingTailRef.current = (thinkingTailRef.current + ev.text)
            .replace(/\s+/g, " ")
            .slice(-140);
          setStatus(thinkingTailRef.current);
        } else if (ev.type === "tool_start") {
          commitLive();
          thinkingTailRef.current = "";
          liveRef.current = {
            kind: "tool",
            name: ev.name,
            input: JSON.stringify(ev.input).slice(0, 200),
          };
          setLiveEntry(liveRef.current);
          setStatus(`running ${ev.name}...`);
        } else if (ev.type === "tool_end") {
          setStatus("");
          thinkingTailRef.current = "";
          if (liveRef.current?.kind === "tool") {
            liveRef.current = {
              ...liveRef.current,
              output: ev.output.slice(0, 500),
            };
            commitLive();
          }
        } else if (ev.type === "turn_done") {
          if (ev.usage) {
            setUsage(ev.usage);
            const u = ev.usage;
            setCumUsage((c) => ({
              input: c.input + (u.input || 0),
              output: c.output + (u.output || 0),
              cacheRead: c.cacheRead + (u.cacheRead || 0),
              turns: c.turns + 1,
            }));
          }
          if (sessionRef.current && agentRef.current) {
            try {
              flushMessages(sessionRef.current, agentRef.current.state.messages);
            } catch {}
          }
          setStatus("");
          commitLive();
          const elapsed = turnStartRef.current
            ? Math.max(0, Math.floor((Date.now() - turnStartRef.current) / 1000))
            : 0;
          setLog((l) => [
            ...l,
            { kind: "meta", text: `Rawdogged for ${elapsed}s` },
          ]);
        } else if (ev.type === "truncated") {
          commitLive();
          setLog((l) => [
            ...l,
            {
              kind: "system",
              text: `context: truncated ${ev.count} old tool result${ev.count === 1 ? "" : "s"}`,
            },
          ]);
        } else if (ev.type === "compacted") {
          // State was rewritten in-place. The pre-compaction messages are
          // already on disk from the turn_done flush; rebase so we don't try
          // to re-read indices past the shortened state.messages.
          if (sessionRef.current && agentRef.current) {
            sessionRef.current.flushed = agentRef.current.state.messages.length;
          }
          const saved = ev.messagesBefore - ev.messagesAfter;
          const tokNote = ev.summaryTokens
            ? ` (~${ev.summaryTokens} tok summary)`
            : "";
          commitLive();
          setLog((l) => [
            ...l,
            {
              kind: "system",
              text: `context: compacted ${ev.messagesBefore} → ${ev.messagesAfter} messages, -${saved}${tokNote}`,
            },
          ]);
        } else if (ev.type === "error") {
          commitLive();
          setLog((l) => [
            ...l,
            { kind: "system", text: `error: ${ev.message}` },
          ]);
        } else if (ev.type === "aborted") {
          commitLive();
          setLog((l) => [
            ...l,
            { kind: "system", text: "aborted by ESC" },
          ]);
        }
      }
    } finally {
      commitLive();
      setBusy(false);
      abortRef.current = null;
    }
  };

  const drainQueue = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        setQueuedCount(queueRef.current.length);
        await runOne(next);
      }
    } finally {
      runningRef.current = false;
    }
  };

  const submit = async (value: string) => {
    let text = value.trim();
    if (!agentRef.current) return;
    if (!text && attachments.length === 0) return;

    // Slash commands run immediately regardless of busy state.
    if (text === "/exit" || text === "/quit") {
      exit();
      return;
    }
    if (text === "/restart") {
      setInput("");
      exit();
      setTimeout(() => {
        try {
          const r = spawnSync(process.execPath, process.argv.slice(1), {
            stdio: "inherit",
          });
          process.exit(r.status ?? 0);
        } catch {
          process.exit(1);
        }
      }, 50);
      return;
    }
    if (text === "/help") {
      setInput("");
      const all = [
        ...BUILTIN_COMMANDS,
        ...customCommands.map((c) => ({ name: "/" + c.name, desc: c.description })),
      ];
      const nameWidth = Math.max(...all.map((c) => c.name.length)) + 2;
      const lines = all.map(
        (c) => c.name + " ".repeat(nameWidth - c.name.length) + c.desc,
      );
      setLog((l) => [
        ...l,
        { kind: "system", text: "commands:\n" + lines.join("\n") },
      ]);
      return;
    }
    if (text === "/context") {
      setInput("");
      const loaded = loadedCtxRef.current;
      const cfgPath = configPath(process.cwd());
      const cfgLine = existsSync(cfgPath) ? `config: ${cfgPath}` : `config: (none at ${cfgPath})`;
      const mcpLine =
        mcp.serverInfo.length === 0
          ? "mcp: (no .rawdog/mcp.json)"
          : "mcp: " +
            mcp.serverInfo
              .map((s) => (s.error ? `${s.name}✗ ${s.error}` : `${s.name}(${s.tools})`))
              .join(", ");
      const cmdLine =
        customCommands.length === 0
          ? "custom commands: (none)"
          : "custom commands: " + customCommands.map((c) => "/" + c.name).join(", ");
      const ctxLine =
        loaded.length === 0
          ? "no project context loaded (drop an AGENTS.md or .rawdog/context.md nearby)"
          : "loaded context:\n" + loaded.map((p) => "  " + p).join("\n");
      setLog((l) => [
        ...l,
        {
          kind: "system",
          text: [ctxLine, cfgLine, mcpLine, cmdLine].join("\n"),
        },
      ]);
      return;
    }
    if (text === "/sessions") {
      setInput("");
      try {
        const { listSessions } = await import("./sessions.ts");
        const rows = listSessions(process.cwd(), 10);
        if (rows.length === 0) {
          setLog((l) => [
            ...l,
            { kind: "system", text: "no sessions yet in .rawdog/sessions/" },
          ]);
          return;
        }
        const current = sessionRef.current?.id;
        const body = rows
          .map((r) => {
            const marker = r.id === current ? " (current)" : "";
            return `  ${r.id}${marker}  ${r.messages} msgs\n    ${r.preview}`;
          })
          .join("\n");
        setLog((l) => [
          ...l,
          {
            kind: "system",
            text: `recent sessions (ask rawdog to run \`sessions read <id>\` to pull one in):\n${body}`,
          },
        ]);
      } catch (e: any) {
        setLog((l) => [
          ...l,
          { kind: "system", text: `sessions error: ${e.message}` },
        ]);
      }
      return;
    }
    if (text === "/cost") {
      setInput("");
      const price = pricePerMTok(provider.name, provider.model);
      const { input: ti, output: to, cacheRead, turns } = cumUsage;
      const lines = [
        `turns: ${turns}`,
        `input tokens:  ${ti.toLocaleString()}${cacheRead ? ` (${cacheRead.toLocaleString()} cached)` : ""}`,
        `output tokens: ${to.toLocaleString()}`,
      ];
      if (price) {
        const cost = (ti * price.input + to * price.output) / 1_000_000;
        lines.push(
          `est. cost: $${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(4)} (at ${provider.model} rates)`,
        );
      } else {
        lines.push(`est. cost: unknown (no price entry for ${provider.model})`);
      }
      setLog((l) => [...l, { kind: "system", text: lines.join("\n") }]);
      return;
    }
    if (text === "/compact") {
      setInput("");
      if (!agentRef.current) return;
      // Trigger a synthetic compaction by enqueuing a no-op turn that forces
      // the agent's 75% threshold check; simpler: directly summarize via the
      // agent's own state. For now, just ask the model to summarize and rely
      // on the existing auto-compact on the next turn if threshold hits.
      setLog((l) => [
        ...l,
        {
          kind: "system",
          text: "compact requested — next turn will summarize if history is long",
        },
      ]);
      return;
    }
    if (text === "/init") {
      setInput("");
      const dir = join(process.cwd(), ".rawdog");
      const target = join(dir, "AGENTS.md");
      try {
        if (existsSync(target)) {
          setLog((l) => [
            ...l,
            { kind: "system", text: `${target} already exists — leaving it alone` },
          ]);
          return;
        }
        const { mkdirSync, writeFileSync } = require("node:fs");
        mkdirSync(dir, { recursive: true });
        const cwdName = basename(process.cwd());
        const template = `# ${cwdName}

<!-- rawdog auto-loads this file into every turn's system prompt. Keep it short. -->

## What this project is

(one sentence)

## Conventions worth knowing

-

## Commands

- build:
- test:
- run:
`;
        writeFileSync(target, template, "utf8");
        setLog((l) => [
          ...l,
          { kind: "system", text: `created ${target} — edit it, then /restart to load` },
        ]);
      } catch (e: any) {
        setLog((l) => [
          ...l,
          { kind: "system", text: `init failed: ${e.message}` },
        ]);
      }
      return;
    }
    if (text === "/clear" || text === "/new") {
      setLog([]);
      setAttachments([]);
      setInput("");
      setWelcome(pickWelcome());
      setClearEpoch((e) => e + 1);
      setUsage(null);
      setCumUsage({ input: 0, output: 0, cacheRead: 0, turns: 0 });
      const extraTools = mcp.tools.map((t) => ({ def: t.def, run: t.run }));
      agentRef.current = createAgent(provider, systemRef.current, {
        cwd: process.cwd(),
        extraTools,
        disabledTools: rawdogConfig.tools?.disabled,
      });
      try {
        sessionRef.current = startSession(process.cwd(), {
          provider: provider.name,
          model: provider.model,
        });
      } catch (e: any) {
        setLog((l) => [...l, { kind: "system", text: `session log disabled: ${e.message}` }]);
      }
      const home = homedir();
      const prettify = (p: string) =>
        p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
      const parts: string[] = [];
      if (loadedCtxRef.current.length > 0)
        parts.push(`context: ${loadedCtxRef.current.map(prettify).join(", ")}`);
      if (sessionRef.current) parts.push(`session: ${sessionRef.current.id}`);
      if (parts.length > 0) {
        setLog((l) => [...l, { kind: "system", text: parts.join("\n") }]);
      }
      return;
    }
    if (text === "/paste") {
      setInput("");
      setStatus("reading clipboard...");
      const img = await readClipboardImage();
      setStatus("");
      if (!img) {
        setLog((l) => [
          ...l,
          { kind: "system", text: "no image on clipboard" },
        ]);
        return;
      }
      setAttachments((a) => [...a, { label: "clipboard.png", ...img }]);
      return;
    }
    if (text === "/drop") {
      setAttachments([]);
      setInput("");
      return;
    }
    if (text.startsWith("/attach ")) {
      const path = text.slice("/attach ".length).trim();
      setInput("");
      try {
        const img = await readImageFile(path);
        if (!img) {
          setLog((l) => [
            ...l,
            { kind: "system", text: `not an image: ${path}` },
          ]);
          return;
        }
        setAttachments((a) => [...a, { label: basename(path), ...img }]);
      } catch (e: any) {
        setLog((l) => [
          ...l,
          { kind: "system", text: `attach failed: ${e.message}` },
        ]);
      }
      return;
    }
    if (text === "/model" || text.startsWith("/model ")) {
      setInput("");
      const spec = text === "/model" ? "" : text.slice("/model ".length).trim();
      if (!spec) {
        setLog((l) => [
          ...l,
          {
            kind: "system",
            text:
              `current: ${provider.name}:${provider.model}\n` +
              `usage: /model <spec>   e.g. /model gpt-5-mini, /model anthropic:claude-opus-4-7`,
          },
        ]);
        return;
      }
      try {
        const newProv = pickProvider(parseProviderSpec(spec));
        const oldMsgs = agentRef.current?.state.messages ?? [];
        const extraTools = mcp.tools.map((t) => ({ def: t.def, run: t.run }));
        const newAgent = createAgent(newProv, systemRef.current, {
          cwd: process.cwd(),
          extraTools,
          disabledTools: rawdogConfig.tools?.disabled,
        });
        newAgent.state.messages = oldMsgs;
        agentRef.current = newAgent;
        setProvider(newProv);
        setLog((l) => [
          ...l,
          { kind: "system", text: `switched to ${newProv.name}:${newProv.model}` },
        ]);
      } catch (e: any) {
        setLog((l) => [...l, { kind: "system", text: `model switch failed: ${e.message}` }]);
      }
      return;
    }
    if (text === "/resume" || text.startsWith("/resume ")) {
      setInput("");
      const arg = text === "/resume" ? "" : text.slice("/resume ".length).trim();
      if (!arg) {
        const rows = listSessions(process.cwd(), 10);
        if (rows.length === 0) {
          setLog((l) => [...l, { kind: "system", text: "no sessions to resume" }]);
          return;
        }
        const body = rows
          .map((r) => `  ${r.id}  ${r.messages} msgs\n    ${r.preview}`)
          .join("\n");
        setLog((l) => [
          ...l,
          {
            kind: "system",
            text:
              `recent sessions — use /resume <id> to hydrate messages into this session:\n${body}`,
          },
        ]);
        return;
      }
      const msgs = loadSessionMessages(process.cwd(), arg);
      if (!msgs) {
        setLog((l) => [...l, { kind: "system", text: `no session ${arg}` }]);
        return;
      }
      if (agentRef.current) {
        agentRef.current.state.messages = msgs;
        setLog((l) => [
          ...l,
          { kind: "system", text: `resumed ${arg} (${msgs.length} messages)` },
        ]);
      }
      return;
    }
    if (text === "/todo") {
      setInput("");
      try {
        const { toolMap } = await import("./tools.ts");
        const handler = toolMap["todo"];
        if (!handler) {
          setLog((l) => [...l, { kind: "system", text: "todo tool not available" }]);
          return;
        }
        const out = await handler({ action: "list" });
        setLog((l) => [...l, { kind: "system", text: out }]);
      } catch (e: any) {
        setLog((l) => [...l, { kind: "system", text: `todo error: ${e.message}` }]);
      }
      return;
    }

    // Custom slash commands from .rawdog/commands/*.md
    if (text.startsWith("/") && !text.includes(" ")) {
      const name = text.slice(1).toLowerCase();
      const cmd = customCommands.find((c) => c.name === name);
      if (cmd) {
        text = expandCommand(cmd, "").trim();
        setInput("");
        // fall through to normal submission with the expanded body
      }
    } else if (text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      const name = text.slice(1, spaceIdx).toLowerCase();
      const args = text.slice(spaceIdx + 1);
      const cmd = customCommands.find((c) => c.name === name);
      if (cmd) {
        text = expandCommand(cmd, args).trim();
        setInput("");
      }
    }

    // @path mentions — expand into inline <file> blocks prepended to the prompt.
    const mentionRe = /(^|\s)@([^\s@]+)/g;
    const mentioned: { path: string; body: string }[] = [];
    const seenMentions = new Set<string>();
    let mentionMatch: RegExpExecArray | null;
    while ((mentionMatch = mentionRe.exec(text)) !== null) {
      const raw = mentionMatch[2]!;
      const abs = raw.startsWith("/") ? raw : resolve(process.cwd(), raw);
      if (seenMentions.has(abs)) continue;
      seenMentions.add(abs);
      try {
        if (!existsSync(abs)) continue;
        const body = readFileSync(abs, "utf8");
        mentioned.push({ path: raw, body: body.slice(0, 40_000) });
      } catch {}
    }
    if (mentioned.length > 0) {
      const block = mentioned
        .map((m) => `<file src="${m.path}">\n${m.body}\n</file>`)
        .join("\n\n");
      text = `${block}\n\n${text}`;
    }

    // Drag-dropped image paths inline in the message → pull them into attachments.
    const extracted = extractImagePaths(text);
    const dropped: Attachment[] = [];
    for (const p of extracted.paths) {
      try {
        const img = await readImageFile(p);
        if (img) dropped.push({ label: basename(p), ...img });
      } catch {}
    }
    if (dropped.length) text = extracted.text;

    const pending = [...attachments, ...dropped];

    setInput("");
    setAttachments([]);
    const displayText = pending.length
      ? `${text}${text ? "  " : ""}[${pending.map((a) => a.label).join(", ")}]`
      : text;
    const payload: string | ContentBlock[] = pending.length
      ? [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...pending.map((a) => ({
            type: "image" as const,
            mediaType: a.mediaType,
            data: a.data,
          })),
        ]
      : text;

    queueRef.current.push({ payload, displayText });
    setQueuedCount(queueRef.current.length);
    drainQueue();
  };

  const columns = Math.max(40, process.stdout.columns ?? 80);
  const divider = "─".repeat(Math.max(12, columns - 2));
  const headerBorderColor = HEADER_BORDER_COLOR;

  const title = "*rawdog*";
  const topDashes = Math.max(3, columns - 5 - title.length);
  const bottomLine = "╰" + "─".repeat(columns - 2) + "╯";
  const modelText = `${provider.name}:${provider.model}`;
  const home = homedir();
  const rawCwd = process.cwd();
  const cwdText = (rawCwd === home
    ? "~"
    : rawCwd.startsWith(home + "/")
      ? "~" + rawCwd.slice(home.length)
      : rawCwd
  ).toLowerCase();

  const BorderRow = ({ children }: { children: React.ReactNode }) => (
    <Box>
      <Text color={headerBorderColor}>│ </Text>
      <Box flexGrow={1} justifyContent="center">
        {children}
      </Box>
      <Text color={headerBorderColor}> │</Text>
    </Box>
  );

  const renderHeader = () => (
    <Box key="header" flexDirection="column" width={columns}>
      <Box>
        <Text color={headerBorderColor}>╭─ </Text>
        <GradientText text={title} />
        <Text color={headerBorderColor}>
          {" " + "─".repeat(topDashes) + "╮"}
        </Text>
      </Box>
      <BorderRow><Text> </Text></BorderRow>
      {wrapText(welcome, Math.max(10, columns - 8)).map((line, i) => (
        <BorderRow key={`welcome-${i}`}>
          <Text bold color="white">{line}</Text>
        </BorderRow>
      ))}
      <BorderRow><Text> </Text></BorderRow>
      <BorderRow><Text color="gray">{modelText}</Text></BorderRow>
      <BorderRow><Text color="gray">{cwdText}</Text></BorderRow>
      <BorderRow><Text> </Text></BorderRow>
      <Text color={headerBorderColor}>{bottomLine}</Text>
      <Text> </Text>
    </Box>
  );

  // Header + committed log entries go through <Static> so ink writes each
  // line to stdout once and the terminal keeps it in scrollback. Dynamic
  // state (live streaming, busy indicator, input) renders in the live region
  // below. Bumping clearEpoch remounts Static so /clear re-prints a fresh
  // header with a new randomized welcome.
  type StaticItem =
    | { kind: "header" }
    | { kind: "entry"; entry: LogEntry; idx: number };
  const staticItems: StaticItem[] = [
    { kind: "header" },
    ...log.map((entry, idx) => ({ kind: "entry" as const, entry, idx })),
  ];

  const slashMatches = input.startsWith("/")
    ? (() => {
        const q = input.slice(1).toLowerCase();
        const all = [
          ...BUILTIN_COMMANDS,
          ...customCommands.map((c) => ({ name: "/" + c.name, desc: c.description })),
        ];
        const matches = all
          .filter((c) => c.name.slice(1).toLowerCase().startsWith(q))
          .slice(0, 5);
        return matches.length > 0 ? matches : null;
      })()
    : null;

  return (
    <>
      <Static key={`static-${clearEpoch}`} items={staticItems}>
        {(item) =>
          item.kind === "header" ? (
            <Box key="header">{renderHeader()}</Box>
          ) : (
            <Box key={`entry-${item.idx}`}>
              {renderEntry(item.entry, item.idx, columns)}
            </Box>
          )
        }
      </Static>
      <Box flexDirection="column">
        {liveEntry && renderEntry(liveEntry, -1, columns)}

        {attachments.length > 0 && (
          <Box paddingX={1}>
            <Text color="magenta">
              attached: {attachments.map((a) => a.label).join(", ")} (/drop to
              clear)
            </Text>
          </Box>
        )}
        {busy && (
          <>
            <Text> </Text>
            <Box>
              <Box width={2}>
                <Text color={PINK}>{STAR_FRAMES[starFrame % STAR_FRAMES.length]}</Text>
              </Box>
              <GradientText text={`${gerund}...`} />
              <Text color="gray">
                {" "}
                ({Math.max(0, Math.floor(((turnStart ? now - turnStart : 0)) / 1000))}s
                {status ? ` · ${status}` : ""}
                {queuedCount > 0 ? ` · queued ${queuedCount}` : ""})
              </Text>
            </Box>
          </>
        )}
        <Text> </Text>
        <Text color="gray">{divider}</Text>
        <Box>
          <Box width={2}>
            <Text bold color="gray">
              {"›"}
            </Text>
          </Box>
          <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
        <Text color="gray">{divider}</Text>
        {slashMatches ? (() => {
          const nameWidth = Math.max(...slashMatches.map((m) => m.name.length)) + 2;
          return (
            <Box flexDirection="column" paddingLeft={2}>
              {slashMatches.map((c) => (
                <Box key={c.name}>
                  <Box width={nameWidth}>
                    <Text color={PINK}>{c.name}</Text>
                  </Box>
                  <Text color="gray">{c.desc}</Text>
                </Box>
              ))}
            </Box>
          );
        })() : (
          <Box flexDirection="column" paddingX={1}>
            <Text color="gray">{formatComposerMeta(provider, usage)}</Text>
          </Box>
        )}
        <Text> </Text>
      </Box>
    </>
  );
}

(async () => {
  if (forceHeadless) {
    await runHeadless(initialProvider, cliArgs);
    return;
  }
  const customCommands = loadCommands(process.cwd());
  const mcp = await startMcp(process.cwd());
  for (const info of mcp.serverInfo) {
    if (info.error) {
      process.stderr.write(`rawdog mcp ${info.name}: ${info.error}\n`);
    }
  }
  render(
    <App
      initialProvider={initialProvider}
      initialPrompt={cliArgs.prompt || undefined}
      resumeId={cliArgs.resumeId}
      customCommands={customCommands}
      mcp={mcp}
    />,
  );
  const shutdown = () => { try { mcp.shutdown(); } catch {} };
  process.on("exit", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
