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

/** Steht die URL als Markdown-Link im Text? */
function linkInText(text: string, url: string): boolean {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\]\\(\\s*${escaped}[^)]*\\)`).test(text);
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
  const jobRow = job as unknown as {
    id: string;
    source_url: string;
    status: string;
    current_step: string | null;
    created_at: string;
    updated_at: string | null;
  };
  const ctx = ((job as { context?: JobContext }).context ?? {}) as JobContext;
  type StepRow = {
    step_key: string;
    status: string;
    run_count: number | null;
    duration_ms: number | null;
    model: string | null;
    input: unknown;
    output: unknown;
    prompt_snapshot: string | null;
    error: string | null;
  };
  type LinkRow = {
    anchor: string;
    target_url: string;
    http_status: number | null;
    canonical_ok: boolean | null;
    confidence: string | null;
  };
  const rows = (steps ?? []) as unknown as StepRow[];
  const linkRows = (links ?? []) as unknown as LinkRow[];
  const byKey = new Map(rows.map((s) => [s.step_key, s]));

  const out: string[] = [];
  out.push(`# Prozess-Report · ${jobRow.source_url}`);
  out.push("");
  out.push(`- **Job-ID:** \`${jobRow.id}\``);
  out.push(`- **Zielmarkt:** ${market?.country ?? "—"} · ${market?.language ?? "—"} · ${market?.domain ?? "—"}`);
  out.push(`- **Job-Status:** ${jobRow.status}${jobRow.current_step ? ` (aktueller Schritt: ${jobRow.current_step})` : ""}`);
  out.push(`- **Zielstatus:** ${ctx.target?.status ?? "—"}${ctx.target?.url ? ` (${ctx.target.url})` : ""}`);
  out.push(`- **Erstellt:** ${jobRow.created_at} · **Aktualisiert:** ${jobRow.updated_at ?? "—"}`);
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
  if (!linkRows.length) {
    out.push("_Keine verifizierten Links._");
  } else {
    out.push("| Anker | Ziel-URL | HTTP | Canonical OK | Konfidenz |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const l of linkRows) {
      out.push(
        `| ${l.anchor} | ${l.target_url} | ${l.http_status} | ${l.canonical_ok ? "ja" : "nein"} | ${l.confidence ?? "—"} |`,
      );
    }
  }
  out.push("");

  out.push("## Link-Trichter");
  out.push("");
  out.push("| Anker | Origin | Abschnitt | Kandidaten | Gewählt | Reason | Verifiziert | Im Text |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  const funnelAnchors: { anchor: string; origin: string; section: string }[] = [];
  for (const s of ctx.plan?.sections ?? []) {
    for (const a of s.anchors ?? []) funnelAnchors.push({
      anchor: a.anchor,
      origin: (a as { origin?: string }).origin ?? "plan",
      section: s.de_heading,
    });
  }
  const bodyMarkdown = (ctx.content ?? []).map((c) => c.markdown).join("\n\n");
  for (const fa of funnelAnchors) {
    const cand = ctx.linkCandidates?.[fa.anchor]?.length ?? 0;
    const sel = ctx.linkSelection?.find((x) => x.anchor === fa.anchor);
    const chosen = sel?.url ?? null;
    const reason = (sel as { reason?: string } | undefined)?.reason ?? "";
    const verified = chosen && ctx.verifiedLinks?.some((v) => v.target_url === chosen) ? "ja" : chosen ? "nein" : "—";
    const inText = chosen && linkInText(bodyMarkdown, chosen) ? "ja" : chosen ? "nein" : "—";
    out.push(
      `| ${fa.anchor} | ${fa.origin} | ${fa.section} | ${cand} | ${chosen ?? "null"} | ${reason} | ${verified} | ${inText} |`,
    );
  }
  if (!funnelAnchors.length) out.push("_Keine Anker vorhanden._");
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

  return { filename: `job-${jobRow.id}-report.md`, markdown: out.join("\n") };
}
