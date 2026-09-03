import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { assignRole } from "@/lib/pipeline.functions";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
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

function UsersPage() {
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ["users-roles"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,email").order("email"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
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

  return (
    <Card className="border-border bg-surface">
      <CardHeader>
        <CardTitle className="text-base">Nutzer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(users.data ?? []).map((u) => (
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
  );
}
