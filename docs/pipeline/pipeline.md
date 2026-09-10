# Wie das Lokalisierungs-Tool arbeitet

Dieses Dokument beschreibt vollständig, was in jedem Schritt passiert: welche Seiten abgerufen werden, welche Links geprüft, gesammelt oder verworfen werden, welche Daten von Schritt zu Schritt weitergereicht werden und an welcher Stelle die KI beteiligt ist. Die Wortlaute der KI-Anweisungen stehen im zweiten Dokument: [prompts.md](./prompts.md).

Ein Auftrag („Job") besteht aus zwei Angaben: der deutschen Quell-URL und dem Zielmarkt. Alles Weitere leitet das System selbst ab.

---

## 0 · Grundbegriffe

| Begriff | Bedeutung |
| --- | --- |
| **Markt** | Zielland + Sprache + Domain, dazu Pfadübersetzung, Institutionen, verbotene Aussagen. Aktiv sind acht Märkte: Schweiz DE/FR, Österreich, Frankreich, Belgien FR/NL, Polen, Irland. |
| **Job-Kontext** | Ein gemeinsamer Datenbeutel, den jeder Schritt ergänzt. Der nächste Schritt liest daraus. Er wird nach jedem Schritt in der Datenbank gespeichert (`jobs.context`). |
| **Link-Pool** | Vorrat an bekannten Adressen des Zielmarkts mit Linktext, Herkunft und Abruf-Vermerk. Ersetzt einen kompletten URL-Index. |
| **hreflang** | Verweis einer Seite auf ihre Übersetzungen. Der zuverlässigste Beleg dafür, dass eine Zielseite existiert. |
| **Anker** | Ein Begriff im Zieltext, der intern verlinkt werden soll. |

Alle Schritte sind einzeln wiederholbar. Vor jedem Start prüft das System die Voraussetzungen (`deps.ts`); fehlt eine, wird der Schritt mit Status `blocked` und Klartextgrund gestoppt statt zu raten.

Jobstatus: `idle` → `running` → `error` (mindestens ein Fehler/blockierter Schritt) bzw. `done` / `done_with_errors` (Export erreicht).

---

## Abrufregeln (gelten überall)

* Abgerufen wird mit `GET`, Kennung `OMfireLocalizationBot/1.0`, Weiterleitungen werden verfolgt; die **End-Adresse** wird weiterverwendet.
* Netzwerk- oder Adressfehler brechen die Pipeline nicht ab: der Abruf liefert Status `0` und leeren Inhalt.
* Abstände zwischen Abrufen: 1 Sekunde bei der Nachbarseiten-Ernte, sonst `crawl_delay_ms` des Markts (Standard 400 ms).
* Abrufbudgets: 20 Nachbarseiten (S3/S7a), 8 Seiten für den Pool-Aufbau (S7a), 10 Suchanfragen (S7).
* **Prüfung einer Zieladresse** (`verifyUrl`) gilt nur als bestanden, wenn HTTP 200 **und** das Canonical-Tag zur Adresse passt **und** kein Soft-404 vorliegt (Überschrift oder Titel enthält „Seite nicht gefunden", „page not found", „nie znaleziono", „404" …). Fehlt das Canonical, gilt die Adresse als nicht bestätigt.

---

## S1 · Quelle extrahieren

**Abruf:** die deutsche Quell-URL. HTTP ≠ 200 bricht den Job ab.

**Aufbereitung** (`extract.server.ts`): Aus dem HTML wird der Hauptbereich gewählt (`main`, sonst `article`, sonst `body`); `script`, `style`, `noscript`, `nav`, `footer`, `header` werden entfernt. Danach entstehen:

* **Abschnitte:** Durchlauf über `h1,h2,h3,p,li`. Jede Überschrift beginnt einen neuen Abschnitt, Absätze und Listenpunkte hängen sich an den laufenden Abschnitt.
* **Tabellen:** jede `<table>` wird zu Markdown umgewandelt (erste Zeile = Kopf, `|` in Zellen wird maskiert), durchnummeriert.
* **hreflang-Liste:** alle `link[rel=alternate][hreflang]` mit Sprache und Adresse.
* **Content-Links:** interne Links **nur aus dem Hauptbereich** — ohne Anker (`#`), `mailto:`, `tel:`, ohne Bild-/PDF-Dateien, ohne Selbstverweis, doppelte Adressen einmalig. Gespeichert mit Linktext. Diese Liste ist die Grundlage der hreflang-Ernte in S3/S7a.
* Zusätzlich: Titel, H1, Meta-Beschreibung, Canonical, Wortzahl, Gliederung.

**Ergebnis im Kontext:** `source`.

---

## S2 · Ziel-Slug ermitteln

**Stufe 1 — hreflang.** Gibt es in der Quellseite ein Alternate zur Markt-Locale (exakte Übereinstimmung, sonst nur Sprachteil), wird dessen letztes Pfadsegment als Slug übernommen. Die KI wird **nicht** aufgerufen (`skipped_llm: true`), die Ziel-Adresse landet als `hreflangTargetUrl` im Kontext.

**Stufe 2 — KI-Vorschlag.** Nur wenn kein Alternate existiert. Übersetzungsgrundlage ist das **letzte Pfadsegment** der Quell-URL (nicht die Überschrift, um Headline-Slugs zu vermeiden). Prompt: `resolve_target_slug`. Die Antwort wird gegen ein Schema geprüft (`term_translated`, mindestens ein Slug), alle Kandidaten werden normalisiert (Kleinbuchstaben, Akzente entfernt, Bindestriche) und dedupliziert. Leere Ergebnisse = Fehler, kein Fallback.

**Ergebnis im Kontext:** `slug`, `hreflangTargetUrl`.

---

## S3 · Zielstatus prüfen

Ziel: Existiert die Seite im Zielmarkt bereits? Jede Teilentscheidung wird als Nachweiskette (`evidence`) protokolliert, jede geprüfte Adresse mit HTTP-Status in `checked`.

**Stufe 1 — hreflang-Adresse.** Liegt `hreflangTargetUrl` vor, wird sie geprüft. Bestanden → Status `EXISTS`, Methode `hreflang`. Existieren Alternates, aber keines für die Ziel-Locale, wird das als starkes Gegenindiz vermerkt (`hreflang_hint`).

**Stufe 2 — Hub-Liste.** Der Elternpfad der Quell-URL wird über die Pfadübersetzung des Markts in eine Hub-Adresse übersetzt (`/magazin/hund/rassen/` → `/magazyn/pies/rasy/`), zusätzlich eine Ebene höher als Rückfall. Von dort werden **alle internen Links** mit Linktext eingelesen. Im Ergebnis wird nach dem übersetzten Begriff und den Slug-Kandidaten gesucht — Ähnlichkeit über Trigramme auf Linktext und Slug, Schwelle 0,72. Ein Treffer wird abgerufen und geprüft.

**Stufe 2b — hreflang-Ernte über die Nachbarartikel.** Findet Stufe 1 und 2 nichts, greift die stärkste Quelle:

1. Aus den Content-Links der Quellseite werden **bis zu 20** Seiten abgerufen, jeweils mit **1 Sekunde Abstand**.
2. Bei jeder wird `link[rel=alternate][hreflang]` gelesen. Zeigt ein Alternate auf die Zieldomain, entsteht ein **belegter Pool-Eintrag** (`origin: hreflang`, `scope: target`, `fetched: true`) mit Linktext und Kurzbeschreibung (Meta-Description, ersatzweise H1).
3. Aus dem Adresspaar DE ↔ Ziel werden **Pfadübersetzungen abgeleitet** (`gesundheit → health`), das letzte Segment bleibt außen vor. Diese abgeleitete Karte füllt nur Lücken; die gepflegte `path_map` des Markts hat Vorrang.
4. **Zweite Ebene:** Nur aus redaktionellen Seiten (Pfad enthält `magazin|magazine|magazyn|ratgeber|blog|guide|conseils|poradnik|advice`) werden weitere redaktionelle Links ausgelesen — **Linktext und Adresse, ohne Abruf**. Produkt- und Kategorieseiten liefern keine Links. Diese Einträge kommen als `origin: candidate`, `scope: source_candidate`, `fetched: false` in den Vorrat und sind bewusst **nicht direkt verwendbar**.
5. Unter den belegten Zieleinträgen wird erneut nach dem Slug gesucht; ein Treffer wird geprüft.

**Stufe 3 — Slug-Kandidaten live prüfen.** Der DE-Pfad wird segmentweise über `path_map` + abgeleitete Karte übersetzt, das letzte Segment durch jeden Slug-Kandidaten ersetzt, jede Adresse geprüft, bis eine besteht. Fehlt ein Segment in der Pfadübersetzung, wird das mit Namen der fehlenden Segmente gemeldet.

**Status:** `EXISTS` (Adresse bestanden) · `VERIFIED_404` (mindestens eine Prüfung meldete 404) · `NOT_IN_INDEX` (nichts bestanden, kein 404 nachweisbar). Bei `EXISTS` wird die Zielseite zusätzlich vollständig extrahiert.

**Ergebnis im Kontext:** `target`, `hreflangHarvest`, `derivedPathMap`.

---

## S4 · Abgleich DE ↔ Ziel

Nur wenn eine Zielseite existiert. Der KI werden Gliederung und Wortzahl beider Seiten sowie ein Auszug des Zieltexts (max. 4000 Zeichen) übergeben. Prompt: `compare`. Antwort: `AUSREICHEND` oder `NEU_ERSTELLEN` mit Lückenliste. Ohne Zielseite wird der Schritt übersprungen (`new_page: true`).

---

## S7a · Link-Pool aufbauen

**Stufe 0 — Ernte.** Wenn S3 die hreflang-Ernte noch nicht durchgeführt hat, geschieht sie hier (identische Regeln, 20 Abrufe, 1 s Abstand).

**Stufe 1 — Hub-Harvesting** (max. 8 Abrufe, `hub.server.ts`):

1. **Hub-Seiten** (bis zu 2 Kandidaten aus der übersetzten Elternhierarchie). Relative Angaben wie `/magazyn/` werden gegen die Marktdomain absolut gemacht.
2. **Navigation:** Magazin-Wurzel bzw. Startseite des Markts.
3. **Bis zu 3 Geschwisterartikel** aus dem Hub (`origin: hub`, Typ `magazine`): sie werden vollständig abgerufen und liefern (a) weitere Links und (b) bis zu 6000 Zeichen Klartext als Stilreferenz für S5.

**Was in den Pool kommt.** Aus jeder abgerufenen Seite werden alle Links auf dieselbe Domain gesammelt (ohne Fragment, doppelte einmalig) mit:

* **Linktext** (Ankertext, sonst leer),
* **Typ:** `magazine`, wenn die Adresse unter der Magazin-Wurzel liegt oder der Pfad `magazyn|magazin|magazine|ratgeber|blog|poradnik|guide|conseils` enthält; `category` bei `/c/`, `kategoria`, `kategorie`, `category`, `shop`; sonst `other`,
* **Herkunft:** `hub`, `nav`, `footer`, `inline`, `search`, `hreflang` oder `candidate` — bestimmt über den umgebenden HTML-Container (bis 12 Ebenen aufwärts: `footer`/`nav`/`header` bzw. Klassennamen),
* **Quellseite**, **Abruf-Vermerk** und **Kurzbeschreibung** (nur bei abgerufenen Seiten).

Anschließend werden die belegten hreflang-Ziele vorn eingefügt und die nicht abgerufenen Quellkandidaten hinten angehängt. Bleibt der Pool leer, bricht der Schritt mit dem Hinweis auf `path_map`, `magazine_root` und Domain ab.

**Speicherung.** Einträge älter als 7 Tage werden für diesen Markt gelöscht; der Rest wird in Blöcken zu 200 in `link_pool` geschrieben, eindeutig über Markt + Typ + Adresse. Gespeichert werden `url`, `anchor_text`, `intent`, `fetched`, `scope`, `path_type`, `origin`, `source_page`, `http_status`.

**Ergebnis im Kontext:** `linkPool` (Hub-Adresse, Abrufprotokoll, Einträge, Geschwisterartikel), `hreflangHarvest`, `derivedPathMap`.

---

## S7b · SERP-Lückenanalyse (DataForSEO)

Läuft direkt nach S7a und setzt einen gefüllten Link-Pool voraus. Ziel: Artikel im Zielmarkt finden, die weder über hreflang noch über Hub/Nachbarseiten auffindbar waren.

1. **Suchanfragen (KI, Prompt `serp_gap_queries`).** Eingaben: Thema, Gliederung der deutschen Quelle, die im deutschen Text verlinkten Themen und bis zu 80 bereits bekannte Pool-Adressen. Ausgabe: maximal 5 Suchbegriffe in der Zielsprache, jeweils zu einem anderen Thema und ohne Suchoperatoren.
2. **SERP-Abfrage.** Jede Anfrage geht als `site:<domain> <suchbegriff>` an DataForSEO (`serp/google/organic/live/advanced`, nur erste Ergebnisseite, `depth: 10`). Land und Sprache kommen automatisch aus dem `locale` des Markts. Alle Anfragen laufen parallel gegen ein hartes Gesamtbudget von 5 Minuten; noch offene Anfragen werden danach abgebrochen und als `skipped` protokolliert. Treffer fremder Hosts werden verworfen, ebenso Adressen, die bereits im Pool stehen (max. 40 Kandidaten).
3. **Auswahl (KI, Prompt `serp_gap_select`).** Bewertet Titel, Adresse und Meta-Beschreibung und wählt ausschließlich redaktionell passende Seiten aus; Produkt-, Kategorie- und Serviceseiten sind ausgeschlossen.
4. **Prüfung und Übernahme.** Jede ausgewählte Adresse wird einmal per GET geprüft (HTTP 200, Canonical, kein Soft-404). Nur bestandene Adressen landen in `link_pool` mit `origin = serp`, `scope = target`, `fetched = true`, `anchor_text` und `intent` (aus der Meta-Beschreibung). Abgelehnte Adressen stehen mit Grund im Schrittergebnis.

**Zugangsdaten:** `DATAFORSEO_LOGIN` und `DATAFORSEO_PASSWORD` (serverseitig). Fehlen sie, bricht der Schritt mit klarer Meldung ab.

**Ergebnis im Kontext:** `serpGap` (Anfragen, Standort/Sprache, Trefferprotokoll, übernommene und abgelehnte Adressen) sowie der um die SERP-Treffer erweiterte `linkPool`.

---



## S5 · Stilprofil

Zuerst wird ein bereits gespeichertes Profil für Markt + Content-Typ gesucht; existiert es, wird es ohne KI-Aufruf verwendet. Sonst werden Titel und Text der Geschwisterartikel aus S7a zusammengefügt (max. 12 000 Zeichen) und mit Prompt `style_profile` ausgewertet: Ansprache, Satzlänge, Überschriftenstil, Tonfall, wiederkehrende Formulierungen. Das Ergebnis wird dauerhaft gespeichert. Ohne Geschwisterartikel bricht der Schritt bewusst ab — es wird kein Stil erfunden.

---

## S6 · Lokalisierungsplan

Eingabe: die deutsche Gliederung (je Abschnitt Überschrift + 500 Zeichen Text) und das Marktprofil (Land, Sprache, Marke, Institutionen, verbotene Aussagen, Ansprache). Prompt: `localization_plan`.

Ausgabe je Abschnitt: deutsche Überschrift, Zielüberschrift, **Aktion** aus genau vier Werten (`uebersetzen`, `lokalisieren`, `umschreiben`, `streichen`), Hinweise, Tabellen-Kennzeichen und 0–4 **Anker** mit Suchbegriffen und gewünschtem Seitentyp. Das Schema wird hart geprüft; Serviceaussagen der Marke, die nicht im Marktprofil bestätigt sind, muss der Plan zur Prüfung markieren.

---

## S7 · Linkkandidaten

Für jeden Anker aus S6 wird eine Suchanfrage aus Ankertext + Suchbegriffen + Intent gebildet.

**Stufe 1 — Suche im Pool** (`pool.ts`). Verwendet werden **nur nutzbare Einträge**: `scope = target` und tatsächlich abgerufen — die Quellkandidaten der zweiten Ebene sind ausgeschlossen. Bewertet wird eine Kombination aus:

* Termgewichtung (IDF) über Linktext, Adress-Slug und Breadcrumb,
* Trigramm-Ähnlichkeit (Dice) auf denselben Text, doppelt gewichtet.

Gefiltert wird zunächst auf den gewünschten Seitentyp; findet sich nichts, wird ohne Typfilter erneut gesucht. Rückgabe: bis zu 8 Treffer, absteigend nach Punktzahl.

**Stufe 2 — gezielte Site-Suche.** Nur wenn kein Treffer existiert oder der beste unter 0,6 liegt, und solange das Budget von 10 Anfragen reicht. Bevorzugt wird die interne Suche des Markts (`search_url_pattern` mit `{q}`); daraus werden bis zu 8 Ergebnisse übernommen, die nicht `other` sind. Alternativ, falls konfiguriert, eine `site:`-Websuche. Neue Treffer wandern in den Pool und die Suche wird wiederholt.

Jede Anfrage wird protokolliert (`search_log`: Anker, Suchbegriffe, ob Stufe 2 lief, Quelle, Trefferzahl) — daraus entsteht später der Gap-Report.

---

## S8 · Linkauswahl

Pro Anker bekommt die KI eine **nummerierte Liste** aus Titel und Seitentyp — **niemals Adressen**. Prompt: `link_select`. Zurück kommt nur eine Nummer oder `null`. Die Nummer wird gegen die Listenlänge geprüft und erst dann in eine Adresse aufgelöst. Damit sind erfundene Links strukturell ausgeschlossen. Thematisch nur benachbarte Seiten sollen abgelehnt werden (`null`).

---

## S9 · Linkprüfung

Jede gewählte Adresse wird live geprüft (HTTP 200 + Canonical + kein Soft-404). Bestanden → Eintrag in `verified_links` (Anker, Adresse, Status, Canonical-Ergebnis, Konfidenz). Nicht bestanden → Eintrag in der Liste verworfener Kandidaten **und** Löschung aus dem Link-Pool, damit dieselbe tote Adresse nicht erneut gewählt wird. Frühere Prüfergebnisse des Jobs werden vorher gelöscht (idempotent).

**Inhaltszusammenfassung.** Derselbe Abruf liefert auch den Seitentext. Daraus erzeugt der Prompt `link_summary` je Zielseite einen Absatz (max. 60 Wörter, Zielsprache) plus Seitentyp (`ratgeber`, `kategorie`, `produkt`, `sonstige`); beides wird in `verified_links.summary` und `verified_links.page_type` gespeichert und in S11 mitgegeben. Damit entscheidet der Schreibschritt anhand des echten Inhalts statt nur anhand von Titel und Adresse. Zwischen zwei Abrufen liegt eine Sekunde Pause. Schlägt die Zusammenfassung fehl, bleibt der Link gültig, aber ohne Beschreibung; der Seitentyp wird dann aus der Textmenge abgeleitet.

---

## S10 · Tabellen lokalisieren

Ein KI-Aufruf pro Tabelle (Prompt `localize_table`), danach eine **deterministische Prüfung** im Code: gleiche Zeilenzahl wie im Original und — bei Zielsprache ≠ Deutsch — tatsächlich verändertes Ergebnis. Fällt die Prüfung durch, wird bis zu dreimal wiederholt; danach bricht der Schritt mit Angabe des Grundes ab. Ohne Tabellen im Original passiert nichts.

---

## S11 · Content erzeugen

**Verdrahtung (rein, testbar, `plan.ts`).** Jeder Planabschnitt wird über seine deutsche Überschrift dem echten Quellabschnitt zugeordnet (normalisiert: Kleinbuchstaben, Akzente entfernt). Findet sich keine Entsprechung, bricht der Schritt mit Nennung der betroffenen Überschriften ab — kein stiller Rückfall. Lokalisierte Tabellen werden **nur** an Abschnitte mit Tabellenkennzeichen vergeben, in Originalreihenfolge.

**Aufruf.** Ein KI-Aufruf pro Abschnitt (Prompt `generate_content`, Textausgabe), streng von oben nach unten, Abschnitte mit Aktion `streichen` werden übersprungen. Übergeben werden: ungekürzter deutscher Abschnitt, Zielüberschrift, Aktion, Lokalisierungshinweise, Stilprofil, **bereits geschriebene Überschriften**, der **komplette bisher geschriebene Artikel** (`previous_content`), die Liste der noch verfügbaren verifizierten Links, die Liste der **bereits gesetzten Links** samt Ankertext (`used_links`), gegebenenfalls die lokalisierte Tabelle, sowie Sprache, Sprachvariante, Land, Marke, Ansprache, Institutionen und verbotene Aussagen.

**Linkbudget (im Code durchgesetzt).** Nach jedem Abschnitt liest der Code die tatsächlich gesetzten Links aus dem erzeugten Markdown und zählt sie je Ziel-URL mit dem verwendeten Ankertext mit. Eine URL mit zwei Verwendungen wird aus der Kandidatenliste des nächsten Abschnitts entfernt; eine URL mit einer Verwendung bleibt drin, aber ausdrücklich markiert („bereits 1x verlinkt als …“) und ist nur mit komplett anderem Ankertext erneut erlaubt.

**Wiederholungen.** Weil jeder Abschnitt den bisherigen Artikel kennt, dürfen allgemeine Hinweise (z. B. tierärztlichen Rat einholen) sowie Standardaussagen zu Ernährung, Versicherung, Kosten oder Rasseeignung im gesamten Artikel nur genau einmal vorkommen.

Die harten inhaltlichen Regeln (ausschließlich Zielsprache, keine unbestätigten Marken-Services, Überschrift nie als Slug, Lesezeit neu berechnen, nur geprüfte Links) stehen wörtlich in [prompts.md](./prompts.md).

---

## S12 · QA

Der gesamte erzeugte Text wird mit Prompt `qa` geprüft, zusammen mit Sprache, Land, Marke, Institutionen und verbotenen Begriffen. Gemeldet werden einzeln: deutsche Reste (`sprache`), unbestätigte Serviceaussagen (`unbestaetigter_service`), unpassende Anker (`link_mismatch`), Slug- oder Kleinschreib-Überschriften (`ueberschrift`), aus dem Deutschen übernommene Lesezeit (`lesezeit`, mit korrektem Wert) sowie Markenname, Ansprache und verbotene Begriffe.

---

## S13 · Export

Erzeugt das fertige Markdown ohne weiteren KI-Aufruf:

* H1 aus dem übersetzten Begriff, **nie als Slug** (Bindestriche aufgelöst, erster Buchstabe groß) — sie entfällt, wenn der Text bereits eine eigene H1 enthält,
* Kopfzeilen: Quelle, Wortzahl des Zieltexts und daraus berechnete **Lesezeit** (200 Wörter/Minute, mindestens 1), Zielstatus, Zielermittlung, hreflang-Hinweis, Umfang des Link-Pools,
* alle Abschnitte in Planreihenfolge, jede Überschrift in genau der Ebene (H1/H2/H3) des deutschen Originalabschnitts,
* Liste der verifizierten Links mit HTTP-Status,
* Liste der verworfenen Poolkandidaten,
* Abschlusshinweis des Markts, falls gepflegt.

Zusätzlich lässt sich zu jedem Job ein **Prozess-Report** herunterladen (`job-<id>-report.md`): pro Schritt Status, Laufzähler, Dauer, Modell, Eingabe-Schnappschuss, verwendeter Prompt-Wortlaut, Ausgabe und Fehlertext.

---

## Anhang · Datenablage

| Tabelle | Inhalt |
| --- | --- |
| `jobs` | Quell-URL, Markt, Status, aktueller Schritt, vollständiger Kontext |
| `job_steps` | je Schritt: Status, Reihenfolge, Eingabe, Ausgabe, Prompt-Schnappschuss, Modell, Token, Dauer, Laufzähler, Fehler |
| `link_pool` | Adresse, Linktext, Kurzbeschreibung, Typ, Herkunft, Quellseite, Abruf-Vermerk, Scope, HTTP-Status; eindeutig je Markt + Typ + Adresse, Lebensdauer 7 Tage |
| `verified_links` | pro Job: Anker, geprüfte Zieladresse, HTTP-Status, Canonical-Ergebnis, Konfidenz |
| `style_profiles` | ein Stilprofil je Markt und Content-Typ |
| `markets` | Domain, Locale, Pfadübersetzung, Magazin-/Kategoriewurzel, Institutionen, verbotene Aussagen, Ansprache, Abstand zwischen Abrufen, Suchmuster |
| `prompt_templates` / `prompt_versions` | aktuelle Anweisungen und deren Versionshistorie |

**KI-Zugriff** (`ai.server.ts`): Aufrufe laufen über das Lovable-Gateway. Modelle mit Präfix `openai/` nutzen die Responses-Schnittstelle im Streaming-Modus, alle anderen die Chat-Schnittstelle. Platzhalter `{{name}}` werden vor dem Absenden ersetzt (Objekte als eingerücktes JSON). JSON-Antworten werden auch aus Code-Blöcken oder umgebendem Text herausgelöst. Bei Fehlern wird bis zu dreimal mit wachsender Wartezeit wiederholt — außer bei erschöpftem Guthaben oder Zugriffsverweigerung. Verbrauchte Token werden je Schritt mitgeschrieben.
