import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { roleForWorkspace, type WorkspaceOption, type WorkspaceRole } from "./roles";

const STORAGE_KEY = "active_workspace_id";

let currentId: string | null =
  typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): string | null {
  return currentId;
}

function setActiveWorkspaceId(id: string | null): void {
  currentId = id;
  if (typeof window !== "undefined") {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  for (const listener of listeners) listener();
}

export interface ActiveWorkspace {
  workspaceId: string | null;
  workspace: WorkspaceOption | null;
  workspaces: WorkspaceOption[];
  role: WorkspaceRole;
  setWorkspace: (id: string) => void;
}

/**
 * Aktiver Arbeitsbereich: Auswahl in localStorage, Fallback auf die erste
 * Mitgliedschaft. Bei Wechsel werden alle Query-Caches invalidiert, damit
 * Jobs/Team den neuen Bereich laden.
 */
export function useActiveWorkspace(): ActiveWorkspace {
  const stored = useSyncExternalStore(subscribe, getSnapshot);
  const qc = useQueryClient();
  const { isAdmin, memberships, workspaces } = useRouteContext({ from: "/_authenticated" });

  const validIds = new Set((workspaces ?? []).map((w) => w.id));
  const workspaceId =
    stored && validIds.has(stored) ? stored : (memberships?.[0]?.workspace_id ?? null);
  const workspace = (workspaces ?? []).find((w) => w.id === workspaceId) ?? null;
  const role = roleForWorkspace(isAdmin, memberships ?? [], workspaceId);

  function setWorkspace(id: string) {
    setActiveWorkspaceId(id);
    qc.invalidateQueries();
  }

  return { workspaceId, workspace, workspaces: workspaces ?? [], role, setWorkspace };
}

export { setActiveWorkspaceId };
