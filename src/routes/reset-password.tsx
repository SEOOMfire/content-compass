import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import logoUrl from "@/assets/omfire-logo.png";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Neues Passwort – Content-Lokalisierung" },
      { name: "description", content: "Neues Passwort für das interne Content-Lokalisierungs-Tool festlegen." },
      { property: "og:title", content: "Neues Passwort festlegen" },
      { property: "og:description", content: "Neues Passwort für das interne Content-Lokalisierungs-Tool festlegen." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (active && data.session) setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Passwort gespeichert. Du bist angemeldet.");
      await navigate({ to: "/jobs", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Passwort konnte nicht gesetzt werden");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border bg-surface shadow-sm">
        <CardHeader className="items-center gap-3 pb-2 text-center">
          <img src={logoUrl} alt="OMfire!" className="h-10 w-auto" />
          <p className="text-sm text-muted-foreground">Neues Passwort festlegen</p>
        </CardHeader>
        <CardContent>
          {!ready && (
            <p className="mb-3 text-xs text-muted-foreground">
              Link wird geprüft … Falls nichts passiert, fordere bitte einen neuen Link an.
            </p>
          )}
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">Neues Passwort</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Passwort wiederholen</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !ready}>
              {loading ? "…" : "Passwort speichern"}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => navigate({ to: "/auth" })}
            >
              Zurück zur Anmeldung
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
