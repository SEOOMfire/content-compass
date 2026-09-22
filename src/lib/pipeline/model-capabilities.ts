/**
 * Modell-Fähigkeiten der öffentlichen OpenAI-Schnittstelle (Chat Completions).
 * Geteilt zwischen Backend (ai.server) und Admin-UI (prompts), damit beide
 * dieselben Regeln verwenden. Bewusst frei von Server-/Browser-Abhängigkeiten.
 */

/** Entfernt ein optionales Anbieter-Präfix ("openai/gpt-4o" → "gpt-4o"). */
export function modelId(model: string): string {
  return model.replace(/^[a-z0-9_-]+\//i, "");
}

/** Reasoning-Modelle: o-Serie + GPT-5.x. */
export function isReasoningModel(model: string): boolean {
  return /^(o[1-9]|gpt-5)/i.test(modelId(model));
}

/** Nur Non-Reasoning-Modelle (gpt-4o*, gpt-4.1*) unterstützen `temperature` (0–2). */
export function supportsTemperature(model: string): boolean {
  return !isReasoningModel(model);
}

/** Reasoning-Modelle unterstützen `reasoning_effort`. */
export function supportsReasoningEffort(model: string): boolean {
  return isReasoningModel(model);
}

/** Neuere Modelle erwarten `max_completion_tokens` statt `max_tokens`. */
export function usesCompletionTokens(model: string): boolean {
  return /^(o[1-9]|gpt-4\.1|gpt-5)/i.test(modelId(model));
}

/**
 * Reasoning-Anstrengung. Die o-Serie kennt nur low/medium/high; GPT-5.x zusätzlich
 * minimal (gpt-5.1+ ersetzt minimal durch none). Die Auswahl ist bewusst konservativ.
 */
export const REASONING_EFFORT_OPTIONS = ["minimal", "low", "medium", "high"] as const;

/** Für Reasoning-Modelle ist `temperature` fix auf den zugelassenen Default-Wert. */
export const FIXED_TEMPERATURE = 1;
