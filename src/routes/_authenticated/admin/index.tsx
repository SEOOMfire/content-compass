import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rebuildIndex } from "@/lib/pipeline.functions";
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

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "URL-Index – Content-Lokalisierung" },
      { name: "description", content: "URL-Index je Zielmarkt aufbauen und prüfen." },
      { property: "og:title", content: "URL-Index" },
      { property: "og:description", content: "URL-Index je Zielmarkt aufbauen und prüfen." },
    ],
  }),
  component: IndexAdmin,
});

function IndexAdmin() {
  const qc = useQueryClient();
  const [marketId, setMarketId] = useState("");
  const [limit, setLimit] = useState(80);
  const [running, setRunning] = useState(false);

  const markets = useQuery({
    queryKey: ["markets-index-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("markets")
        .select("id,country,language,domain,active,index_last_run,url_index(count)")
        .order("country");
      if (error) throw error;
      return data as unknown as {
        id: string;
        country: string;
        language: string;
        domain: string;
        index_last_run: string | null;
        url_index: { count: number }[];
      }[];
    },
  });


  const rows = useQuery({
    queryKey: ["url-index", marketId],
    enabled: !!marketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("url_index")
        .select("url,path_type,h1,last_seen")
        .eq("market_id", marketId)
        .order("last_seen", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  async function run() {
    if (!marketId) return;
    setRunning(true);
    try {
      const res = await rebuildIndex({ data: { marketId, limit } });
      toast.success(`${res.indexed} von ${res.discovered} URLs indexiert`);
      await qc.invalidateQueries({ queryKey: ["url-index", marketId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Index-Lauf fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Index-Lauf</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[260px_140px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Markt</Label>
            <Select value={marketId} onValueChange={setMarketId}>
              <SelectTrigger>
                <SelectValue placeholder="Markt wählen" />
              </SelectTrigger>
              <SelectContent>
                {(markets.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.country} · {m.language} ({m.url_index?.[0]?.count ?? 0} URLs)
                  </SelectItem>
                ))}

              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Max. URLs</Label>
            <Input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </div>
          <Button onClick={run} disabled={running || !marketId}>
            {running ? "läuft…" : "Index aufbauen"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Index-Status je Markt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(markets.data ?? []).map((m) => {
            const count = m.url_index?.[0]?.count ?? 0;
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 border-b border-border py-1"
              >
                <span className="truncate">
                  {m.country} · {m.language}{" "}
                  <span className="text-xs text-muted-foreground">{m.domain}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {count === 0 ? (
                    <span className="text-destructive">kein Index</span>
                  ) : (
                    `${count} URLs`
                  )}
                  {" · "}
                  {m.index_last_run
                    ? new Date(m.index_last_run).toLocaleString("de-DE")
                    : "nie gelaufen"}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>


      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Indexierte URLs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(rows.data ?? []).map((r: { url: string; h1: string | null; path_type: string; last_seen: string }) => (
            <div key={r.url} className="flex items-center justify-between gap-3 border-b border-border py-1">
              <span className="truncate">{r.h1 ?? r.url}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{r.path_type}</span>
            </div>
          ))}
          {!rows.data?.length && (
            <p className="text-sm text-muted-foreground">Noch keine Einträge für diesen Markt.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
