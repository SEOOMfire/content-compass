import pipelineDoc from "../../../docs/pipeline/pipeline.md?raw";
import { buildJobReport } from "./report.server";
import { buildPromptVarsReport } from "./prompt-vars.server";
import { buildAllPromptsMarkdown } from "./prompts-export.server";

/**
 * Gesamtdokumentation eines Jobs: Pipeline-Beschreibung, Prozess-Report und
 * Prompt-Platzhalter in einer einzigen, klar gegliederten Markdown-Datei.
 */
export async function buildFullJobDocumentation(
  jobId: string,
): Promise<{ filename: string; markdown: string }> {
  const [report, vars] = await Promise.all([
    buildJobReport(jobId),
    buildPromptVarsReport(jobId),
  ]);

  // Überschriften der Teildokumente eine Ebene tiefer einhängen.
  const demote = (md: string) => md.replace(/^(#{1,5}) /gm, "#$1 ");

  const out: string[] = [];
  out.push(`# Gesamtdokumentation · Job ${jobId}`);
  out.push("");
  out.push(`- **Erzeugt:** ${new Date().toISOString()}`);
  out.push("");
  out.push("Diese Datei fasst drei Dokumente zusammen:");
  out.push("");
  out.push("1. **Teil 1 – Pipeline-Beschreibung:** wie die Pipeline grundsätzlich arbeitet (aus `docs/pipeline/pipeline.md`).");
  out.push("2. **Teil 2 – Prozess-Report:** was in diesem konkreten Job passiert ist.");
  out.push("3. **Teil 3 – Prompt-Platzhalter:** welche Werte in diesem Job an die KI übergeben wurden.");
  out.push("");
  out.push("---");
  out.push("");
  out.push("# Teil 1 · Pipeline-Beschreibung (allgemein)");
  out.push("");
  out.push(demote(pipelineDoc.trim()));
  out.push("");
  out.push("---");
  out.push("");
  out.push("# Teil 2 · Prozess-Report (dieser Job)");
  out.push("");
  out.push(demote(report.markdown.trim()));
  out.push("");
  out.push("---");
  out.push("");
  out.push("# Teil 3 · Prompt-Platzhalter (dieser Job)");
  out.push("");
  out.push(demote(vars.markdown.trim()));
  out.push("");

  return { filename: `job-${jobId}-gesamtdokumentation.md`, markdown: out.join("\n") };
}
