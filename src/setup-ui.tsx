import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { GradientText } from "@aflekkas/vibecli/ui";
import { writeUserEnv, userEnvPath } from "./setup.ts";

type Provider = "openai" | "anthropic";

type Props = {
  initialProvider?: Provider;
  onDone: (picked: Provider) => void;
  onAbort?: () => void;
};

const PROVIDERS: { id: Provider; label: string; keyEnv: string; hint: string }[] = [
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", hint: "sk-..." },
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", hint: "sk-ant-..." },
];

export function SetupScreen({ initialProvider, onDone, onAbort }: Props) {
  const [phase, setPhase] = useState<"pick" | "key" | "saved">(
    initialProvider ? "key" : "pick",
  );
  const [idx, setIdx] = useState(
    initialProvider ? Math.max(0, PROVIDERS.findIndex((p) => p.id === initialProvider)) : 0,
  );
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const chosen = PROVIDERS[idx]!;

  useInput((input, k) => {
    if (phase === "saved") return;
    if (k.escape) { onAbort?.(); return; }

    if (phase === "pick") {
      if (k.upArrow) { setIdx((i) => (i - 1 + PROVIDERS.length) % PROVIDERS.length); return; }
      if (k.downArrow) { setIdx((i) => (i + 1) % PROVIDERS.length); return; }
      if (input === "1") { setIdx(0); return; }
      if (input === "2") { setIdx(1); return; }
      if (k.return) { setPhase("key"); setErr(null); return; }
      return;
    }

    // phase === "key"
    if (k.return) {
      const trimmed = key.trim();
      if (!trimmed) { setErr("key is empty"); return; }
      try {
        writeUserEnv({ [chosen.keyEnv]: trimmed });
        setPhase("saved");
        setTimeout(() => onDone(chosen.id), 250);
      } catch (e: any) {
        setErr(`write failed: ${e?.message ?? e}`);
      }
      return;
    }
    if (k.backspace || k.delete) { setKey((v) => v.slice(0, -1)); return; }
    if (k.ctrl && input === "u") { setKey(""); return; }
    if (k.ctrl || k.meta) return;
    if (k.tab) return;
    if (input && input.length > 0) setKey((v) => v + input);
  });

  if (phase === "saved") {
    return (
      <Box flexDirection="column" padding={1}>
        <GradientText text="saved. launching rawdog..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <GradientText text="welcome to rawdog" />
      </Box>

      {phase === "pick" ? (
        <>
          <Text>pick a provider (↑/↓, 1–2, enter to confirm, esc to quit):</Text>
          <Box marginTop={1} flexDirection="column">
            {PROVIDERS.map((p, i) => (
              <Text key={p.id} color={i === idx ? "magentaBright" : undefined}>
                {i === idx ? "› " : "  "}
                {i + 1}. {p.label}
              </Text>
            ))}
          </Box>
        </>
      ) : (
        <>
          <Text>
            paste your <Text color="magentaBright">{chosen.label}</Text> API key ({chosen.hint}):
          </Text>
          <Box marginTop={1}>
            <Text color="gray">› </Text>
            {key.length === 0 ? (
              <Text color="gray">(paste, enter to save, esc to quit)</Text>
            ) : (
              <Text>
                {"•".repeat(Math.min(key.length, 40))}
                {key.length > 40 ? (
                  <Text color="gray"> …({key.length})</Text>
                ) : null}
              </Text>
            )}
          </Box>
          {err ? (
            <Box marginTop={1}><Text color="red">{err}</Text></Box>
          ) : (
            <Box marginTop={1}>
              <Text color="gray">
                stored at {userEnvPath()} (chmod 600). overwritten on re-login.
              </Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
