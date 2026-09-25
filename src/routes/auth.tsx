import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import logoUrl from "@/assets/omfire-logo.png";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Anmelden – Content-Lokalisierung" },
      { name: "description", content: "Interner Login für das Content-Lokalisierungs-Tool." },
      { property: "og:title", content: "Anmelden – Content-Lokalisierung" },
      { property: "og:description", content: "Interner Login für das Content-Lokalisierungs-Tool." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) {
      navigate({ to: "/reset-password", replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) navigate({ to: "/jobs", replace: true });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("E-Mail zum Zurücksetzen verschickt (bitte auch Spam prüfen).");
        setMode("login");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Angemeldet");
      await navigate({ to: "/jobs", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm border-border bg-surface shadow-sm">
        <CardHeader className="items-center gap-3 pb-2 text-center">
          <img src={logoUrl} alt="OMfire!" className="h-10 w-auto" />
          <p className="text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Passwort zurücksetzen"
              : "Content-Lokalisierung · Bitte anmelden"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "…" : mode === "login" ? "Anmelden" : "Link zum Zurücksetzen senden"}
          </Button>
          {mode === "login" && (
            <button
              type="button"
              className="w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setMode("forgot")}
            >
              Passwort vergessen?
            </button>
          )}
        </form>
        </CardContent>
      </Card>
    </div>
  );
}
