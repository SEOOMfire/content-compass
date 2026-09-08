ALTER TABLE public.link_pool
  ADD COLUMN IF NOT EXISTS fetched boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'target';

CREATE INDEX IF NOT EXISTS link_pool_scope_idx ON public.link_pool (market_id, scope, fetched);