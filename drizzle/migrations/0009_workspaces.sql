-- ============================================================
-- 0009_workspaces.sql – Mehrere Arbeitsbereiche (Kunden) + 3 Rollen
-- Ersetzt das globale Rollenmodell (user_roles / app_role) durch
-- workspaces + workspace_members mit den Rollen viewer/manager/admin.
-- Läuft als einmalige Migration auf dem Live-Schema (Projekt vjajpeuxefjxxmluffbe).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Neue Objekte: Enum + Tabellen
-- ------------------------------------------------------------------
DO $do$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('viewer', 'manager', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON public.workspace_members (user_id);

-- ------------------------------------------------------------------
-- 2. jobs.workspace_id hinzufügen (zunächst nullable für das Backfill)
-- ------------------------------------------------------------------
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS workspace_id uuid;

-- ------------------------------------------------------------------
-- 3. Daten migrieren: Standard-Arbeitsbereich + Mitglieder + Jobs
-- ------------------------------------------------------------------
DO $$
DECLARE
  default_ws uuid;
  first_admin uuid;
BEGIN
  SELECT user_id INTO first_admin
  FROM public.user_roles
  WHERE role = 'admin'
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.workspaces) THEN
    INSERT INTO public.workspaces (name, created_by)
    VALUES ('Standard', first_admin)
    RETURNING id INTO default_ws;
  ELSE
    SELECT id INTO default_ws FROM public.workspaces ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Bestehende Rollen übernehmen: admin→admin, editor→manager, viewer→viewer.
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT
    default_ws,
    r.user_id,
    CASE r.role
      WHEN 'admin'  THEN 'admin'::public.workspace_role
      WHEN 'editor' THEN 'manager'::public.workspace_role
      ELSE 'viewer'::public.workspace_role
    END
  FROM public.user_roles r
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Sicherheitsnetz: Sollte (wider Erwarten) kein Admin existieren, den
  -- ältesten Nutzer befördern, damit niemand ausgesperrt wird.
  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = default_ws)
     AND NOT EXISTS (
       SELECT 1 FROM public.workspace_members
       WHERE workspace_id = default_ws AND role = 'admin'
     ) THEN
    UPDATE public.workspace_members
    SET role = 'admin'
    WHERE id = (
      SELECT id FROM public.workspace_members
      WHERE workspace_id = default_ws
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  -- Alle Bestandsjobs dem Standard-Arbeitsbereich zuordnen.
  UPDATE public.jobs SET workspace_id = default_ws WHERE workspace_id IS NULL;
END $$;

-- ------------------------------------------------------------------
-- 4. NOT NULL + Fremdschlüssel + Index
-- ------------------------------------------------------------------
ALTER TABLE public.jobs ALTER COLUMN workspace_id SET NOT NULL;

DO $do$ BEGIN
  ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $do$;

CREATE INDEX IF NOT EXISTS jobs_workspace_idx ON public.jobs (workspace_id, created_at DESC);

-- ------------------------------------------------------------------
-- 5. Alte Trigger/Funktionen entfernen (Selbstanmeldung entfällt)
-- ------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_first_user_admin();

-- ------------------------------------------------------------------
-- 6. Alte Policies entfernen, die has_role / user_roles referenzieren
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "job steps read" ON public.job_steps;
DROP POLICY IF EXISTS "jobs delete admin" ON public.jobs;
DROP POLICY IF EXISTS "jobs insert own" ON public.jobs;
DROP POLICY IF EXISTS "jobs read" ON public.jobs;
DROP POLICY IF EXISTS "jobs update own" ON public.jobs;
DROP POLICY IF EXISTS "market paths admin write" ON public.market_paths;
DROP POLICY IF EXISTS "markets admin write" ON public.markets;
DROP POLICY IF EXISTS "prompt versions admin only" ON public.prompt_versions;
DROP POLICY IF EXISTS "prompts admin only" ON public.prompt_templates;
DROP POLICY IF EXISTS "url index admin write" ON public.url_index;
DROP POLICY IF EXISTS "verified links read" ON public.verified_links;

-- ------------------------------------------------------------------
-- 7. Alte Rolle-Funktion, Tabelle und Enum entfernen
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP TABLE IF EXISTS public.user_roles;
DROP TYPE IF EXISTS public.app_role;

-- ------------------------------------------------------------------
-- 8. Neue RLS-Hilfsfunktionen (ersetzen has_role)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_role_of(_user_id uuid, _workspace_id uuid)
RETURNS public.workspace_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
  WHERE user_id = _user_id AND workspace_id = _workspace_id
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE user_id = _user_id AND role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_workspace(_user_id uuid, _workspace_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_workspace_admin(_user_id)
    OR (SELECT role FROM public.workspace_members
        WHERE user_id = _user_id AND workspace_id = _workspace_id) IN ('manager', 'admin')
$$;

-- ------------------------------------------------------------------
-- 9. Globale Stammdaten: Schreibzugriff nur noch für Workspace-Admins
-- ------------------------------------------------------------------
CREATE POLICY "market paths admin write" ON public.market_paths
  FOR ALL TO authenticated
  USING (public.is_workspace_admin(auth.uid()))
  WITH CHECK (public.is_workspace_admin(auth.uid()));

CREATE POLICY "markets admin write" ON public.markets
  FOR ALL TO authenticated
  USING (public.is_workspace_admin(auth.uid()))
  WITH CHECK (public.is_workspace_admin(auth.uid()));

CREATE POLICY "prompt versions admin only" ON public.prompt_versions
  FOR ALL TO authenticated
  USING (public.is_workspace_admin(auth.uid()))
  WITH CHECK (public.is_workspace_admin(auth.uid()));

CREATE POLICY "prompts admin only" ON public.prompt_templates
  FOR ALL TO authenticated
  USING (public.is_workspace_admin(auth.uid()))
  WITH CHECK (public.is_workspace_admin(auth.uid()));

CREATE POLICY "url index admin write" ON public.url_index
  FOR ALL TO authenticated
  USING (public.is_workspace_admin(auth.uid()))
  WITH CHECK (public.is_workspace_admin(auth.uid()));

-- ------------------------------------------------------------------
-- 10. Jobs: Bereichs-Isolation + Verwaltungsrechte
-- ------------------------------------------------------------------
CREATE POLICY "jobs read" ON public.jobs
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(auth.uid())
    OR public.workspace_role_of(auth.uid(), workspace_id) IS NOT NULL
  );

CREATE POLICY "jobs insert" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_workspace(auth.uid(), workspace_id));

CREATE POLICY "jobs update" ON public.jobs
  FOR UPDATE TO authenticated
  USING (public.can_manage_workspace(auth.uid(), workspace_id))
  WITH CHECK (public.can_manage_workspace(auth.uid(), workspace_id));

CREATE POLICY "jobs delete" ON public.jobs
  FOR DELETE TO authenticated
  USING (public.can_manage_workspace(auth.uid(), workspace_id));

-- ------------------------------------------------------------------
-- 11. job_steps / verified_links: lesbar für Bereichsmitglieder
-- ------------------------------------------------------------------
CREATE POLICY "job steps read" ON public.job_steps
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_steps.job_id
        AND public.workspace_role_of(auth.uid(), j.workspace_id) IS NOT NULL
    )
  );

CREATE POLICY "verified links read" ON public.verified_links
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = verified_links.job_id
        AND public.workspace_role_of(auth.uid(), j.workspace_id) IS NOT NULL
    )
  );

-- ------------------------------------------------------------------
-- 12. workspaces / workspace_members: RLS aktivieren + Policies
-- ------------------------------------------------------------------
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces read" ON public.workspaces
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = workspaces.id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "workspaces insert" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(auth.uid()));

CREATE POLICY "workspaces update" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(auth.uid()));

CREATE POLICY "workspaces delete" ON public.workspaces
  FOR DELETE TO authenticated
  USING (public.is_workspace_admin(auth.uid()));

CREATE POLICY "workspace members read" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY "workspace members insert" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_workspace(auth.uid(), workspace_id));

CREATE POLICY "workspace members update" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_workspace(auth.uid(), workspace_id));

CREATE POLICY "workspace members delete" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (public.can_manage_workspace(auth.uid(), workspace_id));

-- ------------------------------------------------------------------
-- 13. Grants für neue Objekte
-- ------------------------------------------------------------------
GRANT ALL ON FUNCTION public.workspace_role_of(uuid, uuid) TO anon;
GRANT ALL ON FUNCTION public.workspace_role_of(uuid, uuid) TO authenticated;
GRANT ALL ON FUNCTION public.workspace_role_of(uuid, uuid) TO service_role;

GRANT ALL ON FUNCTION public.is_workspace_admin(uuid) TO anon;
GRANT ALL ON FUNCTION public.is_workspace_admin(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_workspace_admin(uuid) TO service_role;

GRANT ALL ON FUNCTION public.can_manage_workspace(uuid, uuid) TO anon;
GRANT ALL ON FUNCTION public.can_manage_workspace(uuid, uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_workspace(uuid, uuid) TO service_role;

GRANT ALL ON TABLE public.workspaces TO anon;
GRANT ALL ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;

GRANT ALL ON TABLE public.workspace_members TO anon;
GRANT ALL ON TABLE public.workspace_members TO authenticated;
GRANT ALL ON TABLE public.workspace_members TO service_role;
