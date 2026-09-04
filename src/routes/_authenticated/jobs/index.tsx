import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createJob } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PIPELINE, STEP_BY_KEY } from "@/lib/pipeline/types";

export const Route = createFileRoute("/_authenticated/jobs/")({
  head: () => ({
    meta: [
      { title: "Lokalisierungs-Jobs – Content-Tool" },
      { name: "description", content: "Übersicht und Start neuer Content-Lokalisierungs-Jobs." },
      { property: "og:title", content: "Lokalisierungs-Jobs – Content-Tool" },
      { property: "og:description", content: "Übersicht und Start neuer Lokalisierungs-Jobs." },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sourceUrl, setSourceUrl] = useState("");
  const [marketId, setMarketId] = useState("");
  const [creating, setCreating] = useState(false);

  const markets = useQuery({
    queryKey: ["markets-with-index"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("markets")
        .select("id,country,language,domain,active,index_last_run")
        .eq("active", true)
        .order("country");
      if (error) throw error;
      return data;
    },
  });

  type MarketOption = {
    id: string;
    country: string;
    language: string;
    index_last_run: string | null;
  };
  const marketList = (markets.data ?? []) as unknown as MarketOption[];

  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,source_url,status,current_step,created_at,markets(country,language)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j: { status: string }) => j.status === "running") ? 3000 : false,
  });

  const runningIds = ((jobs.data ?? []) as { id: string; status: string }[])
    .filter((j) => j.status === "running")
    .map((j) => j.id);

  const runningSteps = useQuery({
    queryKey: ["jobs-progress", runningIds.join(",")],
    enabled: runningIds.length > 0,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_steps")
        .select("job_id,status")
        .in("job_id", runningIds);
      if (error) throw error;
      return data as { job_id: string; status: string }[];
    },
  });

  function progressOf(job: { id: string; status: string; current_step: string | null }) {
    const total = PIPELINE.length;
    if (job.status === "done") return 100;
    const rows = (runningSteps.data ?? []).filter((s) => s.job_id === job.id);
    const done = rows.filter((s) => s.status === "done" || s.status === "done_with_errors").length;
    if (done > 0) return Math.round((done / total) * 100);
    const order = job.current_step ? (STEP_BY_KEY[job.current_step]?.order ?? 0) - 1 : 0;
    return Math.round((Math.max(order, 0) / total) * 100);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!marketId) {
      toast.error("Bitte einen Zielmarkt wählen.");
      return;
    }
    setCreating(true);
    try {
      const res = await createJob({ data: { source_url: sourceUrl, market_id: marketId } });
      await qc.invalidateQueries({ queryKey: ["jobs"] });
      await navigate({ to: "/jobs/$jobId", params: { jobId: res.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Job konnte nicht erstellt werden");
    } finally {
      setCreating(false);
    }
  }


  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Content-Lokalisierung</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deutsche Magazin-URL in einen Zielmarkt lokalisieren – in 14 nachvollziehbaren Schritten.
        </p>
      </div>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Neuer Job</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-4 md:grid-cols-[1fr_240px_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="url">Quell-URL (DE)</Label>
              <Input
                id="url"
                type="url"
                required
                placeholder="https://www.fressnapf.de/magazin/hund/rassen/barbet/"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zielmarkt</Label>
              <Select value={marketId} onValueChange={setMarketId}>
                <SelectTrigger>
                  <SelectValue placeholder="Markt wählen" />
                </SelectTrigger>
                <SelectContent>
                  {marketList.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.country} · {m.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "…" : "Job anlegen"}
            </Button>

          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {(jobs.data ?? []).length === 0 && !jobs.isLoading && (
            <p className="text-sm text-muted-foreground">Noch keine Jobs vorhanden.</p>
          )}
          {(jobs.data ?? []).map((j: { id: string; source_url: string; status: string; current_step: string | null; created_at: string; markets: { country: string; language: string } | null }) => (
            <Link
              key={j.id}
              to="/jobs/$jobId"
              params={{ jobId: j.id }}
              className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 hover:bg-accent"
            >
              <span className="truncate text-sm">{j.source_url}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {(j.markets as { country?: string } | null)?.country ?? "—"}
                </span>
                <Badge variant={j.status === "error" ? "destructive" : "secondary"}>
                  {j.status}
                </Badge>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
