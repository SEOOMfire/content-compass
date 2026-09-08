import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { assignRole, inviteUser } from "@/lib/pipeline.functions";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";


export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Nutzer & Rollen – Content-Lokalisierung" },
      { name: "description", content: "Rollen für interne Nutzer vergeben und entziehen." },
      { property: "og:title", content: "Nutzer & Rollen" },
      { property: "og:description", content: "Rollen für interne Nutzer vergeben und entziehen." },
    ],
  }),
  component: UsersPage,
});

const ROLES: AppRole[] = ["admin", "editor", "viewer"];

type UserRow = { id: string; email: string; roles: AppRole[] };

function UsersPage() {
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ["users-roles"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,email").order("email"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const roleRows = (roles ?? []) as { user_id: string; role: AppRole }[];
      return ((profiles ?? []) as { id: string; email: string }[]).map((p) => ({
        id: p.id,
        email: p.email,
        roles: roleRows.filter((r) => r.user_id === p.id).map((r) => r.role),
      }));
    },
  });

  async function toggle(userId: string, role: AppRole, has: boolean) {
    try {
      await assignRole({ data: { userId, role, action: has ? "remove" : "add" } });
      toast.success("Rollen aktualisiert");
      await qc.invalidateQueries({ queryKey: ["users-roles"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
    }
  }

  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    setInviteLink(null);
    try {
      const res = await inviteUser({
        data: { email, role: "admin", redirectTo: `${window.location.origin}/auth` },
      });
      if (res.emailSent) toast.success(`Einladung an ${res.email} verschickt`);
      else {
        setInviteLink(res.link);
        toast.success("Einladungslink erstellt – bitte manuell weitergeben");
      }
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["users-roles"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Einladung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Admin einladen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              type="email"
              placeholder="name@omfire.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-xs"
            />
            <Button onClick={invite} disabled={busy}>
              {busy ? "Sende…" : "Als Admin einladen"}
            </Button>
          </div>
          {inviteLink && (
            <p className="break-all rounded-md bg-muted p-2 text-xs">{inviteLink}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">

      <CardHeader>
        <CardTitle className="text-base">Nutzer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(users.data ?? []).map((u: UserRow) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2"
          >
            <span className="text-sm">{u.email}</span>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => {
                const has = u.roles.includes(r);
                return (
                  <Button
                    key={r}
                    size="sm"
                    variant={has ? "default" : "outline"}
                    onClick={() => toggle(u.id, r, has)}
                  >
                    {ROLE_LABELS[r]}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
        {!users.data?.length && (
          <p className="text-sm text-muted-foreground">
            Noch keine Nutzer. <Badge variant="secondary">Registrierung über Login</Badge>
          </p>
        )}
      </CardContent>
      </Card>
    </div>
  );

}
