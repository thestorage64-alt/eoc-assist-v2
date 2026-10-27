import "server-only";
import dns from "node:dns";

// On this network the provider resolves to IPv6 first and the connect hangs past
// undici's 10s limit, while curl falls back to IPv4 and succeeds within a second.
// That was the cause of the intermittent 502s, not quota or the model.
// Preferring IPv4 for the process makes the AI calls reliable on venue Wi-Fi too.
dns.setDefaultResultOrder("ipv4first");

export class AiNotConfigured extends Error {
  code = "ai_not_configured";
  constructor(message = "AI not configured") {
    super(message);
    this.name = "AiNotConfigured";
  }
}

export class AiTimeout extends Error {
  code = "ai_timeout";
  constructor(message = "AI timeout") {
    super(message);
    this.name = "AiTimeout";
  }
}

export class AiFailed extends Error {
  code = "ai_failed";
  constructor(message = "AI failed") {
    super(message);
    this.name = "AiFailed";
  }
}

export class AiInvalidOutput extends Error {
  code = "ai_invalid_output";
  constructor(message = "AI invalid output") {
    super(message);
    this.name = "AiInvalidOutput";
  }
}

function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").replace(/gsk_[A-Za-z0-9_-]+/g, "gsk_***");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
  const base = (process.env.EOC_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const key = process.env.EOC_LLM_API_KEY || process.env.GROQ_API_KEY || "";
  const model = process.env.EOC_LLM_MODEL || "openai/gpt-oss-120b";
  const timeoutMs = Number(process.env.EOC_LLM_TIMEOUT_MS) || 30000;
  return { base, key, model, timeoutMs };
}

export function isAiConfigured(): boolean {
  const { key } = readConfig();
  return Boolean(key);
}

export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const { base, key, model, timeoutMs } = readConfig();
  if (!key) throw new AiNotConfigured();

  const url = `${base}/chat/completions`;
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    // Minutes are the largest structured output we ask for. 700 was tight once a
    // reasoning model spends part of the budget thinking, and the provider
    // intermittently refused the call.
    max_tokens: 1200,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err: any = new Error(redact(`HTTP ${res.status}: ${text}`));
        err.status = res.status;
        throw err;
      }

      const data = await res.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new AiInvalidOutput("missing content");
      }
      return content;
    } catch (e: any) {
      if (e instanceof AiNotConfigured || e instanceof AiTimeout || e instanceof AiFailed || e instanceof AiInvalidOutput) {
        throw e;
      }
      const isTimeout =
        e?.name === "TimeoutError" ||
        e?.name === "AbortError" ||
        /timeout|aborted/i.test(String(e?.message ?? ""));
      if (isTimeout) throw new AiTimeout(redact(String(e?.message ?? "timeout")));

      const status = e?.status;
      const rateLimited = status === 429;
      const serverError = typeof status === "number" && status >= 500 && status < 600;
      // A fetch-level failure has no status: DNS, reset, proxy hiccup. Those are
      // exactly what a venue network produces, so they are retried too.
      const networkFailure = status === undefined;
      const retryable = rateLimited || serverError || networkFailure;

      if (retryable && attempt < 2) {
        attempt += 1;
        // Two retries with a short backoff and jitter: long enough for a rate
        // limiter to breathe, short enough that a live demo does not stall.
        await sleep((attempt === 1 ? 700 : 1800) + Math.random() * 300);
        continue;
      }
      if (e instanceof AiInvalidOutput) throw e;
      throw new AiFailed(redact(String(e?.message ?? "request failed")));
    }
  }
}

export async function completeJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const content = await callLLM(systemPrompt, userPrompt);
  try {
    return JSON.parse(content);
  } catch {
    throw new AiInvalidOutput("invalid JSON");
  }
}