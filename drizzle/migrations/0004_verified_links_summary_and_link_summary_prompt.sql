ALTER TABLE public.verified_links
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS page_type text;

INSERT INTO public.prompt_templates
  (step_key, name, description, model, temperature, max_tokens, response_format, sort_order, system_prompt, user_prompt, variables)
VALUES (
  'link_summary',
  'S9 · Zielseite zusammenfassen',
  'Fasst jede verifizierte Zielseite in einem Absatz zusammen, damit S11 den echten Inhalt kennt.',
  'google/gemini-3.7-flash',
  0.2,
  1200,
  'json',
  95,
  'Du fasst Webseiten für die interne Verlinkung zusammen. Antworte ausschließlich mit gültigem JSON.',
  'Fasse den Inhalt dieser Seite zusammen.

<url>{{url}}</url>
<titel>{{title}}</titel>
<h1>{{h1}}</h1>
<meta_description>{{meta_description}}</meta_description>
<gliederung>{{outline}}</gliederung>
<seitentext>{{page_text}}</seitentext>

Aufgaben:
1. summary: EIN Absatz (max. 60 Wörter) in {{language}}, der konkret sagt, welche Frage die Seite beantwortet und welche Themen sie NICHT behandelt.
2. page_type: "ratgeber" (redaktioneller Artikel), "kategorie" (Produktübersicht/PLP), "produkt" (PDP) oder "sonstige".
3. topics: 3–6 Stichworte zum tatsächlichen Seiteninhalt.
4. good_anchor: kurzer, natürlicher Ankertext in {{language}}, der exakt das Seitenthema trifft.

Antworte nur mit JSON:
{"summary":"...","page_type":"ratgeber|kategorie|produkt|sonstige","topics":["..."],"good_anchor":"..."}',
  '["url","title","h1","meta_description","outline","page_text","language"]'::jsonb
)
ON CONFLICT (step_key) DO NOTHING;