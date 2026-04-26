// ANSI syntax highlighter for markdown fenced code blocks.
// Regex-based, zero deps. Only touches content inside triple-backtick fences.

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const UNDIM = "\x1b[22m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const COMMENT_ON = "\x1b[2;37m";
const COMMENT_OFF = "\x1b[22;39m";

type LangKey =
  | "ts"
  | "js"
  | "json"
  | "py"
  | "go"
  | "rust"
  | "sh"
  | "unknown";

const KEYWORDS: Record<Exclude<LangKey, "unknown">, string[]> = {
  ts: "const let var function return if else for while do break continue switch case default class extends new this super typeof instanceof of in await async yield import export from as try catch finally throw true false null undefined void delete interface type enum implements readonly public private protected static".split(
    " "
  ),
  js: "const let var function return if else for while do break continue switch case default class extends new this super typeof instanceof of in await async yield import export from as try catch finally throw true false null undefined void delete static".split(
    " "
  ),
  py: "def class return if elif else for while import from as try except finally raise with pass break continue lambda yield True False None and or not in is global nonlocal".split(
    " "
  ),
  go: "func var const if else for range return package import type struct interface map chan go defer select switch case default break continue true false nil".split(
    " "
  ),
  rust: "fn let mut const if else match for while loop return struct enum trait impl pub use mod as where ref in move break continue true false self Self crate extern dyn".split(
    " "
  ),
  sh: "if then else elif fi for while do done case esac function return export local readonly source exit trap in select true false".split(
    " "
  ),
  json: "true false null".split(" "),
};

function normalizeLang(tag: string): LangKey {
  const t = tag.trim().toLowerCase();
  if (t === "ts" || t === "tsx") return "ts";
  if (t === "js" || t === "jsx") return "js";
  if (t === "json") return "json";
  if (t === "py" || t === "python") return "py";
  if (t === "go") return "go";
  if (t === "rs" || t === "rust") return "rust";
  if (t === "sh" || t === "bash" || t === "zsh" || t === "shell") return "sh";
  return "unknown";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mask a matched region, remembering original + replacement to substitute back.
interface Mask {
  placeholder: string;
  replacement: string;
}

function makePlaceholder(kind: string, idx: number): string {
  return `\x00${kind}${idx}\x00`;
}

function highlightBlock(code: string, lang: LangKey): string {
  if (lang === "unknown") {
    // Uniform dim — escape any existing ESC sequences are unlikely in source.
    return DIM + code + UNDIM;
  }

  const masks: Mask[] = [];
  let working = code;

  // 1. Mask comments.
  const commentPatterns: RegExp[] = [];
  if (lang === "ts" || lang === "js" || lang === "go" || lang === "rust") {
    commentPatterns.push(/\/\*[\s\S]*?\*\//g);
    commentPatterns.push(/\/\/[^\n]*/g);
  }
  if (lang === "py" || lang === "sh") {
    commentPatterns.push(/#[^\n]*/g);
  }
  for (const re of commentPatterns) {
    working = working.replace(re, (m) => {
      const ph = makePlaceholder("C", masks.length);
      masks.push({
        placeholder: ph,
        replacement: COMMENT_ON + m + COMMENT_OFF,
      });
      return ph;
    });
  }

  // 2. Mask strings.
  const stringPatterns: RegExp[] = [];
  if (lang === "py") {
    // triple-quoted first
    stringPatterns.push(/"""[\s\S]*?"""/g);
    stringPatterns.push(/'''[\s\S]*?'''/g);
    stringPatterns.push(/"(?:\\.|[^"\\\n])*"/g);
    stringPatterns.push(/'(?:\\.|[^'\\\n])*'/g);
  } else if (lang === "ts" || lang === "js") {
    stringPatterns.push(/`(?:\\.|[^`\\])*`/g);
    stringPatterns.push(/"(?:\\.|[^"\\\n])*"/g);
    stringPatterns.push(/'(?:\\.|[^'\\\n])*'/g);
  } else if (lang === "json") {
    stringPatterns.push(/"(?:\\.|[^"\\\n])*"/g);
  } else {
    stringPatterns.push(/"(?:\\.|[^"\\\n])*"/g);
    stringPatterns.push(/'(?:\\.|[^'\\\n])*'/g);
  }
  for (const re of stringPatterns) {
    working = working.replace(re, (m) => {
      const ph = makePlaceholder("S", masks.length);
      masks.push({ placeholder: ph, replacement: GREEN + m + RESET });
      return ph;
    });
  }

  // 3. Keywords.
  const kws = KEYWORDS[lang];
  if (kws && kws.length) {
    const kwRe = new RegExp(
      `\\b(${kws.map(escapeRegex).join("|")})\\b`,
      "g"
    );
    working = working.replace(kwRe, (m) => MAGENTA + m + RESET);
  }

  // 4. Numbers.
  const numRe = /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;
  working = working.replace(numRe, (m) => YELLOW + m + RESET);

  // 5. Unmask.
  for (const m of masks) {
    working = working.replace(m.placeholder, m.replacement);
  }

  return working;
}

export function highlight(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const openMatch = line.match(/^(\s*)```([^\s`]*)\s*$/);
    if (openMatch) {
      // Look ahead for closing fence.
      let closeIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*```\s*$/.test(lines[j]!)) {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx === -1) {
        // Unclosed — leave as-is.
        out.push(line);
        i++;
        continue;
      }
      const lang = normalizeLang(openMatch[2] || "");
      const body = lines.slice(i + 1, closeIdx).join("\n");
      const colored = highlightBlock(body, lang);
      out.push(DIM + line + UNDIM);
      if (body.length > 0 || closeIdx > i + 1) {
        out.push(colored);
      }
      out.push(DIM + lines[closeIdx]! + UNDIM);
      i = closeIdx + 1;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join("\n");
}

if (import.meta.main) {
  const sample = `Here's a quick example of a greeter:

\`\`\`ts
// greet anyone
function greet(name: string): string {
  const n = 42;
  if (name === "world") {
    return \`hello, \${name}! count=\${n}\`;
  }
  return "hi " + name;
}
\`\`\`

And some python:

\`\`\`py
# fib
def fib(n):
    """return nth fib"""
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
\`\`\`

Unknown lang stays dim:

\`\`\`weirdlang
some random text 123
\`\`\`
`;
  process.stdout.write(highlight(sample) + "\n");
}
