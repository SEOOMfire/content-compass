CREATE TABLE public.market_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  de_segment text NOT NULL,
  target_segment text NOT NULL,
  origin text NOT NULL DEFAULT 'manual',
  http_status integer,
  confirmed_at timestamptz,
  sample_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX market_paths_market_segment_key
  ON public.market_paths (market_id, de_segment);

CREATE INDEX market_paths_market_idx ON public.market_paths (market_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_paths TO authenticated;
GRANT ALL ON public.market_paths TO service_role;

ALTER TABLE public.market_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "market paths read"
  ON public.market_paths FOR SELECT TO authenticated USING (true);

CREATE POLICY "market paths admin write"
  ON public.market_paths FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));