import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "editor" | "viewer";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export interface RoleFlags {
  roles: AppRole[];
  isAdmin: boolean;
  isEditor: boolean;
}

export async function loadRoleFlags(userId: string): Promise<RoleFlags> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []).map((r) => r.role) as AppRole[]) ?? [];
  const isAdmin = roles.includes("admin");
  return { roles, isAdmin, isEditor: isAdmin || roles.includes("editor") };
}
