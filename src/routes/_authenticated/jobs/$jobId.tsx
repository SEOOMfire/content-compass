import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, ChevronDown, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runStepFn, runFromStepFn, exportJobReport } from "@/lib/pipeline.functions";
import { PIPELINE } from "@/lib/pipeline/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/jobs/$jobId")({
  head: () => ({
    meta: [
      { title: "Job-Detail – Content-Lokalisierung" },
      { name: "description", content: "Pipeline-Schritte, Ergebnisse und Export eines Jobs." },
      { property: "og:title", content: "Job-Detail – Content-Lokalisierung" },
      { property: "og:description", content: "Pipeline-Schritte, Ergebnisse und Export eines Jobs." },
    ],
  }),
  component: JobDetail,
});

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  done: "default",
  running: "secondary",
  error: "destructive",
};

function JobDetail() {
  const { jobId } = Route.useParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*, markets(country,language,domain)")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });

  const steps = useQuery({
    queryKey: ["job-steps", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_steps")
        .select("*")
        .eq("job_id", jobId)
        .order("step_order");
      if (error) throw error;
      return data;
    },
    refetchInterval: 3000,
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["job", jobId] }),
      qc.invalidateQueries({ queryKey: ["job-steps", jobId] }),
    ]);
  }

  async function runOne(stepKey: string) {
    setBusy(stepKey);
    try {
      const res = await runStepFn({ data: { jobId, stepKey } });
      if (res.ok) toast.success("Schritt abgeschlossen");
      else toast.error(res.error ?? "Schritt fehlgeschlagen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function runAll(fromStep?: string) {
    setBusy("all");
    try {
      const res = await runFromStepFn({
        data: fromStep ? { jobId, fromStep } : { jobId },
      });
      const failed = res.find((r) => !r.ok);
      if (failed) toast.error(`${failed.step}: ${failed.error}`);
      else toast.success("Pipeline abgeschlossen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function downloadReport() {
    setBusy("report");
    try {
      const { filename, markdown } = await exportJobReport({ data: { jobId } });
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Prozess-Report heruntergeladen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Report fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  const ctx = (job.data?.context ?? {}) as Record<string, unknown>;
  const target = ctx["target"] as { status?: string; url?: string | null } | undefined;
  const exportMd = ctx["exportMarkdown"] as string | undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {job.data?.source_url ?? "Job"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zielmarkt:{" "}
            {(job.data?.markets as { country?: string; language?: string } | null)?.country ?? "—"} ·{" "}
            {(job.data?.markets as { language?: string } | null)?.language ?? "—"}
            {target?.status && ` · Zielstatus: ${target.status}`}
            {target?.url && ` (${target.url})`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} size="icon" aria-label="Aktualisieren">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={downloadReport} disabled={busy !== null}>
            <FileDown className="mr-2 h-4 w-4" />
            {busy === "report" ? "Erstelle…" : "Prozess-Report (.md)"}
          </Button>
          <Button onClick={() => runAll()} disabled={busy !== null}>
            <Play className="mr-2 h-4 w-4" /> Komplett ausführen
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {PIPELINE.map((def) => {
          const step = (steps.data ?? []).find((s: Tables<"job_steps">) => s.step_key === def.key);
          const isOpen = open === def.key;
          return (
            <Card key={def.key} className="border-border bg-surface">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-3">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-3 text-left"
                  onClick={() => setOpen(isOpen ? null : def.key)}
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                  <span>
                    <CardTitle className="text-sm">{def.label}</CardTitle>
                    <span className="text-xs text-muted-foreground">{def.description}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {step && (
                    <Badge variant={STATUS_VARIANT[step.status] ?? "outline"}>
                      {step.status}
                      {step.run_count ? ` ·${step.run_count}` : ""}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => runOne(def.key)}
                  >
                    {busy === def.key ? "…" : step?.status === "done" ? "Erneut" : "Ausführen"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => runAll(def.key)}
                  >
                    ab hier
                  </Button>
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="space-y-3 border-t border-border pt-3 text-xs">
                  {step?.error && <p className="text-destructive">{step.error}</p>}
                  {step?.model && <p className="text-muted-foreground">Modell: {step.model}</p>}
                  {step?.prompt_snapshot && (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">
                        Prompt-Snapshot
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
                        {step.prompt_snapshot}
                      </pre>
                    </details>
                  )}
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
                    {step?.output ? JSON.stringify(step.output, null, 2) : "Noch kein Ergebnis."}
                  </pre>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {exportMd && (
        <Card className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Export (Markdown)</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(exportMd);
                toast.success("In die Zwischenablage kopiert");
              }}
            >
              Kopieren
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap text-xs">{exportMd}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
