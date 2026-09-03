# Datenmodell & Persistenz

## Tabellen

| Tabelle | Zweck | Wichtige Felder |
| --- | --- | --- |
| `profiles` | Anzeigedaten je Auth-Nutzer | `id`, `email`, `display_name` |
| `user_roles` | **Separate** Rollentabelle (kein Rollenfeld am Profil) | `user_id`, `role` (`admin`/`editor`/`viewer`) |
| `markets` | Zielmärkte | `country`, `language`, `locale`, `domain`, `magazine_root`, `category_root`, `path_map`, `brand`, `address_form`, `institutions`, `forbidden_claims`, `closing_note`, `crawl_delay_ms`, `index_last_run`, `active` |
| `prompt_templates` | Aktuell gültiger Prompt je Schritt | `step_key`, `system_prompt`, `user_prompt`, `model`, `temperature`, `max_tokens`, `response_format`, `version` |
| `prompt_versions` | Vollständige Versionshistorie | wie oben + `template_id`, `version`, `created_by` |
| `link_pool` | Gezielt geernteter Link-Pool je Markt (ersetzt den Gesamtindex) | `market_id`, `content_type`, `source_page`, `url`, `anchor_text`, `path_type`, `origin` (`hub`/`nav`/`inline`/`footer`/`search`), `http_status`, `fetched_at` |
| `url_index` | *entfällt* – kein Gesamtindex mehr | – |
| `jobs` | Ein Lokalisierungsvorgang | `source_url`, `market_id`, `status`, `current_step`, `context` (JSON), `created_by` |
| `job_steps` | Ein Lauf je Schritt und Job | `step_key`, `step_order`, `status`, `input`, `output`, `prompt_snapshot`, `model`, `tokens_in/out`, `duration_ms`, `error`, `run_count` |
| `verified_links` | Nur geprüfte Links | `job_id`, `anchor`, `target_url`, `http_status`, `canonical_ok`, `confidence`, `source` |
| `style_profiles` | Stilprofil-Cache je Markt | `market_id`, `content_type`, `profile` |

Alle Tabellen haben RLS und explizite GRANTs. Rollen werden serverseitig über die
`has_role`-Funktion geprüft, nie im Client.

## Job-Kontext (`jobs.context`)

Der Kontext wächst mit jedem Schritt. Struktur siehe `src/lib/pipeline/types.ts`:

```ts
{
  source?: SourceDoc,                 // S1
  slug?: { term_translated, slug_candidates },   // S2
  target?: { status, url, checked, doc },        // S3
  compare?: unknown,                  // S4
  styleProfile?: unknown,             // S5
  plan?: { sections: PlanSection[] }, // S6
  linkPool?: { hub_url, entries[], siblings[], fetches[] },  // S7a
  linkSearchLog?: SearchLogEntry[],   // S7 Stufe 2
  linkCandidates?: Record<anchor, Candidate[]>,  // S7
  linkSelection?: { anchor, url, confidence }[], // S8
  verifiedLinks?: VerifiedLink[],     // S9
  tables?: { index, markdown }[],     // S10
  content?: { heading, markdown }[],  // S11
  brokenLinks?: BrokenLink[],         // S9
  qa?: unknown,                       // S12
  gapReport?: GapReport,              // S13
  exportMarkdown?: string             // S13
}
```

## Idempotenz

`executeStep(jobId, stepKey)`:

1. lädt Job + Markt (Service-Role, serverseitig),
2. setzt den Schritt auf `running` und erhöht `run_count`,
3. speichert einen **Input-Snapshot** (welche Kontextteile und Marktdaten der Schritt bekam),
4. führt `runStep` aus,
5. mischt das Teilergebnis in `jobs.context` (`{...alt, ...neu}`) — nur die eigenen Schlüssel,
6. persistiert `status`, `output`, `model`, `prompt_snapshot`, `duration_ms`,
7. schreibt bei Fehlern `status = error` plus Fehlermeldung, ohne den Kontext zu zerstören.

Dadurch kann jeder Schritt beliebig oft wiederholt werden; nachgelagerte Schritte
lesen immer den aktuellen Kontextstand.
