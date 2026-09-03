import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PIPELINE, STEP_BY_KEY, type JobContext } from "./types";

function truncate(s: string, max = 6000): string {
  return s.length > max ? `${s.slice(0, max)}\n… [gekürzt, ${s.length} Zeichen gesamt]` : s;
}

function json(value: unknown, max = 6000): string {
  if (value === null || value === undefined) return "_keine Daten_";
  try {
    return "```json\n" + truncate(JSON.stringify(value, null, 2), max) + "\n```";
  } catch {
    return "```\n" + truncate(String(value), max) + "\n```";
  }
}

function ms(v: number | null | undefined): string {
  if (!v && v !== 0) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`;
}

/** Baut den vollständigen Prozess-Report eines Jobs als Markdown. */
export async function buildJobReport(jobId: string): Promise<{ filename: string; markdown: string }> {
  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(country,language,locale,domain,brand)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");

  const { data: steps } = await supabaseAdmin
    .from("job_steps")
    .select("*")
    .eq("job_id", jobId)
    .order("step_order");

  const { data: links } = await supabaseAdmin
    .from("verified_links")
    .select("anchor,target_url,http_status,canonical_ok,confidence")
    .eq("job_id", jobId);

  const market = (job as unknown as {
    markets: { country?: string; language?: string; locale?: string; domain?: string; brand?: string } | null;
  }).markets;
  const ctx = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  const rows = steps ?? [];
  const byKey = new Map(rows.map((s) => [s.step_key, s]));

  const out: string[] = [];
  out.push(`# Prozess-Report · ${job.source_url}`);
  out.push("");
  out.push(`- **Job-ID:** \`${job.id}\``);
  out.push(`- **Zielmarkt:** ${market?.country ?? "—"} · ${market?.language ?? "—"} · ${market?.domain ?? "—"}`);
  out.push(`- **Job-Status:** ${job.status}${job.current_step ? ` (aktueller Schritt: ${job.current_step})` : ""}`);
  out.push(`- **Zielstatus:** ${ctx.target?.status ?? "—"}${ctx.target?.url ? ` (${ctx.target.url})` : ""}`);
  out.push(`- **Erstellt:** ${job.created_at} · **Aktualisiert:** ${job.updated_at ?? "—"}`);
  out.push(`- **Report erzeugt:** ${new Date().toISOString()}`);
  out.push("");

  out.push("## Zusammenfassung");
  out.push("");
  out.push("| # | Schritt | Status | Läufe | Dauer | Modell |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const def of PIPELINE) {
    const s = byKey.get(def.key);
    out.push(
      `| ${def.order} | ${def.label} | ${s?.status ?? "nicht ausgeführt"} | ${s?.run_count ?? 0} | ${ms(s?.duration_ms)} | ${s?.model ?? "—"} |`,
    );
  }
  out.push("");

  out.push("## Schrittdetails");
  out.push("");
  for (const def of PIPELINE) {
    const s = byKey.get(def.key);
    out.push(`### ${def.label}`);
    out.push("");
    out.push(`_${def.description}_`);
    out.push("");
    if (!s) {
      out.push("**Status:** nicht ausgeführt");
      out.push("");
      continue;
    }
    out.push(
      `**Status:** ${s.status} · **Läufe:** ${s.run_count} · **Dauer:** ${ms(s.duration_ms)}${s.model ? ` · **Modell:** ${s.model}` : ""}`,
    );
    out.push("");
    out.push("#### Eingabe");
    out.push(json(s.input));
    out.push("");
    if (s.prompt_snapshot) {
      out.push("#### Prompt-Snapshot");
      out.push("```text\n" + truncate(s.prompt_snapshot, 8000) + "\n```");
      out.push("");
    }
    out.push("#### Ausgabe");
    out.push(json(s.output, 12000));
    out.push("");
    if (s.error) {
      out.push("#### Fehler");
      out.push("```text\n" + s.error + "\n```");
      out.push("");
    }
  }

  out.push("## Verifizierte Links");
  out.push("");
  if (!links?.length) {
    out.push("_Keine verifizierten Links._");
  } else {
    out.push("| Anker | Ziel-URL | HTTP | Canonical OK | Konfidenz |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const l of links) {
      out.push(
        `| ${l.anchor} | ${l.target_url} | ${l.http_status} | ${l.canonical_ok ? "ja" : "nein"} | ${l.confidence ?? "—"} |`,
      );
    }
  }
  out.push("");

  out.push("## Job-Kontext (Endstand)");
  out.push(json(ctx, 20000));
  out.push("");

  out.push("## Export-Markdown (S13)");
  out.push("");
  out.push(ctx.exportMarkdown ? "```markdown\n" + ctx.exportMarkdown + "\n```" : "_Noch kein Export vorhanden._");
  out.push("");

  const unknownSteps = rows.filter((s) => !STEP_BY_KEY[s.step_key]);
  if (unknownSteps.length) {
    out.push("## Unbekannte Schritte (aus früheren Versionen)");
    out.push(json(unknownSteps.map((s) => ({ step_key: s.step_key, status: s.status }))));
  }

  return { filename: `job-${job.id}-report.md`, markdown: out.join("\n") };
}
