import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import {
  listWorkspaceMembers,
  inviteUser,
  updateWorkspaceMember,
} from "@/lib/pipeline.functions";
import { useActiveWorkspace } from "@/lib/use-active-workspace";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team – Content-Lokalisierung" },
      { name: "description", content: "Mitglieder des Arbeitsbereichs einladen und verwalten." },
      { property: "og:title", content: "Team – Content-Lokalisierung" },
      { property: "og:description", content: "Mitglieder des Arbeitsbereichs verwalten." },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const qc = useQueryClient();
  const { workspaceId, workspace, role } = useActiveWorkspace();
  const isAdmin = role === "admin";

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["workspace-members", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspaceMembers({ data: { workspaceId: workspaceId! } }),
  });

  async function invite() {
    if (!workspaceId || !email.trim()) return;
    setBusy(true);
    setInviteLink(null);
    try {
      const res = await inviteUser({
        data: {
          email,
          workspace_id: workspaceId,
          role: inviteRole,
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      if (res.emailSent) toast.success(`Einladung an ${res.email} verschickt`);
      else {
        setInviteLink(res.link);
        toast.success("Einladungslink erstellt – bitte manuell weitergeben");
      }
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Einladung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, next: WorkspaceRole | "remove") {
    if (!workspaceId) return;
    try {
      await updateWorkspaceMember({
        data: { workspaceId, userId, role: next === "remove" ? null : next },
      });
      toast.success("Rolle aktualisiert");
      await qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
    }
  }

  const selectableRoles: WorkspaceRole[] = isAdmin
    ? ["viewer", "manager", "admin"]
    : ["viewer", "manager"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Arbeitsbereich: <span className="font-medium text-foreground">{workspace?.name ?? "—"}</span>
        </p>
      </div>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Mitglied einladen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <Input
                type="email"
                placeholder="name@omfire.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as WorkspaceRole)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Rolle" />
              </SelectTrigger>
              <SelectContent>
                {selectableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={invite} disabled={busy || !email.trim()}>
              {busy ? "Sende…" : "Einladen"}
            </Button>
          </div>
          {inviteLink && (
            <p className="break-all rounded-md bg-muted p-2 text-xs">{inviteLink}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Mitglieder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {(members.data ?? []).map((m) => (
            <div
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2"
            >
              <span className="text-sm">{m.email ?? m.user_id}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{ROLE_LABELS[m.role]}</Badge>
                <Select
                  value={m.role}
                  onValueChange={(v) => changeRole(m.user_id, v as WorkspaceRole)}
                >
                  <SelectTrigger className="h-8 w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableRoles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Mitglied entfernen"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => changeRole(m.user_id, "remove")}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {!members.data?.length && !members.isLoading && (
            <p className="text-sm text-muted-foreground">Noch keine Mitglieder.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
