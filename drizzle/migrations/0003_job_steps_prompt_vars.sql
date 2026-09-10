-- Platzhalterwerte je Schrittlauf fuer den Platzhalter-Report
ALTER TABLE public.job_steps ADD COLUMN IF NOT EXISTS prompt_vars jsonb;
