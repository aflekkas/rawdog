import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "./sessions.ts";

export type SubAgent = {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  system: string;
  path: string;
};

const NAME_RE = /^[a-z0-9_-]+$/;

export function isValidAgentName(name: string): boolean {
  return NAME_RE.test(name);
}

export function agentsDir(cwd: string): string {
  return join(findProjectRoot(cwd), ".rawdog", "agents");
}

type Frontmatter = { fields: Record<string, string>; body: string };

function parseFrontmatter(src: string): Frontmatter | null {
  const text = src.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const header = text.slice(4, end);
  const after = text.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const fields: Record<string, string> = {};
  for (const raw of header.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i === -1) return null;
    const key = line.slice(0, i).trim().toLowerCase();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) fields[key] = val;
  }
  return { fields, body };
}

function toAgent(fm: Frontmatter, path: string, fallbackName: string): SubAgent | null {
  const name = (fm.fields.name || fallbackName).toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const description = fm.fields.description || "(no description)";
  const toolsRaw = fm.fields.tools;
  const tools = toolsRaw
    ? toolsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const model = fm.fields.model || undefined;
  const system = fm.body.trim() || "You are a focused subagent.";
  return { name, description, tools, model, system, path };
}

export function loadAgents(cwd: string): SubAgent[] {
  const dir = agentsDir(cwd);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SubAgent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const fallback = entry.slice(0, -3).toLowerCase();
    const path = join(dir, entry);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    if (!fm) {
      process.stderr.write(`rawdog: skipping agent '${entry}' (invalid or missing frontmatter)\n`);
      continue;
    }
    const agent = toAgent(fm, path, fallback);
    if (!agent) {
      process.stderr.write(`rawdog: skipping agent '${entry}' (invalid name)\n`);
      continue;
    }
    out.push(agent);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function loadAgent(cwd: string, name: string): SubAgent | null {
  if (!NAME_RE.test(name)) return null;
  const path = join(agentsDir(cwd), `${name}.md`);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(raw);
  if (!fm) return null;
  return toAgent(fm, path, name);
}
