import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "./sessions.ts";
import { userConfigJsonPath } from "./setup.ts";

export type RawdogConfig = {
  defaultProvider?: "openai" | "anthropic";
  defaultModel?: string;
  openaiModel?: string;
  anthropicModel?: string;
  tools?: {
    disabled?: string[];
  };
};

export function configPath(cwd: string): string {
  return join(findProjectRoot(cwd), ".rawdog", "config.json");
}

export function userConfigPath(): string {
  return userConfigJsonPath();
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function parseConfigFile(path: string): RawdogConfig {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    process.stderr.write(`rawdog: failed to parse ${path}: ${e?.message ?? e}\n`);
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: RawdogConfig = {};

  if (r.defaultProvider === "openai" || r.defaultProvider === "anthropic") {
    out.defaultProvider = r.defaultProvider;
  }
  if (isStr(r.defaultModel)) out.defaultModel = r.defaultModel;
  if (isStr(r.openaiModel)) out.openaiModel = r.openaiModel;
  if (isStr(r.anthropicModel)) out.anthropicModel = r.anthropicModel;

  if (r.tools && typeof r.tools === "object" && !Array.isArray(r.tools)) {
    const t = r.tools as Record<string, unknown>;
    const tools: RawdogConfig["tools"] = {};
    if (Array.isArray(t.disabled)) {
      const disabled = t.disabled.filter(isStr);
      if (disabled.length > 0) tools.disabled = disabled;
    }
    if (tools.disabled) out.tools = tools;
  }

  return out;
}

// Merge user-global under project-local. Project values win on conflict.
// `tools.disabled` is unioned so user-level disables cannot be silently
// undone by a project config that omits the field.
function merge(base: RawdogConfig, over: RawdogConfig): RawdogConfig {
  const out: RawdogConfig = { ...base };
  if (over.defaultProvider !== undefined) out.defaultProvider = over.defaultProvider;
  if (over.defaultModel !== undefined) out.defaultModel = over.defaultModel;
  if (over.openaiModel !== undefined) out.openaiModel = over.openaiModel;
  if (over.anthropicModel !== undefined) out.anthropicModel = over.anthropicModel;

  const unionDisabled = Array.from(
    new Set([
      ...(base.tools?.disabled ?? []),
      ...(over.tools?.disabled ?? []),
    ]),
  );
  if (unionDisabled.length) out.tools = { disabled: unionDisabled };

  return out;
}

export function loadConfig(cwd: string): RawdogConfig {
  const user = parseConfigFile(userConfigPath());
  const project = parseConfigFile(configPath(cwd));
  return merge(user, project);
}
