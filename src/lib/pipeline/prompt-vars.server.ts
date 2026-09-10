import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PIPELINE } from "./types";

interface RecordedVars {
  step_key: string;
  template_version?: number;
  model?: string;
  vars: Record<string, unknown>;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "_leer_";
  if (typeof value === "string") {
    return "```text\n" + value + "\n```";
  }
  try {
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
  } catch {
    return "```text\n" + String(value) + "\n```";
  }
}

/**
 * Baut eine Markdown-Datei mit allen Platzhaltern ({{...}}), die bei den
 * KI-Schritten eines Jobs tatsächlich an die Prompts übergeben wurden.
 */
export async function buildPromptVarsReport(
  jobId: string,
): Promise<{ filename: string; markdown: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("id,source_url,markets(country,language,domain)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");

  const { data: steps } = await supabaseAdmin
    .from("job_steps")
    .select("step_key,status,prompt_vars")
    .eq("job_id", jobId)
    .order("step_order");

  type StepRow = { step_key: string; status: string; prompt_vars: unknown };
  const rows = (steps ?? []) as unknown as StepRow[];
  const byKey = new Map(rows.map((s) => [s.step_key, s]));
  const jobRow = job as unknown as {
    id: string;
    source_url: string;
    markets: { country?: string; language?: string; domain?: string } | null;
  };

  const out: string[] = [];
  out.push(`# Prompt-Platzhalter · ${jobRow.source_url}`);
  out.push("");
  out.push(`- **Job-ID:** \`${jobRow.id}\``);
  out.push(
    `- **Zielmarkt:** ${jobRow.markets?.country ?? "—"} · ${jobRow.markets?.language ?? "—"} · ${jobRow.markets?.domain ?? "—"}`,
  );
  out.push(`- **Erzeugt:** ${new Date().toISOString()}`);
  out.push("");
  out.push(
    "Diese Datei enthält für jeden KI-Schritt alle Platzhalterwerte, die in die Prompts eingesetzt wurden (z. B. `{{language_variant}}`). Schritte ohne KI-Aufruf erscheinen nicht.",
  );
  out.push("");

  let any = false;
  for (const def of PIPELINE) {
    const step = byKey.get(def.key);
    const recorded = (step?.prompt_vars ?? null) as RecordedVars[] | null;
    if (!recorded || !Array.isArray(recorded) || !recorded.length) continue;
    any = true;
    out.push(`## ${def.label}`);
    out.push("");
    out.push(`_Status: ${step?.status ?? "—"} · KI-Aufrufe: ${recorded.length}_`);
    out.push("");
    recorded.forEach((call, i) => {
      out.push(
        `### Aufruf ${i + 1}${recorded.length > 1 ? ` von ${recorded.length}` : ""} · Template \`${call.step_key}\`${
          call.template_version ? ` (v${call.template_version})` : ""
        }${call.model ? ` · Modell ${call.model}` : ""}`,
      );
      out.push("");
      const vars = call.vars ?? {};
      const keys = Object.keys(vars).sort();
      if (!keys.length) {
        out.push("_Keine Platzhalter übergeben._");
        out.push("");
        return;
      }
      out.push("| Platzhalter | Typ | Länge |");
      out.push("| --- | --- | --- |");
      for (const k of keys) {
        const v = vars[k];
        const type = v === null || v === undefined ? "leer" : Array.isArray(v) ? "Liste" : typeof v;
        const len =
          typeof v === "string"
            ? `${v.length} Zeichen`
            : Array.isArray(v)
              ? `${v.length} Einträge`
              : "—";
        out.push(`| \`{{${k}}}\` | ${type} | ${len} |`);
      }
      out.push("");
      for (const k of keys) {
        out.push(`#### \`{{${k}}}\``);
        out.push(renderValue(vars[k]));
        out.push("");
      }
    });
  }

  if (!any) {
    out.push("## Keine Daten");
    out.push("");
    out.push(
      "Für diesen Job wurden noch keine Platzhalter aufgezeichnet. Die Aufzeichnung startet mit dem nächsten Lauf der KI-Schritte.",
    );
    out.push("");
  }

  return { filename: `job-${jobRow.id}-platzhalter.md`, markdown: out.join("\n") };
}
