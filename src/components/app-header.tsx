import { LogOut, Settings as SettingsIcon, ListChecks, Users, ChevronsUpDown, Check } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveWorkspace } from "@/lib/use-active-workspace";
import logoUrl from "@/assets/omfire-logo.png";

export function AppHeader() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspace, workspaceId, workspaces, role, setWorkspace } = useActiveWorkspace();
  const isAdmin = role === "admin";
  const canManage = role === "manager" || role === "admin";

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between gap-4 px-6 sm:px-10">
        <Link to="/jobs" className="flex items-center gap-2.5 text-foreground">
          <img src={logoUrl} alt="OMfire!" className="h-[34px] w-auto" />
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 text-[13px] text-subtle-fg md:flex">
            <span>Content-Lokalisierung</span>
            <span className="header-tag">Intern</span>
          </div>

          {workspaces.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 px-2.5">
                  <span className="max-w-[180px] truncate">
                    {workspace?.name ?? "Arbeitsbereich"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                <DropdownMenuLabel>Arbeitsbereich</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {workspaces.map((w) => (
                  <DropdownMenuItem key={w.id} onSelect={() => setWorkspace(w.id)}>
                    <span className="flex-1 truncate">{w.name}</span>
                    {w.id === workspaceId && <Check className="h-4 w-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {workspaces.length <= 1 && workspace && (
            <span className="hidden text-[13px] text-subtle-fg sm:inline">
              {workspace.name}
            </span>
          )}

          <div className="flex items-center gap-1.5">
            <Link to="/jobs">
              <Button variant="ghost" className="h-9 gap-2 px-2.5">
                <ListChecks className="h-4 w-4" />
                <span className="hidden lg:inline">Jobs</span>
              </Button>
            </Link>
            {canManage && (
              <Link to="/team">
                <Button variant="ghost" className="h-9 gap-2 px-2.5">
                  <Users className="h-4 w-4" />
                  <span className="hidden lg:inline">Team</span>
                </Button>
              </Link>
            )}
            {isAdmin && (
              <Link to="/admin/prompts">
                <Button variant="ghost" className="h-9 gap-2 px-2.5">
                  <SettingsIcon className="h-4 w-4" />
                  <span className="hidden lg:inline">Admin</span>
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="icon" aria-label="Abmelden" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
