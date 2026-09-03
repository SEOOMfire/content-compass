# Pipeline-Schritte S1–S13 im Detail

Legende je Schritt: **Eingabe** (woher die Daten kommen) · **Verarbeitung** (was der
Code/das LLM tut) · **Ausgabe** (was gespeichert wird) · **Fehler/Sonderfälle**.

Implementierung: `src/lib/pipeline/engine.server.ts` (Orchestrierung),
`extract.server.ts` (Fetch/Parsing/Verifikation), `ai.server.ts` (LLM),
`pool.ts` (Pool-Retrieval, Gap-Report), `hub.server.ts` (Hub-Harvesting, Site-Suche).
Reine, testbare Logik: `schemas.ts` (Zod-Schemas je Schritt), `paths.ts`
(Pfadübersetzung/hreflang), `tables.ts` (Tabellenprüfung), `plan.ts`
(Plan → Abschnittseingaben), `deps.ts` (Abhängigkeitsprüfung).
Regressionstest: `tests/pipeline-regression.test.ts` (`bun test`).

---

## S1 · Quelle extrahieren (`S1_extract_source`)

- **Eingabe:** `jobs.source_url` (deutsche Quellseite).
- **Verarbeitung:** serverseitiger GET mit festem User-Agent und Redirect-Auflösung.
  HTML-Parsing (`node-html-parser`): Title, H1, Meta-Description, Canonical,
  `hreflang`-Alternates, Abschnitte (Überschrift + Fließtext, hierarchisch nach H2/H3),
  Tabellen (in Markdown konvertiert, inkl. Caption), Wortzahl und ein Outline-String.
- **Ausgabe:** `context.source` = `SourceDoc`. Step-Output enthält die Kopfdaten und
  die Anzahl der Abschnitte.
- **Fehler:** HTTP ≠ 200 bricht den Schritt ab („Quelle antwortete mit HTTP …").
- **Kein LLM.**

## S2 · Ziel-Slug ermitteln (`S2_resolve_slug`)

- **Eingabe:** `source.h1 ?? source.title ?? source_url`, `market.language`, `market.country`.
- **Verarbeitung:** Prompt `resolve_target_slug`. Das Modell übersetzt den Fachbegriff
  in die Zielsprache und schlägt Slug-Varianten vor. Der Code normalisiert jeden
  Vorschlag (`slugify`: Kleinschreibung, Diakritika entfernen, Bindestriche).
- **Ausgabe:** `context.slug = { term_translated, slug_candidates[] }`.
- **Sonderfall:** Liefert das Modell keine Kandidaten, wird der übersetzte Begriff selbst verwendet.

## S3 · Zielstatus prüfen (`S3_target_status`)

- **Eingabe:** `context.slug.slug_candidates`, `market.magazine_root` (Fallback `market.domain`),
  `market.path_map`, Hub-Treffer aus S7a, hreflang-Alternates der Quelle.
- **Verarbeitung:** Nachweiskette in fester Reihenfolge: (1) hreflang-Alternate der
  Quelle mit passender Markt-Locale, (2) Treffer im Link-Pool/Hub, (3) über `path_map`
  segmentweise übersetzte Slug-URLs. Jede Kandidaten-URL wird per Live-GET (`verifyUrl`)
  geprüft (HTTP-Status, Canonical-Vergleich, Soft-404). Der erste valide Treffer gewinnt
  und wird per `extractPage` vollständig geladen; alle Nachweise werden gespeichert.
- **Ausgabe:** `context.target = { status, url, checked[], doc }` mit
  - `EXISTS` – eine Kandidaten-URL antwortet valide mit 200,
  - `VERIFIED_404` – mindestens eine URL liefert nachweislich 404,
  - `NOT_IN_INDEX` – kein 404-Nachweis und kein Pool-/hreflang-Treffer (Aussage:
    unbekannt, nicht „existiert nicht").
- **Kein LLM.**

## S4 · Abgleich (`S4_compare`)

- **Eingabe:** `source.outline`/Wortzahl und – falls vorhanden – `target.doc`
  (Outline, Wortzahl, Textauszug auf 4 000 Zeichen begrenzt).
- **Verarbeitung:** Prompt `compare` ermittelt inhaltliche Lücken, Dubletten und
  Aktualisierungsbedarf.
- **Ausgabe:** `context.compare`.
- **Sonderfall:** Existiert keine Zielseite, wird der Schritt übersprungen und
  `{ new_page: true }` gesetzt (Neuerstellung statt Abgleich).

## S7a · Link-Pool aufbauen (`S7a_link_pool`)

- **Eingabe:** `jobs.source_url`, `market.path_map`, `market.domain`, optional
  `market.search_url_pattern`.
- **Verarbeitung:** Aus dem DE-Pfad werden über `path_map` Hub-Kandidaten im Zielmarkt
  gebildet (`/magazin/hund/rassen/mastiff/` → `/magazyn/pies/rasy/`, danach `/magazyn/pies/`).
  Mit **maximal 8 Abrufen** werden geladen: die erste erreichbare Hub-Seite, die
  Navigation und bis zu drei Geschwisterartikel (deren Text dient S5 als Stilreferenz).
  Alle internen Links werden extrahiert, klassifiziert (`hub`, `nav`, `inline`, `footer`)
  und in `link_pool` persistiert (TTL 7 Tage).
- **Ausgabe:** `context.linkPool = { hub_url, entries[], siblings[], fetches[] }`.
- **Kein LLM.** Kein Gesamtindex, kein Sitemap-Crawl.

## S5 · Stilprofil (`S5_style_profile`)

- **Eingabe:** Cache `style_profiles` (Markt + `content_type = magazine`); sonst die in
  S7a geladenen Geschwisterartikel (Volltextauszüge).
- **Verarbeitung:** Cache-Treffer wird direkt verwendet. Andernfalls Prompt
  `style_profile` über die Referenztexte (max. 12 000 Zeichen) → Tonalität, Satzlänge,
  Ansprache, typische Strukturen. Ergebnis wird im Cache abgelegt.
- **Ausgabe:** `context.styleProfile`.
- **Fehler:** Keine Geschwisterartikel → S7a erneut ausführen.

## S6 · Lokalisierungsplan (`S6_localization_plan`)

- **Eingabe:** Quell-Outline (je Abschnitt Überschrift + 500 Zeichen Text) und ein
  Marktprofil (Land, Sprache, Marke, Institutionen, verbotene Claims, Anredeform).
- **Verarbeitung:** Prompt `localization_plan` (Modell `openai/gpt-5.5`) entscheidet je
  Abschnitt `keep` / `adapt` / `replace` / `drop`, notiert Lokalisierungshinweise und
  schlägt Anker (`anchor`, `intent`, optional `path_type`) für interne Links vor.
- **Ausgabe:** `context.plan.sections[]`.

## S7 · Linkkandidaten (`S7_link_candidates`)

- **Eingabe:** Alle Anker aus dem Plan, der Link-Pool aus S7a.
- **Verarbeitung:** Zweistufig. Stufe 1 = Retrieval im Pool (`retrieveFromPool`:
  Termgewichtung über Ankertext, Slug und Breadcrumb plus Trigramm-Ähnlichkeit,
  optionaler `path_type`-Filter, max. 8 Kandidaten je Anker). Stufe 2 nur für Anker
  ohne Treffer: gezielte Site-Suche über `market.search_url_pattern` (bzw. Firecrawl,
  falls konfiguriert), **maximal 10 Suchanfragen je Job**; Treffer wandern in den Pool.
  Jede Suche wird in `context.linkSearchLog` protokolliert.
- **Ausgabe:** `context.linkCandidates` = `{ anker: [{url, title, path_type}] }`.
- **Kein LLM.** Kandidaten stammen ausschließlich aus Pool oder Site-Suche.

## S8 · Linkauswahl (`S8_link_select`)

- **Eingabe:** Kandidatenliste je Anker (nummeriert, **ohne URLs im Prompt**).
- **Verarbeitung:** Prompt `link_select` gibt `candidate_index` (1..n) oder `null` zurück.
  Der Code prüft die Nummer gegen die Liste und löst erst dann die URL auf.
- **Ausgabe:** `context.linkSelection = [{ anchor, url|null, confidence }]`.
- **Regel:** Freie URL-Erzeugung durch das Modell ist ausgeschlossen — kein Kandidat
  oder ungültige Nummer bedeutet `url: null` (kein Link).

## S9 · Linkprüfung (`S9_link_verify`)

- **Eingabe:** `context.linkSelection`.
- **Verarbeitung:** Alte `verified_links` des Jobs werden gelöscht (Idempotenz).
  Jede ausgewählte URL wird per GET geprüft: HTTP 200, Canonical passend,
  kein Soft-404. Nur bestandene Links werden gespeichert.
- **Ausgabe:** `context.verifiedLinks` und Zeilen in `verified_links` (`source = pool`).
  Durchgefallene Kandidaten werden aus dem Pool entfernt und als `context.brokenLinks`
  protokolliert.
- **Kein LLM.**

## S10 · Tabellen lokalisieren (`S10_localize_tables`)

- **Eingabe:** `source.tables` (Markdown), Sprache, Land, Institutionen des Markts.
- **Verarbeitung:** Prompt `localize_table` je Tabelle: Übersetzung, Einheiten,
  Normen und Institutionen an den Zielmarkt anpassen, Tabellenstruktur bleibt erhalten.
- **Ausgabe:** `context.tables = [{ index, markdown }]`. Ohne Tabellen: leere Liste.

## S11 · Content erzeugen (`S11_generate_content`)

- **Eingabe:** je Planabschnitt der zugehörige deutsche Abschnitt, Aktion und Notizen;
  zusätzlich Stilprofil, Sprache/Sprachvariante, Marke, Anredeform, bereits geschriebene
  Überschriften (gegen Dubletten), verifizierte Links und lokalisierte Tabellen.
- **Verarbeitung:** Prompt `generate_content` (Modell `openai/gpt-5.5`) abschnittsweise.
  `drop`-Abschnitte werden übersprungen. Fehlt ein Plan, werden die Quellabschnitte mit
  Aktion `adapt` verwendet. Es dürfen ausschließlich die übergebenen verifizierten
  Links verwendet werden.
- **Ausgabe:** `context.content = [{ heading, markdown }]`.

## S12 · QA (`S12_qa`)

- **Eingabe:** Gesamttext aus S11, Marke, verbotene Claims, Sprache.
- **Verarbeitung:** Prompt `qa` prüft Sprache/Variante, Markenbezeichnung, verbotene
  Claims, Anredeform, Dubletten und Linkkonsistenz.
- **Ausgabe:** `context.qa` (Befunde und Schweregrad).
- **Fehler:** Ohne Content bricht der Schritt ab („bitte S11 ausführen").

## S13 · Export (`S13_export`)

- **Eingabe:** Slug/H1, Quell-URL, Zielstatus (inkl. Nachweise), Content-Abschnitte,
  verifizierte Links, Link-Pool-Metadaten, `market.closing_note`.
- **Verarbeitung:** Zusammenbau eines Markdown-Dokuments mit Kopfzeilen, Abschnitten,
  Linkliste (inkl. HTTP-Status), **Gap-Report** (Anker ohne verifizierten Link, verworfene
  Kandidaten, ob die Site-Suche lief) und Marktabschluss.
- **Ausgabe:** `context.exportMarkdown`; Step-Output enthält die Zeichenlänge.
  Der Job wird auf `done` gesetzt.
- **Kein LLM.**

---

## Ausführungsmodi

- **Einzelschritt** – Button „Ausführen"/„Erneut" je Schritt.
- **Ab hier** – Startet bei diesem Schritt und läuft bis S13 oder bis zum ersten Fehler.
- **Komplett ausführen** – S1 bis S13 am Stück.

## LLM-Aufrufe (`ai.server.ts`)

Prompts werden mit Variablen gerendert, über das Lovable-AI-Gateway aufgerufen
(Chat Completions bzw. Responses-API für `openai/*`), das JSON-Ergebnis wird robust
extrahiert und bei ungültiger Antwort bis zu dreimal wiederholt. Rate-Limit- und
Guthabenfehler werden gesondert gemeldet. Der tatsächlich gesendete Prompt wird als
`prompt_snapshot` am Schritt gespeichert.

---

## Verbindliche Verdrahtungsregeln (Fix-Stufe P0–P2)

- **Schemas:** S2, S6, S8 und S10 werden gegen Zod-Schemas validiert
  (`schemas.ts`). Ein Schemafehler bricht den Schritt ab; es gibt keinen stillen
  Fallback auf leere Felder.
- **Aktionsvokabular:** ausschließlich `uebersetzen`, `lokalisieren`,
  `umschreiben`, `streichen`. `streichen` wird in S11 übersprungen.
- **S2-Eingabe:** das letzte Segment der Quell-URL (`mastiff`); die H1 dient nur
  als Kontext.
- **Kein Gesamtindex:** S3/S5/S7 arbeiten ausschließlich auf dem Link-Pool. Ein Job
  wird nie wegen eines leeren Index blockiert.
- **S3-Ziel-URLs:** der komplette DE-Pfad wird segmentweise über
  `market.path_map` übersetzt (`/magazin/hund/rassen/<slug>/` →
  `/magazyn/pies/rasy/<slug>/`). Ein fehlender Map-Eintrag bricht mit Klartext
  ab. Ein hreflang-Alternate mit passender Markt-Locale hat Vorrang; sonst wird
  ein `hreflang_hint` gespeichert und exportiert.
- **S10:** je Tabelle ein echter LLM-Aufruf, bis zu zwei Retries. Gleiche
  Zeilenzahl Pflicht; bei nichtdeutscher Zielsprache ist eine identische Ausgabe
  der Fehler „Tabelle wurde nicht lokalisiert“.
- **S11-Eingabe:** je Abschnitt ein vollständiges `GenerateSectionInput`
  (`de_heading`, ungekürzter `de_body`, `target_heading`, `action`, `notes`,
  `has_table`, `table_markdown`, `written_headings`, `verified_links`,
  `style_profile`, `market`). Zuordnung über `de_heading`; fehlt die Zuordnung,
  bricht der Schritt ab. Tabellen gehen nur an Abschnitte mit
  `has_table === true`, sonst `null`.
- **Input-Snapshot:** darf gekürzt werden, der Modell-Payload nie.
- **Abhängigkeiten:** vor jedem Schritt geprüft; fehlt eine Voraussetzung (auch
  ein fehlender Link-Pool), wird der Schritt `blocked`. Ein leerer Gesamtindex ist
  kein Blocker mehr – den gibt es nicht mehr.
- **Jobstatus:** `done` nur, wenn kein Schritt `error` oder `blocked` ist, sonst
  `done_with_errors`.
- **Telemetrie:** `run_count` wird vor der Ausführung erhöht; S10/S11 aggregieren
  Modell und Tokenverbrauch über alle Teilaufrufe.
- **Unverändert:** das LLM erzeugt nie URLs (S8 wählt nur Kandidatennummern),
  jede ausgelieferte URL hat HTTP 200 mit passendem Canonical und ohne Soft-404,
  und `EXISTS`/`VERIFIED_404`/`NOT_IN_INDEX` bleiben getrennt.
