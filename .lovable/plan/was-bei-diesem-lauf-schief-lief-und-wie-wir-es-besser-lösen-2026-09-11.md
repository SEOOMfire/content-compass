# Was bei diesem Lauf schief lief – und wie wir es besser lösen

## Befund

Der Job (Gottesanbeterin DE → Schweiz/Französisch) ist in Schritt 3 hart abgebrochen mit:
„Fehlende Einträge in der path_map des Markts: terra, weitere."

Drei getrennte Ursachen:

1. **Lückenhafte Pfadtabelle.** Für die Schweiz/FR sind nur vier Pfade hinterlegt (hund, katze, rassen, magazin). Die Quell-URL nutzt `/magazin/terra/weitere/` – zwei Segmente fehlen, also bricht der Schritt ab.
2. **Fehlendes Sprachpräfix.** Die Schweizer Seite liegt unter `/fr/…` (magazine_root `/fr/magazine/`), die Pfadtabelle kennt kein `fr`-Segment. Selbst mit ergänzten Einträgen hätte das Tool falsche Adressen gebaut.
3. **Zu strenger Abbruch.** Die Quellseite hatte einen hreflang nach Polen, aber keinen in die Schweiz – ein starkes Indiz, dass die Zielseite schlicht nicht existiert. Statt das als sauberes Ergebnis „nicht vorhanden" zu vermerken und weiterzulaufen, beendet eine Pfadlücke den ganzen Job.

## Zu deiner Idee (alle Verzeichnispfade aller Länder vorab manuell ziehen)

Grundgedanke ist richtig: ein vollständiges Pfadverzeichnis je Land löst genau dieses Problem. Nur manuell würde ich es nicht machen – die Struktur ist groß, ändert sich und wäre schnell veraltet. Vorschlag: **automatisch einlesen, manuell nur korrigieren.**

## Vorschlag

**1. Pfadverzeichnis je Markt automatisch aufbauen**
Ein Marktlauf liest die Sitemaps beider Seiten (DE und Zielland) ein und speichert alle Verzeichnispfade des Ziellandes. Zusätzlich werden aus DE-Seiten mit hreflang die Paare gelernt (`terra` → `terrarium`, `weitere` → `autres`). Ergebnis: eine vollständige, belegte Übersetzungstabelle statt handgepflegter Einzelwerte.

**2. Sprachpräfix je Markt sauber hinterlegen**
Ein eigenes Feld „Pfadpräfix" (z. B. `/fr`) pro Markt, das bei jeder Adressbildung automatisch vorangestellt wird. Damit sind Länder mit mehreren Sprachen (CH, BE) strukturell abgedeckt.

**3. Pfadlücken sollen den Job nicht mehr töten**
Fehlt ein Segment, arbeitet Schritt 3 mit dem weiter, was da ist: hreflang-Ernte aus den Nachbarartikeln, Hub-Liste, Suche im Zielland. Erst wenn alle Wege nichts finden, lautet das Ergebnis „Zielseite nicht vorhanden" – ein gültiges Resultat, mit dem die Pipeline normal weiterläuft und einen neuen Artikel plant.

**4. Übersetzungsvorschläge statt Sackgasse**
Für Segmente, die nirgends belegt sind, schlägt die KI eine Übersetzung vor, prüft die daraus gebaute Adresse live und übernimmt sie nur, wenn sie erreichbar ist. Bestätigte Segmente landen dauerhaft im Pfadverzeichnis – das Tool wird mit jedem Lauf besser.

**5. Pfadverzeichnis im Admin sichtbar und editierbar**
Neue Ansicht je Markt: gelernte Pfade mit Herkunft (Sitemap, hreflang, bestätigt, manuell), durchsuchbar, einzeln korrigierbar und ergänzbar.

## Technische Umsetzung

- Neue Tabelle `market_paths` (market_id, de_segment, target_segment, origin, confirmed_at, http_status), eindeutig je Markt + Segment; dazu `markets.path_prefix`.
- Neuer Marktlauf `sitemap_import` (Server-Funktion): Sitemap-Index des Ziellandes einlesen, Pfadsegmente sammeln, DE↔Ziel-Paare über hreflang ableiten, in `market_paths` schreiben.
- `paths.ts`: `mergedMap()` liest zusätzlich `market_paths`; `PathMapError` wird in S3/S7a nicht mehr geworfen, sondern als weicher Hinweis in die Nachweiskette (`evidence`) geschrieben; Adressbildung berücksichtigt `path_prefix`.
- `engine.server.ts` S3: Reihenfolge hreflang → hreflang-Ernte → Hub → Slug-Kandidaten bleibt, aber jede Stufe ist einzeln überspringbar; Endstatus `NOT_IN_INDEX` statt Abbruch.
- Segmentvorschlag über bestehendes Prompt-System als neues Template `translate_path_segment`, Ergebnis nur nach Live-Prüfung (HTTP 200 + Canonical) persistiert.
- Admin-Seite `admin/markets`: Reiter „Pfade" mit Import-Knopf, Liste und Inline-Bearbeitung.
- Doku `docs/pipeline/pipeline.md` (S3/S7a) und `prompts.md` entsprechend ergänzen.

## Sofortmaßnahme (unabhängig davon)

Für die Schweiz/FR die fehlenden Segmente und das `/fr`-Präfix eintragen, damit laufende Aufträge sofort wieder durchgehen.
