const GATEWAY = "https://ai.gateway.lovable.dev/v1";

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

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY fehlt – KI-Gateway nicht konfiguriert.");
  return key;
}

async function callChat(
  model: string,
  system: string,
  user: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw await gatewayError(res);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

async function callResponses(model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": apiKey(),
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: user,
      stream: true,
      reasoning: { effort: "medium", summary: "auto" },
    }),
  });
  if (!res.ok) throw await gatewayError(res);
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as { type?: string; delta?: string };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        }
      } catch {
        /* ignore keepalives */
      }
    }
  }
  return text;
}

async function gatewayError(res: Response): Promise<Error> {
  let message = `KI-Gateway-Fehler ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    message = body.error?.message ?? body.message ?? message;
  } catch {
    /* noop */
  }
  if (res.status === 429) return new Error(`Rate-Limit erreicht. ${message}`);
  if (res.status === 402) return new Error(`KI-Guthaben aufgebraucht. ${message}`);
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
}

export async function runPrompt<T = unknown>(
  tpl: PromptTemplateRow,
  vars: Record<string, unknown>,
): Promise<LlmResult<T>> {
  const system = renderTemplate(tpl.system_prompt, vars);
  const user = renderTemplate(tpl.user_prompt, vars);
  const temperature = Number(tpl.temperature ?? 0.3);
  const maxTokens = tpl.max_tokens ?? 4000;
  const useResponses = tpl.model.startsWith("openai/");

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = useResponses
        ? await callResponses(tpl.model, system, user)
        : await callChat(tpl.model, system, user, temperature, maxTokens);
      const data =
        tpl.response_format === "json" ? (extractJson(raw) as T) : ((raw as unknown) as T);
      return { data, raw, model: tpl.model, promptSnapshot: `SYSTEM:\n${system}\n\nUSER:\n${user}` };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Guthaben") || msg.includes("403")) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM-Aufruf fehlgeschlagen");
}
