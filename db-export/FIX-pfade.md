# Fehlende Pfad-Einträge („kleintiere", „weitere") beheben

## Was das Problem ist

Schritt S3 baut die Ziel-Adresse, indem er jedes Verzeichnis der deutschen URL
in die Zielsprache übersetzt. Beispiel:

```
/magazin/kleintiere/weitere/igel-fuettern/
   │        │            │
   └ magazin └ kleintiere └ weitere   → müssen alle bekannt sein
```

Die Übersetzungen kommen aus zwei Quellen:

1. `markets.path_map` (JSON-Feld je Markt, im Admin unter „Märkte" pflegbar)
2. Tabelle `market_paths` (gelernte Paare aus Sitemap-/hreflang-Import)

In der neu aufgesetzten Datenbank ist `market_paths` **leer**, weil dieser Block
in `setup.sql` bewusst auskommentiert war (Abschnitt 13.1). Deshalb fehlen
Segmente wie `kleintiere` und `weitere`. Es ist kein Code-Fehler, sondern
fehlende Stammdaten.

## Drei Wege zur Lösung (einer reicht)

**A. Gelernte Pfade einspielen (schnellster Weg)**
Im SQL-Editor der eigenen Supabase-Instanz die Datei
`db-export/optional/market_paths.sql` ausführen. Voraussetzung: Die Märkte
wurden mit denselben IDs aus `setup.sql` angelegt (Standardfall).

**B. Im Admin ergänzen**
`/admin/markets` → Markt aufklappen → Abschnitt „Pfadverzeichnis" →
Paare eintragen, z. B. für Polen:
`kleintiere → male-zwierzeta`, `weitere → inne`.
(Die korrekte Schreibweise bitte an einer echten Ziel-URL prüfen.)

**C. Automatisch lernen lassen**
Im selben Abschnitt „Aus Sitemaps importieren" anstoßen. Das liest die Sitemaps
von Quelle und Zielmarkt und leitet die Paare aus den hreflang-Angaben ab.

## Prompt für die lokale KI

> In meinem Projekt bricht Pipeline-Schritt S3 mit „Fehlende Einträge in der
> path_map des Markts: kleintiere, weitere" ab.
>
> Hintergrund: `buildTargetUrl()` in `src/lib/pipeline/paths.ts` übersetzt jedes
> Verzeichnissegment der Quell-URL über `mergedMap()` (Quellen: `markets.path_map`
> und die Tabelle `market_paths`, geladen via `loadMarketPathMap()` in
> `src/lib/pipeline/market-paths.server.ts`). Fehlt ein Segment, wirft es
> `PathMapError`.
>
> Aufgaben:
> 1. Prüfe, ob die Tabelle `market_paths` Daten enthält
>    (`select market_id, count(*) from market_paths group by 1`). Ist sie leer,
>    spiele `db-export/optional/market_paths.sql` ein.
> 2. Ergänze für den betroffenen Markt die fehlenden Segmente `kleintiere` und
>    `weitere` in `market_paths` (origin `manual`) mit den real verwendeten
>    Zielsegmenten – verifiziere sie an einer echten URL des Zielmarkts (HTTP 200).
> 3. Stelle sicher, dass S3 bei einer Pfadlücke nicht mehr hart abbricht, sondern
>    auf hreflang-Ernte, Hub-Liste und Suche ausweicht und im Zweifel mit dem
>    Ergebnis „Zielseite nicht vorhanden" (`NOT_IN_INDEX`) weiterläuft. Prüfe dazu
>    die Fangstellen von `PathMapError` in `src/lib/pipeline/engine.server.ts`
>    (Schritte S3 und S7a).
> 4. Führe `bun test` und `bunx tsgo --noEmit` aus.
