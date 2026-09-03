import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { previewLinkPool } from "@/lib/pipeline.functions";
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
      { title: "Link-Pool – Content-Lokalisierung" },
      {
        name: "description",
        content: "Link-Pool je Zielmarkt per Hub-Harvesting aufbauen und prüfen.",
      },
      { property: "og:title", content: "Link-Pool" },
      {
        property: "og:description",
        content: "Link-Pool je Zielmarkt per Hub-Harvesting aufbauen und prüfen.",
      },
    ],
  }),
  component: LinkPoolAdmin,
});

function LinkPoolAdmin() {
  const qc = useQueryClient();
  const [marketId, setMarketId] = useState("");
  const [sourceUrl, setSourceUrl] = useState(
    "https://www.fressnapf.de/magazin/hund/rassen/barbet/",
  );
  const [running, setRunning] = useState(false);

  type MarketRow = {
    id: string;
    country: string;
    language: string;
    domain: string;
    index_last_run: string | null;
  };

  const markets = useQuery({
    queryKey: ["markets-pool-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("markets")
        .select("id,country,language,domain,active,index_last_run")
        .order("country");
      if (error) throw error;
      return data as unknown as MarketRow[];
    },
  });

  const rows = useQuery({
    queryKey: ["link-pool", marketId],
    enabled: !!marketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("link_pool")
        .select("url,anchor_text,path_type,origin,fetched_at")
        .eq("market_id", marketId)
        .order("fetched_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as {
        url: string;
        anchor_text: string | null;
        path_type: string;
        origin: string;
        fetched_at: string;
      }[];
    },
  });

  async function run() {
    if (!marketId) return;
    setRunning(true);
    try {
      const res = await previewLinkPool({ data: { marketId, sourceUrl } });
      toast.success(
        `${res.entries} Links aus ${res.fetches.length} Abrufen${res.hub_url ? ` · Hub: ${res.hub_url}` : ""}`,
      );
      await qc.invalidateQueries({ queryKey: ["link-pool", marketId] });
      await qc.invalidateQueries({ queryKey: ["markets-pool-stats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Link-Pool-Lauf fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Link-Pool (Hub-Harvesting)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Es wird kein Gesamtindex mehr aufgebaut. Pro Lauf werden maximal acht Seiten des
            Zielmarkts geladen: die zur Quell-URL passende Hub-Seite, die Navigation und bis zu drei
            Geschwisterartikel. Daraus entsteht der Link-Pool für Zielprüfung und Verlinkung.
          </p>
          <div className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label>Markt</Label>
              <Select value={marketId} onValueChange={setMarketId}>
                <SelectTrigger>
                  <SelectValue placeholder="Markt wählen" />
                </SelectTrigger>
                <SelectContent>
                  {(markets.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.country} · {m.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Beispiel-Quell-URL (bestimmt die Hub-Seite)</Label>
              <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
            </div>
            <Button onClick={run} disabled={running || !marketId}>
              {running ? "läuft…" : "Link-Pool aufbauen"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Letzter Lauf je Markt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(markets.data ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 border-b border-border py-1"
            >
              <span className="truncate">
                {m.country} · {m.language}{" "}
                <span className="text-xs text-muted-foreground">{m.domain}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {m.index_last_run
                  ? new Date(m.index_last_run).toLocaleString("de-DE")
                  : "noch kein Pool-Lauf"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Links im Pool</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(rows.data ?? []).map((r) => (
            <div
              key={r.url}
              className="flex items-center justify-between gap-3 border-b border-border py-1"
            >
              <span className="truncate">{r.anchor_text || r.url}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {r.origin} · {r.path_type}
              </span>
            </div>
          ))}
          {!rows.data?.length && (
            <p className="text-sm text-muted-foreground">Noch kein Pool für diesen Markt.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
