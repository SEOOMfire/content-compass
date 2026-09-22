const BASE_URL = (process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1").replace(/\/+$/, "");

export interface PromptTemplateRow {
  step_key: string;
  system_prompt: string;
  user_prompt: string;
  model: string;
  temperature: number | string | null;
  max_tokens: number | null;
  response_format: string | null;
  version: number;
}

export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

/** Aufzeichnung aller Platzhalterwerte eines Schrittlaufs (für den Platzhalter-Report). */
export interface RecordedPromptVars {
  step_key: string;
  template_version: number;
  model: string;
  vars: Record<string, unknown>;
}

let varRecorder: RecordedPromptVars[] | null = null;

export function startVarRecording(): void {
  varRecorder = [];
}

export function collectRecordedVars(): RecordedPromptVars[] {
  const rec = varRecorder ?? [];
  varRecorder = null;
  return rec;
}

function apiKey(): string {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY fehlt – OpenAI-API nicht konfiguriert.");
  return key;
}

/** Entfernt ein optionales Anbieter-Präfix ("openai/gpt-4o" → "gpt-4o"). */
function modelId(model: string): string {
  return model.replace(/^[a-z0-9_-]+\//i, "");
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

/** Neuere OpenAI-Modelle erwarten `max_completion_tokens` statt `max_tokens`. */
function usesCompletionTokens(model: string): boolean {
  return /^(o[1-9]|gpt-4\.1|gpt-5)/i.test(modelId(model));
}

/**
 * Reasoning-Modelle (o-Serie + GPT-5.x) unterstützen kein `temperature`
 * (bzw. nur den Default 1). Für sie wird der Parameter weggelassen.
 */
function supportsTemperature(model: string): boolean {
  return !/^(o[1-9]|gpt-5)/i.test(modelId(model));
}

async function callChat(
  model: string,
  system: string,
  user: string,
  temperature: number,
  maxTokens: number,
): Promise<{ text: string; usage: Usage }> {
  const id = modelId(model);
  const params: Record<string, unknown> = {
    model: id,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (usesCompletionTokens(id)) {
    params["max_completion_tokens"] = maxTokens;
  } else {
    params["max_tokens"] = maxTokens;
  }
  if (supportsTemperature(id)) {
    params["temperature"] = temperature;
  }
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    usage: {
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    },
  };
}

async function gatewayError(res: Response): Promise<Error> {
  let message = `OpenAI-Fehler ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    message = body.error?.message ?? body.message ?? message;
  } catch {
    /* noop */
  }
  if (res.status === 429) return new Error(`Rate-Limit erreicht. ${message}`);
  if (res.status === 402) return new Error(`OpenAI-Guthaben aufgebraucht. ${message}`);
  return new Error(message);
}

export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Antwort enthielt kein gültiges JSON.");
  }
}

export interface LlmResult<T> {
  data: T;
  raw: string;
  model: string;
  promptSnapshot: string;
  tokensIn: number;
  tokensOut: number;
}

export async function runPrompt<T = unknown>(
  tpl: PromptTemplateRow,
  vars: Record<string, unknown>,
): Promise<LlmResult<T>> {
  const system = renderTemplate(tpl.system_prompt, vars);
  const user = renderTemplate(tpl.user_prompt, vars);
  const model = modelId(tpl.model);
  const temperature = Number(tpl.temperature ?? 0.3);
  const maxTokens = tpl.max_tokens ?? 4000;
  if (varRecorder) {
    varRecorder.push({
      step_key: tpl.step_key,
      template_version: tpl.version,
      model,
      vars,
    });
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { text: raw, usage } = await callChat(model, system, user, temperature, maxTokens);
      const data =
        tpl.response_format === "json" ? (extractJson(raw) as T) : ((raw as unknown) as T);
      return {
        data,
        raw,
        model,
        promptSnapshot: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Guthaben") || msg.includes("403")) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM-Aufruf fehlgeschlagen");
}
