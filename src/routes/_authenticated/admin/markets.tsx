import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";
import { importMarketPaths } from "@/lib/pipeline.functions";

export const Route = createFileRoute("/_authenticated/admin/markets")({
  head: () => ({
    meta: [
      { title: "Märkte verwalten – Content-Lokalisierung" },
      { name: "description", content: "Zielmärkte, Domains und Marktprofile pflegen." },
      { property: "og:title", content: "Märkte verwalten" },
      { property: "og:description", content: "Zielmärkte, Domains und Marktprofile pflegen." },
    ],
  }),
  component: MarketsPage,
});

function MarketsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const markets = useQuery({
    queryKey: ["markets-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("markets").select("*").order("country");
      if (error) throw error;
      return data;
    },
  });

  function edit(m: Record<string, unknown>) {
    setEditing(m["id"] as string);
    setForm({
      domain: String(m["domain"] ?? ""),
      path_prefix: String(m["path_prefix"] ?? "/"),
      magazine_root: String(m["magazine_root"] ?? ""),
      category_root: String(m["category_root"] ?? ""),
      brand: String(m["brand"] ?? ""),
      address_form: String(m["address_form"] ?? ""),
      closing_note: String(m["closing_note"] ?? ""),
      crawl_delay_ms: String(m["crawl_delay_ms"] ?? 400),
      forbidden_claims: JSON.stringify(m["forbidden_claims"] ?? [], null, 2),
      institutions: JSON.stringify(m["institutions"] ?? [], null, 2),
    });
  }

  async function save() {
    if (!editing) return;
    try {
      const { error } = await supabase
        .from("markets")
        .update({
          domain: form["domain"] ?? "",
          path_prefix: form["path_prefix"] || "/",
          magazine_root: form["magazine_root"] ?? "",
          category_root: form["category_root"] ?? "",
          brand: form["brand"] ?? "",

          address_form: form["address_form"] || null,
          closing_note: form["closing_note"] || null,
          crawl_delay_ms: Number(form["crawl_delay_ms"] ?? 400),
          forbidden_claims: JSON.parse(form["forbidden_claims"] || "[]"),
          institutions: JSON.parse(form["institutions"] || "[]"),
        })
        .eq("id", editing);
      if (error) throw error;
      toast.success("Markt gespeichert");
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["markets-admin"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  return (
    <div className="space-y-4">
      {(markets.data ?? []).map((m: Tables<"markets">) => (
        <Card key={m.id} className="border-border bg-surface">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {m.country} · {m.language}{" "}
              <span className="text-xs font-normal text-muted-foreground">{m.domain}</span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => (editing === m.id ? setEditing(null) : edit(m))}>
              {editing === m.id ? "Schließen" : "Bearbeiten"}
            </Button>
          </CardHeader>
          {editing === m.id && (
            <CardContent className="grid gap-3 md:grid-cols-2">
              {["domain", "path_prefix", "magazine_root", "category_root", "brand", "address_form", "crawl_delay_ms"].map(
                (k) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{k}</Label>
                    <Input
                      value={form[k] ?? ""}
                      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    />
                  </div>
                ),
              )}
              {["closing_note", "forbidden_claims", "institutions"].map((k: string) => (
                <div key={k} className="space-y-1.5 md:col-span-2">
                  <Label>{k}</Label>
                  <Textarea
                    rows={4}
                    value={form[k] ?? ""}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                </div>
              ))}
              <div className="md:col-span-2">
                <Button onClick={save}>Speichern</Button>
              </div>
              <div className="md:col-span-2">
                <MarketPaths marketId={m.id} />
              </div>
            </CardContent>
          )}
        </Card>
      ))}
      {(markets.data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">Keine Märkte angelegt.</p>
      )}
    </div>
  );
}

/** Gelerntes Pfadverzeichnis eines Markts: Import, Liste, manuelle Pflege. */
function MarketPaths({ marketId }: { marketId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [de, setDe] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const paths = useQuery({
    queryKey: ["market-paths", marketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("market_paths")
        .select("*")
        .eq("market_id", marketId)
        .order("de_segment");
      if (error) throw error;
      return data as Tables<"market_paths">[];
    },
  });

  async function runImport() {
    setBusy(true);
    try {
      const res = await importMarketPaths({ data: { marketId } });
      toast.success(`${res.saved} Pfadpaare aus ${res.sitemaps} Sitemaps übernommen`);
      await qc.invalidateQueries({ queryKey: ["market-paths", marketId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function addPath() {
    if (!de.trim() || !target.trim()) return;
    const { error } = await supabase.from("market_paths").upsert(
      {
        market_id: marketId,
        de_segment: de.trim().toLowerCase(),
        target_segment: target.trim(),
        origin: "manual",
      },
      { onConflict: "market_id,de_segment" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    setDe("");
    setTarget("");
    await qc.invalidateQueries({ queryKey: ["market-paths", marketId] });
  }

  async function removePath(id: string) {
    const { error } = await supabase.from("market_paths").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["market-paths", marketId] });
  }

  const rows = (paths.data ?? []).filter(
    (r) =>
      !filter.trim() ||
      r.de_segment.includes(filter.toLowerCase()) ||
      r.target_segment.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Pfadverzeichnis ({paths.data?.length ?? 0})</span>
        <Button size="sm" variant="outline" onClick={runImport} disabled={busy}>
          {busy ? "Import läuft…" : "Aus Sitemaps importieren"}
        </Button>
        <Input
          className="h-8 w-40"
          placeholder="Suchen"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-auto text-sm">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-b border-border py-1">
            <span>
              <code>{r.de_segment}</code> → <code>{r.target_segment}</code>{" "}
              <span className="text-xs text-muted-foreground">({r.origin})</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => removePath(r.id)}>
              Entfernen
            </Button>
          </div>
        ))}
        {!rows.length && (
          <p className="py-2 text-xs text-muted-foreground">Noch keine Pfade gelernt.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 w-40"
          placeholder="deutsches Segment"
          value={de}
          onChange={(e) => setDe(e.target.value)}
        />
        <Input
          className="h-8 w-40"
          placeholder="Zielsegment"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <Button size="sm" onClick={addPath}>
          Hinzufügen
        </Button>
      </div>
    </div>
  );
}
