// Retry wrapper for the INITIAL call that returns a stream; does not resume mid-stream.

export type RetryOpts = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "ECONNREFUSED",
  "EPIPE",
]);

function getHeader(h: unknown, name: string): string | undefined {
  if (!h) return undefined;
  const lower = name.toLowerCase();
  if (typeof (h as any).get === "function") {
    const v = (h as any).get(name) ?? (h as any).get(lower);
    return v == null ? undefined : String(v);
  }
  if (typeof h === "object") {
    for (const k of Object.keys(h as object)) {
      if (k.toLowerCase() === lower) {
        const v = (h as any)[k];
        return v == null ? undefined : String(v);
      }
    }
  }
  return undefined;
}

function parseRetryAfter(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(v);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function isRetryable(err: any): boolean {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err?.response?.status;
  if (typeof status === "number" && RETRYABLE_STATUS.has(status)) return true;
  const code = err.code ?? err.cause?.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
  if (err.name === "APIConnectionError" || err.name === "APIConnectionTimeoutError") return true;
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 8000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const headers = err?.headers ?? err?.response?.headers;
      const ra = parseRetryAfter(getHeader(headers, "retry-after"));
      const cap = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = ra != null ? Math.min(maxMs, ra) : Math.floor(Math.random() * cap);
      opts.onRetry?.(err, attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
