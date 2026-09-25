import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Pencil, UserMinus } from "lucide-react";
import {
  createWorkspace,
  updateWorkspace,
  listWorkspaces,
  listWorkspaceMembers,
  inviteUser,
  updateWorkspaceMember,
} from "@/lib/pipeline.functions";
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

export const Route = createFileRoute("/_authenticated/admin/workspaces")({
  head: () => ({
    meta: [
      { title: "Arbeitsbereiche – Content-Lokalisierung" },
      { name: "description", content: "Arbeitsbereiche anlegen und Mitglieder zuordnen." },
      { property: "og:title", content: "Arbeitsbereiche verwalten" },
      { property: "og:description", content: "Arbeitsbereiche anlegen und Mitglieder zuordnen." },
    ],
  }),
  component: WorkspacesPage,
});

const ALL_ROLES: WorkspaceRole[] = ["viewer", "manager", "admin"];

function WorkspacesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState<Record<string, WorkspaceRole>>({});

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => listWorkspaces(),
  });

  async function onCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createWorkspace({ data: { name } });
      toast.success("Arbeitsbereich angelegt");
      setName("");
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Anlegen fehlgeschlagen");
    } finally {
      setCreating(false);
    }
  }

  async function onRename(id: string) {
    if (!renameValue.trim()) return;
    try {
      await updateWorkspace({ data: { id, name: renameValue } });
      toast.success("Umbenannt");
      setRenamingId(null);
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen");
    }
  }

  async function onInvite(workspaceId: string) {
    const email = (inviteEmail[workspaceId] ?? "").trim();
    if (!email) return;
    try {
      await inviteUser({
        data: {
          email,
          workspace_id: workspaceId,
          role: inviteRole[workspaceId] ?? "viewer",
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      toast.success("Einladung verschickt");
      setInviteEmail((m) => ({ ...m, [workspaceId]: "" }));
      await qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Einladung fehlgeschlagen");
    }
  }

  async function onChangeRole(workspaceId: string, userId: string, next: WorkspaceRole | "remove") {
    try {
      await updateWorkspaceMember({
        data: { workspaceId, userId, role: next === "remove" ? null : next },
      });
      toast.success("Rolle aktualisiert");
      await qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aktion fehlgeschlagen");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Arbeitsbereich anlegen</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Input
            placeholder="Name des Arbeitsbereichs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Button onClick={onCreate} disabled={creating || !name.trim()}>
            {creating ? "…" : "Anlegen"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Arbeitsbereiche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(workspaces.data ?? []).map((w) => (
            <div key={w.id} className="rounded-md border border-border">
              <div className="flex items-center gap-2 px-3 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="Mitglieder anzeigen"
                  onClick={() => setOpenId(openId === w.id ? null : w.id)}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${openId === w.id ? "rotate-180" : ""}`}
                  />
                </Button>
                {renamingId === w.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button size="sm" onClick={() => onRename(w.id)}>
                      Speichern
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                      Abbrechen
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm font-medium">{w.name}</span>
                    <Badge variant="secondary">{w.memberCount} Mitglieder</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Umbenennen"
                      onClick={() => {
                        setRenamingId(w.id);
                        setRenameValue(w.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>

              {openId === w.id && (
                <div className="border-t border-border px-3 py-3">
                  <MembersPanel
                    workspaceId={w.id}
                    inviteEmail={inviteEmail[w.id] ?? ""}
                    inviteRole={inviteRole[w.id] ?? "viewer"}
                    onInviteEmailChange={(v) => setInviteEmail((m) => ({ ...m, [w.id]: v }))}
                    onInviteRoleChange={(v) => setInviteRole((m) => ({ ...m, [w.id]: v }))}
                    onInvite={() => onInvite(w.id)}
                    onChangeRole={(userId, next) => onChangeRole(w.id, userId, next)}
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MembersPanel(props: {
  workspaceId: string;
  inviteEmail: string;
  inviteRole: WorkspaceRole;
  onInviteEmailChange: (v: string) => void;
  onInviteRoleChange: (v: WorkspaceRole) => void;
  onInvite: () => void;
  onChangeRole: (userId: string, next: WorkspaceRole | "remove") => void;
}) {
  const members = useQuery({
    queryKey: ["workspace-members", props.workspaceId],
    queryFn: () => listWorkspaceMembers({ data: { workspaceId: props.workspaceId } }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="email"
          placeholder="name@omfire.de"
          value={props.inviteEmail}
          onChange={(e) => props.onInviteEmailChange(e.target.value)}
          className="max-w-xs"
        />
        <Select value={props.inviteRole} onValueChange={(v) => props.onInviteRoleChange(v as WorkspaceRole)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={props.onInvite} disabled={!props.inviteEmail.trim()}>
          Einladen
        </Button>
      </div>

      <div className="space-y-1">
        {(members.data ?? []).map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
            <span className="truncate text-sm">{m.email ?? m.user_id}</span>
            <div className="flex items-center gap-2">
              <Select
                value={m.role}
                onValueChange={(v) => props.onChangeRole(m.user_id, v as WorkspaceRole)}
              >
                <SelectTrigger className="h-8 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map((r) => (
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
                onClick={() => props.onChangeRole(m.user_id, "remove")}
              >
                <UserMinus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {!members.data?.length && (
          <p className="text-sm text-muted-foreground">Noch keine Mitglieder.</p>
        )}
      </div>
    </div>
  );
}
