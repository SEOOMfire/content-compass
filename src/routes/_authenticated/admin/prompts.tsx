import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { savePrompt, testPrompt, exportAllPrompts } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin/prompts")({
  head: () => ({
    meta: [
      { title: "Prompts verwalten – Content-Lokalisierung" },
      { name: "description", content: "Prompt-Vorlagen bearbeiten, versionieren und testen." },
      { property: "og:title", content: "Prompts verwalten" },
      { property: "og:description", content: "Prompt-Vorlagen bearbeiten, versionieren und testen." },
    ],
  }),
  component: PromptsPage,
});

interface Draft {
  system_prompt: string;
  user_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

/** Auswählbare ChatGPT-Modelle (OpenAI-Modell-IDs). Liste bei Bedarf erweitern. */
const CHATGPT_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4.1",
  "o3-mini",
  "o4-mini",
  "gpt-5-mini",
  "gpt-5",
];

function PromptsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prompts = useQuery({
    queryKey: ["prompt-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_templates")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const current = (prompts.data ?? []).find((p: Tables<"prompt_templates">) => p.id === active);

  // Stellt sicher, dass ein bereits gespeichertes, aber nicht gelistetes Modell
  // trotzdem im Dropdown angezeigt wird.
  const modelOptions = draft && !CHATGPT_MODELS.includes(draft.model)
    ? [...CHATGPT_MODELS, draft.model]
    : CHATGPT_MODELS;

  function select(id: string) {
    const p = (prompts.data ?? []).find((x: Tables<"prompt_templates">) => x.id === id);
    if (!p) return;
    setActive(id);
    setTestResult(null);
    setTestVars(Object.fromEntries(((p.variables as string[]) ?? []).map((v) => [v, ""])));
    setDraft({
      system_prompt: p.system_prompt,
      user_prompt: p.user_prompt,
      model: p.model,
      temperature: Number(p.temperature ?? 0.3),
      max_tokens: p.max_tokens ?? 4000,
    });
  }

  async function onSave() {
    if (!active || !draft) return;
    setBusy(true);
    try {
      const res = await savePrompt({ data: { id: active, ...draft } });
      toast.success(`Gespeichert als Version ${res.version}`);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!current) return;
    setBusy(true);
    setTestResult(null);
    try {
      const res = await testPrompt({ data: { stepKey: current.step_key, vars: testVars } });
      setTestResult(res.raw);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function onExportAll() {
    setBusy(true);
    try {
      const { filename, markdown } = await exportAllPrompts();
      const url = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Alle Prompts heruntergeladen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="border-border bg-surface">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Vorlagen</CardTitle>
          <Button variant="outline" size="sm" onClick={onExportAll} disabled={busy}>
            Alle Prompts als .md
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {(prompts.data ?? []).map((p: Tables<"prompt_templates">) => (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${
                active === p.id ? "bg-accent" : ""
              }`}
            >
              <span>{p.name}</span>
              <Badge variant="secondary">v{p.version}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      {current && draft ? (
        <div className="space-y-4">
          <Card className="border-border bg-surface">
            <CardHeader>
              <CardTitle className="text-base">{current.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{current.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Modell</Label>
                  <Select
                    value={draft.model}
                    onValueChange={(value) => setDraft({ ...draft, model: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Modell wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Temperature</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={draft.temperature}
                    onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={draft.max_tokens}
                    onChange={(e) => setDraft({ ...draft, max_tokens: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>System-Prompt</Label>
                <Textarea
                  rows={6}
                  value={draft.system_prompt}
                  onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>User-Prompt</Label>
                <Textarea
                  rows={10}
                  value={draft.user_prompt}
                  onChange={(e) => setDraft({ ...draft, user_prompt: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Variablen: {((current.variables as string[]) ?? []).join(", ") || "—"}
                </p>
              </div>
              <Button onClick={onSave} disabled={busy}>
                Speichern (neue Version)
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-surface">
            <CardHeader>
              <CardTitle className="text-base">Testlauf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.keys(testVars).map((v) => (
                <div key={v} className="space-y-1.5">
                  <Label>{v}</Label>
                  <Textarea
                    rows={2}
                    value={testVars[v] ?? ""}
                    onChange={(e) => setTestVars({ ...testVars, [v]: e.target.value })}
                  />
                </div>
              ))}
              <Button variant="outline" onClick={onTest} disabled={busy}>
                {busy ? "…" : "Prompt testen"}
              </Button>
              {testResult && (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {testResult}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bitte links eine Vorlage wählen.</p>
      )}
    </div>
  );
}
