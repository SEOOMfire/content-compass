# Umgang mit abweichenden Marktstrukturen (Fall Ungarn)

## Das Problem in einem Satz

Die Pipeline nimmt an, dass jeder Markt dieselbe Seitenstruktur hat wie Deutschland
(`/magazin/hund/rassen/…`, nur mit übersetzten Segmenten). Ungarn läuft auf einer
anderen Shop-Plattform: Es gibt dort kein `/magazin/`, und jede Anfrage danach wird
still auf eine Shop-Seite (`/Kutya`) umgeleitet. Die Pipeline sieht „HTTP 200" und
arbeitet mit der falschen Seite weiter, bis S5 mangels Artikeln stehenbleibt.

Umleitungen sind tatsächlich unkritisch — solange geprüft wird, **wohin** umgeleitet
wurde. Genau diese Prüfung fehlt heute.

## Lösung in vier Bausteinen

### 1. Umleitungen bewerten statt ignorieren

Bei jedem Abruf wird verglichen, was angefragt wurde und wo man gelandet ist:

- Gleiche Seite, nur andere Schreibweise (Slash am Ende, Groß-/Kleinschreibung,
  `www.`) → unauffällig, weiterarbeiten.
- Ziel liegt weiterhin im erwarteten Bereich (z. B. weiterhin unterhalb des
  Magazin-Roots) → akzeptiert, die finale URL wird übernommen.
- Ziel springt in einen ganz anderen Bereich oder auf die Startseite → als
  „Soft-404 durch Umleitung" gewertet, also behandelt wie 404.

Jeder Abruf protokolliert künftig `angefragt`, `final`, `Bewertung`. Damit steht im
Prozess-Report sofort, dass `/magazin/kutya/` → `/Kutya` ein Fehlschlag war.

### 2. Marktstruktur einmalig ermitteln statt raten

Pro Markt wird ein kurzer Struktur-Check ausgeführt (Admin-Aktion, Ergebnis wird am
Markt gespeichert):

- Startseite laden, Navigation und Footer auswerten, Sitemap prüfen.
- Daraus ableiten: Gibt es überhaupt einen Ratgeber-/Magazinbereich? Unter welchem
  Pfad? Wie sehen typische Artikel-URLs aus?
- Ergebnis: Markt-Status `magazin_vorhanden`, `nur_shop` oder `ungeprüft`, plus die
  gefundenen echten Roots als Vorschlag für `magazine_root` / `category_root`.

Der Struktur-Check schlägt vor, ändert aber nichts automatisch — die Übernahme
bestätigt eine Person im Admin-Bereich.

### 3. Märkte ohne Magazin sauber behandeln

Steht ein Markt auf `nur_shop`, wird ein Job dort nicht mehr blind gestartet.
Stattdessen zwei klare Wege:

- **Blockieren mit Begründung:** „Für Ungarn ist kein Ratgeberbereich hinterlegt.
  Bitte Struktur prüfen oder Modus wählen." — statt eines kryptischen Abbruchs in S5.
- **Greenfield-Modus:** Der Job läuft bewusst ohne Zielmarkt-Vorbilder weiter. S5
  nutzt dann ein am Markt hinterlegtes Standard-Stilprofil (oder das eines
  verwandten Markts), S7/S8 verlinken nur auf Shop-Kategorien aus dem Pool, und der
  Export weist im Gap-Report aus, dass keine internen Ratgeber-Links möglich waren.

Damit ist Ungarn kein Fehler mehr, sondern ein bekannter, dokumentierter Sonderfall.

### 4. S5 entkoppeln

Heute ist S5 hart an „Geschwisterartikel aus S7a" gebunden. Künftig drei Quellen in
dieser Reihenfolge: (a) echte Geschwisterartikel, (b) gespeichertes Stilprofil des
Markts, (c) Standardprofil mit Sprach- und Anredekonvention aus der
Marktkonfiguration. Nur wenn alle drei fehlen, blockiert S5 — dann aber mit dem
Hinweis, welche Konfiguration fehlt.

## Was das für den Ungarn-Job konkret bedeutet

1. Struktur-Check meldet: kein Magazinbereich auf fressnapf.hu.
2. Markt wird auf `nur_shop` gesetzt, `magazine_root` geleert statt falsch belegt.
3. Der Job läuft im Greenfield-Modus: Text wird erzeugt, verlinkt wird auf echte
   Shop-Kategorien (`/Kutya`, `/egeszseg` etc.), der Report nennt die Lücke.
4. Kein stiller Abbruch, keine 404-Prüfungen gegen Pfade, die es nie gab.

## Technische Umsetzung

- `extract.server.ts` → `fetchHtml` gibt zusätzlich `requestedUrl` und eine
  Redirect-Bewertung (`same` | `in_scope` | `out_of_scope`) zurück.
- `hub.server.ts` → neue Funktion `assessRedirect(requested, final, market)`;
  `buildLinkPool` verwirft `out_of_scope`-Treffer und protokolliert sie in `fetches`.
- Neues Modul `structure.server.ts` mit `probeMarketStructure(market)`
  (Startseite + Sitemap + Navigation) → liefert Root-Vorschläge und Strukturtyp.
- Migration: `markets` erhält `structure_type` (`magazine` | `shop_only` | `unknown`),
  `structure_probed_at`, `default_style_profile` (jsonb), `link_policy`
  (`magazine_first` | `shop_only`).
- `engine.server.ts`: S3 wertet Redirects aus (kein `VERIFIED_404` gegen Pfade eines
  nicht existierenden Bereichs, sondern `NOT_APPLICABLE`); S5 nutzt die
  Drei-Stufen-Fallback-Kette; S7a markiert `siblings: []` als Zustand statt als
  stillen Erfolg.
- Admin (`admin/markets.tsx`): Button „Struktur prüfen", Anzeige des Strukturtyps,
  Übernahme der vorgeschlagenen Roots per Klick.
- Report (`report.server.ts`): Redirect-Spalte je Abruf, Strukturtyp im Kopf des
  Reports.

## Reihenfolge

1. Redirect-Bewertung (Baustein 1) — kleinster Eingriff, größter Erkenntnisgewinn.
2. S5-Entkopplung (Baustein 4) — beendet die Blockade sofort.
3. Struktur-Check plus Marktfelder (Baustein 2).
4. Greenfield-Modus und Admin-Oberfläche (Baustein 3).
