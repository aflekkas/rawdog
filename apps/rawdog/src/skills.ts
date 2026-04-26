import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findProjectRoot } from "./sessions.ts";

export type Skill = {
  name: string;
  description: string;
  body: string;
  invisible: boolean;
  dir: string;
  path: string;
  source: "project" | "user";
};

const RESERVED = new Set([
  "help", "cost", "context", "sessions", "compact", "init", "clear", "new",
  "paste", "attach", "drop", "restart", "exit", "quit", "model", "resume",
  "todo", "docs", "agents", "skills",
]);

export function isValidSkillName(name: string): boolean {
  if (!name) return false;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return false;
  if (RESERVED.has(name)) return false;
  return true;
}

export function skillsDir(cwd: string, scope: "project" | "user" = "project"): string {
  if (scope === "user") return join(homedir(), ".rawdog", "skills");
  return join(findProjectRoot(cwd), ".rawdog", "skills");
}

export function skillPath(cwd: string, name: string, scope: "project" | "user" = "project"): string {
  return join(skillsDir(cwd, scope), name, "SKILL.md");
}

type Frontmatter = { data: Record<string, string>; body: string };

function parseFrontmatter(raw: string): Frontmatter {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const lines = raw.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    data[m[1].toLowerCase()] = val;
  }
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return { data, body };
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const s = v.toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return fallback;
}

function deriveDescription(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.length > 160 ? line.slice(0, 159) + "…" : line;
  }
  return "(skill)";
}

function loadFromDir(root: string, source: "project" | "user"): Skill[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const entry of entries) {
    const dir = join(root, entry);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const path = join(dir, "SKILL.md");
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const nameRaw = (data.name ?? entry).toLowerCase();
    const name = nameRaw.replace(/[^a-z0-9_-]/g, "-");
    if (!name) continue;
    if (RESERVED.has(name)) {
      process.stderr.write(`rawdog: skipping skill '${name}' (reserved builtin name)\n`);
      continue;
    }
    const description = data.description?.trim() || deriveDescription(body);
    const invisible = parseBool(data.invisible, true);
    out.push({ name, description, body: body.trim(), invisible, dir, path, source });
  }
  return out;
}

export function loadSkills(cwd: string): Skill[] {
  const projectRoot = findProjectRoot(cwd);
  const project = loadFromDir(join(projectRoot, ".rawdog", "skills"), "project");
  const user = loadFromDir(join(homedir(), ".rawdog", "skills"), "user");
  const byName = new Map<string, Skill>();
  for (const s of user) byName.set(s.name, s);
  for (const s of project) byName.set(s.name, s); // project wins
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function expandSkill(skill: Skill, args: string): string {
  return skill.body.split("$ARGS").join(args ?? "");
}

export function skillsSystemBlock(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (s) => `- /${s.name} — ${s.description} (SKILL.md: ${s.path})`,
  );
  return [
    "Available skills (invoke via slash command; full instructions live in each SKILL.md):",
    ...lines,
  ].join("\n");
}
