#!/usr/bin/env bun
import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { OpenAIProvider } from "./providers/openai.ts";
import { AnthropicProvider } from "./providers/anthropic.ts";
import { createAgent } from "./agent.ts";
import type { Provider } from "./providers/types.ts";

const SYSTEM = `You are rawdog, a terminal coding agent. You have bash, read, and write tools.
Be concise. Use tools when they help. No preamble, no filler.`;

function pickProvider(): Provider {
  const pick = (process.env.RAWDOG_PROVIDER || "").toLowerCase();
  if (pick === "anthropic") return new AnthropicProvider();
  if (pick === "openai") return new OpenAIProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  throw new Error("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}

// Fail fast BEFORE rendering the TUI — otherwise ink takes over the terminal
// and error messages get swallowed / Enter does nothing.
let initialProvider: Provider;
try {
  initialProvider = pickProvider();
} catch (e: any) {
  process.stderr.write(`\nrawdog: ${e.message}\n`);
  process.stderr.write(`\nSet it in your shell:\n  export OPENAI_API_KEY=sk-...\n`);
  process.stderr.write(`Or create a .env file in this directory (bun auto-loads it).\n\n`);
  process.exit(1);
}

type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: string; output?: string }
  | { kind: "system"; text: string };

function App() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState("");
  const agentRef = useRef<ReturnType<typeof createAgent> | null>(null);
  const providerRef = useRef<Provider | null>(null);

  useEffect(() => {
    providerRef.current = initialProvider;
    agentRef.current = createAgent(initialProvider, SYSTEM);
    setLog([{ kind: "system", text: `rawdog ready · ${initialProvider.name}:${initialProvider.model}` }]);
  }, []);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
  });

  const submit = async (value: string) => {
    const text = value.trim();
    if (!text || busy || !agentRef.current) return;
    if (text === "/exit" || text === "/quit") { exit(); return; }
    if (text === "/clear") {
      setLog([]);
      return;
    }
    setInput("");
    setBusy(true);
    setLog((l) => [...l, { kind: "user", text }]);
    let currentAssistant: LogEntry | null = null;

    try {
      for await (const ev of agentRef.current.send(text)) {
        if (ev.type === "text") {
          if (!currentAssistant || currentAssistant.kind !== "assistant") {
            currentAssistant = { kind: "assistant", text: ev.text };
            setLog((l) => [...l, currentAssistant!]);
          } else {
            currentAssistant.text += ev.text;
            setLog((l) => [...l.slice(0, -1), { ...currentAssistant! }]);
          }
        } else if (ev.type === "tool_start") {
          currentAssistant = null;
          setStatus(`running ${ev.name}...`);
          setLog((l) => [
            ...l,
            { kind: "tool", name: ev.name, input: JSON.stringify(ev.input).slice(0, 200) },
          ]);
        } else if (ev.type === "tool_end") {
          setStatus("");
          setLog((l) => {
            const last = l[l.length - 1];
            if (last?.kind === "tool") {
              return [...l.slice(0, -1), { ...last, output: ev.output.slice(0, 500) }];
            }
            return l;
          });
        } else if (ev.type === "turn_done") {
          if (ev.usage) {
            setStatus(
              `in:${ev.usage.input} out:${ev.usage.output}` +
              (ev.usage.cacheRead ? ` cache:${ev.usage.cacheRead}` : ""),
            );
          }
        } else if (ev.type === "error") {
          setLog((l) => [...l, { kind: "system", text: `error: ${ev.message}` }]);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const visible = log.slice(-30);

  return (
    <Box flexDirection="column">
      {visible.map((entry, i) => (
        <Box key={i} flexDirection="column" marginBottom={0}>
          {entry.kind === "user" && <Text color="cyan">» {entry.text}</Text>}
          {entry.kind === "assistant" && <Text>{entry.text}</Text>}
          {entry.kind === "tool" && (
            <Box flexDirection="column">
              <Text color="yellow">⚙ {entry.name} {entry.input}</Text>
              {entry.output && <Text color="gray">  {entry.output.split("\n").slice(0, 3).join("\n  ")}</Text>}
            </Box>
          )}
          {entry.kind === "system" && <Text color="magenta">{entry.text}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        {busy ? (
          <Text color="green">
            <Spinner type="dots" /> {status || "thinking..."}
          </Text>
        ) : (
          <Box>
            <Text color="cyan">› </Text>
            <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="message (/exit to quit)" />
          </Box>
        )}
      </Box>
      {!busy && status && <Text color="gray">{status}</Text>}
    </Box>
  );
}

render(<App />);
