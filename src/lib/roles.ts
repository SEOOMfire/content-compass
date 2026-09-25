import { supabase } from "@/integrations/supabase/client";

export type WorkspaceRole = "viewer" | "manager" | "admin";

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: "Admin",
  manager: "Manager",
  viewer: "Viewer",
};

export interface Membership {
  workspace_id: string;
  role: WorkspaceRole;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface RoleFlags {
  memberships: Membership[];
  workspaces: WorkspaceOption[];
  isAdmin: boolean;
}

/**
 * Lädt die Arbeitsbereich-Mitgliedschaften des Nutzers sowie die sichtbaren
 * Arbeitsbereiche (für Admins alle, sonst nur die eigenen – via RLS gefiltert).
 */
export async function loadRoleFlags(userId: string): Promise<RoleFlags> {
  const [{ data: members }, { data: workspaces }] = await Promise.all([
    supabase.from("workspace_members").select("workspace_id,role").eq("user_id", userId),
    supabase.from("workspaces").select("id,name").order("name"),
  ]);

  const memberships: Membership[] = ((members ?? []) as { workspace_id: string; role: string }[]).map(
    (m) => ({ workspace_id: m.workspace_id, role: m.role as WorkspaceRole }),
  );
  const isAdmin = memberships.some((m) => m.role === "admin");
  const visibleWorkspaces: WorkspaceOption[] = ((workspaces ?? []) as WorkspaceOption[]).filter(
    (w) => isAdmin || memberships.some((m) => m.workspace_id === w.id),
  );

  return { memberships, workspaces: visibleWorkspaces, isAdmin };
}

/** Rolle des Nutzers in einem Bereich; Admin-Mitgliedschaft wirkt plattformweit. */
export function roleForWorkspace(
  isAdmin: boolean,
  memberships: Membership[],
  workspaceId: string | null,
): WorkspaceRole {
  if (isAdmin) return "admin";
  if (!workspaceId) return "viewer";
  return memberships.find((m) => m.workspace_id === workspaceId)?.role ?? "viewer";
}
