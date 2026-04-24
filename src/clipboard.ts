import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function mediaTypeForPath(path: string): string | null {
  const lower = path.toLowerCase();
  for (const [ext, mt] of Object.entries(IMAGE_EXTS)) {
    if (lower.endsWith(ext)) return mt;
  }
  return null;
}

export async function readImageFile(path: string): Promise<{ mediaType: string; data: string } | null> {
  const mt = mediaTypeForPath(path);
  if (!mt) return null;
  const buf = await readFile(path);
  return { mediaType: mt, data: buf.toString("base64") };
}

// Grab a PNG from the macOS clipboard via osascript. Returns null if there's
// no image on the clipboard (or the platform isn't macOS).
export async function readClipboardImage(): Promise<{ mediaType: string; data: string } | null> {
  if (process.platform !== "darwin") return null;
  const tmp = join(tmpdir(), `rawdog-paste-${randomBytes(6).toString("hex")}.png`);
  const script = `
    try
      set imgData to the clipboard as «class PNGf»
      set f to open for access POSIX file "${tmp}" with write permission
      set eof of f to 0
      write imgData to f
      close access f
      return "OK"
    on error errMsg
      return "ERR:" & errMsg
    end try
  `;
  const result = await runOsascript(script);
  if (!result.startsWith("OK")) return null;
  try {
    const buf = await readFile(tmp);
    return { mediaType: "image/png", data: buf.toString("base64") };
  } finally {
    unlink(tmp).catch(() => {});
  }
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("osascript", ["-e", script]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", () => {});
    p.on("close", () => resolve(out.trim()));
    p.on("error", () => resolve(""));
  });
}

// Parse dragged file paths out of free-form text. macOS Terminal/iTerm2 insert
// paths with backslash-escaped spaces when you drag a file in. Split the text
// into whitespace-separated tokens (respecting backslash escapes) and pull out
// anything that looks like an existing image file. Returns the remaining text
// plus the extracted paths.
export function extractImagePaths(text: string): { text: string; paths: string[] } {
  const tokens: { raw: string; unescaped: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) break;
    const start = i;
    let unescaped = "";
    while (i < text.length && !/\s/.test(text[i]!)) {
      if (text[i] === "\\" && i + 1 < text.length) {
        unescaped += text[i + 1];
        i += 2;
      } else {
        unescaped += text[i];
        i++;
      }
    }
    tokens.push({ raw: text.slice(start, i), unescaped, start, end: i });
  }

  const paths: string[] = [];
  const keptRanges: [number, number][] = [];
  let cursor = 0;
  for (const t of tokens) {
    const isImg = mediaTypeForPath(t.unescaped) !== null;
    if (isImg && existsSync(t.unescaped)) {
      paths.push(t.unescaped);
      if (cursor < t.start) keptRanges.push([cursor, t.start]);
      cursor = t.end;
    }
  }
  if (cursor < text.length) keptRanges.push([cursor, text.length]);
  const remaining = paths.length
    ? keptRanges.map(([a, b]) => text.slice(a, b)).join("").replace(/\s+/g, " ").trim()
    : text;
  return { text: remaining, paths };
}

export async function writeTempImage(data: Buffer, ext: string): Promise<string> {
  const tmp = join(tmpdir(), `rawdog-${randomBytes(6).toString("hex")}${ext}`);
  await writeFile(tmp, data);
  return tmp;
}
