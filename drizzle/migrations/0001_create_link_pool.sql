CREATE TABLE public.link_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  content_type text NOT NULL DEFAULT 'magazine',
  source_page text NOT NULL,
  url text NOT NULL,
  anchor_text text,
  path_type text NOT NULL DEFAULT 'other',
  origin text NOT NULL DEFAULT 'hub',
  http_status integer,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market_id, content_type, url)
);

CREATE INDEX link_pool_market_idx ON public.link_pool (market_id, content_type, fetched_at DESC);

GRANT SELECT ON public.link_pool TO authenticated;
GRANT ALL ON public.link_pool TO service_role;

ALTER TABLE public.link_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read link pool"
  ON public.link_pool FOR SELECT TO authenticated USING (true);

ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS search_url_pattern text;