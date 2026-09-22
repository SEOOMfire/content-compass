-- Fügt `reasoning_effort` zu den Prompt-Tabellen hinzu.
-- Reasoning-Modelle (o-Serie, GPT-5.x) werden über reasoning_effort gesteuert,
-- da sie kein `temperature` unterstützen.
ALTER TABLE public.prompt_templates ADD COLUMN IF NOT EXISTS reasoning_effort text;
ALTER TABLE public.prompt_versions ADD COLUMN IF NOT EXISTS reasoning_effort text;
