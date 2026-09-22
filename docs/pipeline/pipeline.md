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
* **Tabellen:** jede `<table>` wird zu Markdown umgewandelt (erste Zeile = Kopf, `|` in Zellen wird maskiert), durchnummeriert. An der Fundstelle im Abschnittstext bleibt ein Positionsmarker `[TABELLE n]` stehen, dazu wird die zugehörige Abschnittsüberschrift gespeichert.
* **Formatierung:** echte Listenpunkte (`<li>`) werden als Zeile mit `- ` erfasst, Absätze (`<p>`) als eigene Zeile ohne Marker. So bleibt unterscheidbar, was im Original Fließtext und was Liste war.
* **hreflang-Liste:** alle `link[rel=alternate][hreflang]` mit Sprache und Adresse.
* **Content-Links:** interne Links **nur aus dem Hauptbereich** — ohne Anker (`#`), `mailto:`, `tel:`, ohne Bild-/PDF-Dateien, ohne Selbstverweis, doppelte Adressen einmalig. Gespeichert mit Linktext plus **Fundstelle**: Abschnitt (`section_heading`), Satz (`sentence`, max. 300 Zeichen), reiner Linktext (`anchor_clean`, max. 8 Wörter) und Art (`kind`: `inline`/`teaser`). Diese Liste ist die Grundlage der hreflang-Ernte in S3/S7a und der Anker in S6.
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

**Stufe 3 — Slug-Kandidaten live prüfen.** Der DE-Pfad wird segmentweise übersetzt (Reihenfolge: gepflegte `path_map` des Markts, dann gelerntes Pfadverzeichnis `market_paths`, dann aus hreflang abgeleitete Paare), das Sprachpräfix des Markts (`markets.path_prefix`, z. B. `/fr`) vorangestellt, das letzte Segment durch jeden Slug-Kandidaten ersetzt und jede Adresse geprüft.

Fehlen Segmente, wird zuerst der Prompt `translate_path_segment` befragt: er nennt bis zu drei Zielsegmente je Lücke. Jede Kombination (max. 9) wird als Verzeichnis-Adresse live geprüft; nur eine Adresse mit HTTP 200 wird übernommen und dauerhaft als `origin: verified` in `market_paths` gespeichert. Bleibt die Lücke bestehen, bricht der Schritt **nicht** ab: die Slug-Prüfung entfällt und das Ergebnis lautet `NOT_IN_INDEX`.

Alle in Stufe 2b abgeleiteten Segmentpaare werden zusätzlich als `origin: hreflang` in `market_paths` gespeichert — das Verzeichnis wird mit jedem Lauf vollständiger.

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

## S7c · SERP-Linkchancen (DataForSEO)

Eigene Stufe direkt nach S7b, ebenfalls mit gefülltem Link-Pool als Voraussetzung. Ziel: zusätzliche Linkziele finden, von denen wir nicht wissen, ob es sie im Zielmarkt gibt — die aber inhaltlich naheliegen.

1. **Chancen erkennen (KI, Prompt `serp_opportunity_queries`).** Eingaben: Thema, Gliederung, die Abschnittstexte der deutschen Quelle (gekürzt), bis zu 80 bekannte Pool-Adressen und die bereits in S7b gestellten Suchanfragen. Die KI überlegt je Abschnitt, wo ein interner Link sinnvoll wäre, und liefert maximal **10** Vorschläge mit Thema, Suchbegriff in der Zielsprache und Begründung. Wiederholungen aus S7b sind ausgeschlossen.
2. **SERP-Abfrage.** Jeder Suchbegriff geht als `site:<domain><sprachverzeichnis> <suchbegriff>` an DataForSEO (erste Ergebnisseite, `depth: 10`). Hat der Markt ein Sprachverzeichnis (z. B. `/fr`), wird es in die `site:`-Einschränkung übernommen und Treffer außerhalb dieses Verzeichnisses werden verworfen. Land und Sprache stammen aus dem `locale` des Markts. Hartes Gesamtbudget: 5 Minuten, offene Anfragen werden als `skipped` protokolliert. Fremde Hosts und bereits bekannte Adressen fallen raus (max. 60 Kandidaten).
3. **Auswahl (KI, Prompt `serp_gap_select`).** Wie in S7b: nur redaktionell passende Seiten, keine Produkt-, Kategorie- oder Serviceseiten.
4. **Prüfung und Übernahme.** Jede ausgewählte Adresse wird per GET geprüft (HTTP 200, Canonical, kein Soft-404) und nur dann mit `origin = serp`, `scope = target`, `fetched = true` und `source_page = serp-chance:<site>` in `link_pool` gespeichert.

**Ergebnis im Kontext:** `serpOpportunities` (Chancenliste, site-Operand inkl. Sprachverzeichnis, Trefferprotokoll, übernommene und abgelehnte Adressen) sowie der erweiterte `linkPool`.

---





## S5 · Stilprofil

Zuerst wird ein bereits gespeichertes Profil für Markt + Content-Typ gesucht; existiert es, wird es ohne KI-Aufruf verwendet. Sonst werden Titel und Text der Geschwisterartikel aus S7a zusammengefügt (max. 12 000 Zeichen) und mit Prompt `style_profile` ausgewertet: Ansprache, Satzlänge, Überschriftenstil, Tonfall, wiederkehrende Formulierungen. Das Ergebnis wird dauerhaft gespeichert. Ohne Geschwisterartikel bricht der Schritt bewusst ab — es wird kein Stil erfunden.

---

## S6 · Lokalisierungsplan

Eingabe: die deutsche Gliederung (je Abschnitt Überschrift + 500 Zeichen Text), das Marktprofil (Land, Sprache, Marke, Institutionen, verbotene Aussagen, Ansprache), der **Hauptgegenstand des Artikels** (`article_subject`, im Code aus H1/Titel/URL-Segment abgeleitet) und die **Inline-Content-Links der Quelle** (`de_content_links`, je mit Abschnitt, Linktext und Satz). Prompt: `localization_plan`.

Ausgabe je Abschnitt: deutsche Überschrift, Zielüberschrift, **Aktion** aus genau vier Werten (`uebersetzen`, `lokalisieren`, `umschreiben`, `streichen`), Hinweise, Tabellen-Kennzeichen und 0–4 **Anker** mit Suchbegriffen, gewünschtem Seitentyp sowie **`origin`** (`source_link` für Anker aus einem Quell-Link inkl. `source_url`, sonst `plan`). Das Schema wird hart geprüft; Serviceaussagen der Marke, die nicht im Marktprofil bestätigt sind, muss der Plan zur Prüfung markieren.

---

## S7 · Linkkandidaten

Für jeden Anker aus S6 wird eine Suchanfrage aus Ankertext + Suchbegriffen + Intent gebildet.

**Stufe 1 — Suche im Pool** (`pool.ts`). Verwendet werden **nur nutzbare Einträge**: `scope = target` und tatsächlich abgerufen — die Quellkandidaten der zweiten Ebene sind ausgeschlossen. Bewertet wird eine Kombination aus:

* Termgewichtung (IDF) über Linktext, Adress-Slug und Breadcrumb,
* Trigramm-Ähnlichkeit (Dice) auf denselben Text, doppelt gewichtet.

Danach greift ein **Themenfilter** (nur wenn das Kategorie-Segment des Artikels bekannt ist): Bonus für Einträge, deren Pfad das Referenz-Kategorie-Segment enthält, Malus für fremde Kategorie-Segmente sowie für die Magazin-Wurzel und reine Übersichtsseiten. Bei `source_link`-Ankern ist das Kategorie-Segment der Quell-URL die Referenz; ein belegtes hreflang-Äquivalent der Quell-URL wird als erster Kandidat gesetzt. Gefiltert wird zunächst auf den gewünschten Seitentyp; findet sich nichts, wird ohne Typfilter erneut gesucht. Rückgabe: bis zu 8 Treffer, absteigend nach Punktzahl.

**Stufe 2 — gezielte Site-Suche.** Nur wenn kein Treffer existiert oder der beste unter 0,6 liegt, und solange das Budget von 10 Anfragen reicht. Bevorzugt wird die interne Suche des Markts (`search_url_pattern` mit `{q}`); daraus werden bis zu 8 Ergebnisse übernommen, die nicht `other` sind. Alternativ, falls konfiguriert, eine `site:`-Websuche. Neue Treffer wandern in den Pool und die Suche wird wiederholt.

Jede Anfrage wird protokolliert (`search_log`: Anker, Suchbegriffe, ob Stufe 2 lief, Quelle, Trefferzahl).

---

## S8 · Linkauswahl

Pro Anker bekommt die KI eine **nummerierte Liste** aus Titel, Seitentyp und Kategorie-Segment — **niemals Adressen**. Prompt: `link_select`. Zusätzlich erhält sie den **echten Satz des Quellabschnitts** (`context_sentence`, statt nur des Ankertexts), den Artikel-H1 (`article_topic`), den Hauptgegenstand (`article_subject`) und den Abschnitt (`section_heading`). Zurück kommt nur eine Nummer oder `null` plus `reason`. Die Nummer wird gegen die Listenlänge geprüft und erst dann in eine Adresse aufgelöst. Damit sind erfundene Links strukturell ausgeschlossen. Seiten zu einem fremden Gegenstand werden abgelehnt (`null`), wenn der Ankertext diesen Gegenstand nicht ausdrücklich nennt.

---

## S9 · Linkprüfung

Jede gewählte Adresse wird live geprüft (HTTP 200 + Canonical + kein Soft-404). Bestanden → Eintrag in `verified_links` (Anker, Adresse, Status, Canonical-Ergebnis, Konfidenz). Nicht bestanden → Eintrag in der Liste verworfener Kandidaten **und** Löschung aus dem Link-Pool, damit dieselbe tote Adresse nicht erneut gewählt wird. Frühere Prüfergebnisse des Jobs werden vorher gelöscht (idempotent).

**Inhaltszusammenfassung.** Derselbe Abruf liefert auch den Seitentext. Daraus erzeugt der Prompt `link_summary` je Zielseite einen Absatz (max. 60 Wörter, Zielsprache) plus Seitentyp (`ratgeber`, `kategorie`, `produkt`, `sonstige`); beides wird in `verified_links.summary` und `verified_links.page_type` gespeichert und in S11 mitgegeben. Damit entscheidet der Schreibschritt anhand des echten Inhalts statt nur anhand von Titel und Adresse. Zwischen zwei Abrufen liegt eine Sekunde Pause. Schlägt die Zusammenfassung fehl, bleibt der Link gültig, aber ohne Beschreibung; der Seitentyp wird dann aus der Textmenge abgeleitet.

---

### Tabellenprüfung am Ende

S11 übergibt dem Modell nur einen undurchsichtigen Positionsmarker. Das Modell darf keine Tabelle schreiben. Nach der Erzeugung entfernt die technische Prüfung jede vom Modell erzeugte Tabelle und wiederholt den Abschnitt; erst danach ersetzt der Code jeden Marker durch exakt die in S10 lokalisierte Tabelle. Geprüft werden exakte Identität, genau ein Vorkommen und der zugeordnete Abschnitt. Fehlende, doppelte, veränderte oder zusätzliche Tabellen blockieren S11, S12 und S13.

## S10 · Tabellen lokalisieren

Ein KI-Aufruf pro Tabelle (Prompt `localize_table`), danach eine **deterministische Prüfung** im Code: gleiche Zeilenzahl wie im Original und — bei Zielsprache ≠ Deutsch — tatsächlich verändertes Ergebnis. Fällt die Prüfung durch, wird bis zu dreimal wiederholt; danach bricht der Schritt mit Angabe des Grundes ab. Ohne Tabellen im Original passiert nichts.

---

## S11 · Content erzeugen

**Überschriftenebenen.** Jeder Abschnitt übernimmt die Ebene (H1/H2/H3) des zugehörigen deutschen Quellabschnitts; die Ebene wird nach der Erzeugung erzwungen, falls das Modell abweicht.

**Inhaltsverzeichnis.** Abschnitte, deren deutsche Überschrift ein Inhaltsverzeichnis ist (z. B. „Inhaltsverzeichnis", „Das erwartet dich", „Auf einen Blick"), werden nicht von der KI geschrieben. Es entsteht nur die Überschrift plus die Zeile `[INHALTSVERZEICHNIS – Platzhalter]`.

**Verdrahtung (rein, testbar, `plan.ts`).** Jeder Planabschnitt wird über seine deutsche Überschrift dem echten Quellabschnitt zugeordnet (normalisiert: Kleinbuchstaben, Akzente entfernt). Findet sich keine Entsprechung, bricht der Schritt mit Nennung der betroffenen Überschriften ab — kein stiller Rückfall. Lokalisierte Tabellen werden **deterministisch über die Positionsmarker `[TABELLE n]`** dem Abschnitt zugeordnet, in dem sie im Original stehen — unabhängig vom Tabellenkennzeichen des Plans. Ohne Marker greift das Kennzeichen als Rückfall; übrig gebliebene Tabellen gehen an den letzten inhaltlichen Abschnitt, damit keine Tabelle verloren geht.

**Aufruf.** Ein KI-Aufruf pro Abschnitt (Prompt `generate_content`, Textausgabe), streng von oben nach unten, Abschnitte mit Aktion `streichen` werden übersprungen. Übergeben werden: ungekürzter deutscher Abschnitt mit technischen Tabellenmarkern, Zielüberschrift, Aktion, Lokalisierungshinweise, Stilprofil, **bereits geschriebene Überschriften**, die **geplanten Abschnittsüberschriften** (`planned_headings`, für Vorschau-Listen), der **komplette bisher geschriebene Artikel** (`previous_content`), die **zugewiesenen Links dieses Abschnitts** (`assigned_links`), die Liste der übrigen verfügbaren verifizierten Links, die Liste der **bereits gesetzten Links** samt Ankertext (`used_links`), Strukturzahlen und Wortbudget sowie Sprache, Sprachvariante, Land, Marke, Ansprache, Institutionen und verbotene Aussagen. Jeder Abschnitt wird höchstens dreimal erzeugt. Harte Verstöße (zusätzliche Überschriften, eigene Tabellen, fehlende Tabellenmarker, stark abweichende Listenanzahl) führen nach drei Versuchen zum Fehler. Weiche Abweichungen (Absatzanzahl ±1, Wortbudget) lösen einen Korrekturversuch aus; bleibt die Abweichung bestehen, wird der Abschnitt übernommen und als Hinweis protokolliert. Fehlt ein zugewiesener Link im Output, gibt es genau einen Korrekturversuch mit Hinweis in `correction_notes`; fehlt er danach weiterhin, wird der Abschnitt übernommen und als weicher Hinweis in `contentWarnings` protokolliert.

**Linkbudget (im Code durchgesetzt).** Nach jedem Abschnitt liest der Code die tatsächlich gesetzten Links aus dem erzeugten Markdown und zählt sie je Ziel-URL mit dem verwendeten Ankertext mit. Eine URL mit zwei Verwendungen wird aus der Kandidatenliste des nächsten Abschnitts entfernt; eine URL mit einer Verwendung bleibt drin, aber ausdrücklich markiert („bereits 1x verlinkt als …“) und ist nur mit komplett anderem Ankertext erneut erlaubt.

**Wiederholungen.** Weil jeder Abschnitt den bisherigen Artikel kennt, dürfen allgemeine Hinweise (z. B. tierärztlichen Rat einholen) sowie Standardaussagen zu Ernährung, Versicherung, Kosten oder Rasseeignung im gesamten Artikel nur genau einmal vorkommen.

Die harten inhaltlichen Regeln (ausschließlich Zielsprache, keine unbestätigten Marken-Services, Überschrift nie als Slug, Lesezeit neu berechnen, nur geprüfte Links) stehen wörtlich in [prompts.md](./prompts.md).

---

## S12 · QA

Vor der sprachlichen QA laufen unabhängige Code-Prüfungen für Tabellenanzahl/-identität, Überschriften, Listen, Absätze, Abschnitts- und Gesamtwortzahl sowie ein **deterministischer Link-Check** (verifizierte vs. tatsächlich gesetzte Markdown-Links; je ungenutztem Link ein `link_ungenutzt`, bei 0 gesetzten Links zusätzlich `keine_links`). Die KI erhält zusätzlich die vollständige Quelle, die lokalisierten Tabellen und einen Strukturbericht und prüft Ergänzungen, Widersprüche und inkonsistente Lokalisierung. Befunde sind zweistufig: **Fehler** (Tabellenprobleme, verbotene Aussagen) blockieren S12 und damit den Export; alle übrigen Befunde (inkl. `link_ungenutzt`/`keine_links`) sind **Hinweise**, werden gespeichert und ausgegeben, stoppen die Pipeline aber nicht. Quelle und Zieltext werden dabei einheitlich verglichen (Tabellen als Positionsmarker), damit S11 und S12 nicht unterschiedlich zählen.

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
| `market_paths` | gelerntes Pfadverzeichnis je Markt: deutsches Segment → Zielsegment, Herkunft (`sitemap`, `hreflang`, `verified`, `manual`), Beleg-Adresse und HTTP-Status; eindeutig je Markt + Segment |
| `markets` | Domain, Locale, Sprachpräfix (`path_prefix`), Pfadübersetzung, Magazin-/Kategoriewurzel, Institutionen, verbotene Aussagen, Ansprache, Abstand zwischen Abrufen, Suchmuster |
| `prompt_templates` / `prompt_versions` | aktuelle Anweisungen und deren Versionshistorie |

**KI-Zugriff** (`ai.server.ts`): Aufrufe laufen über das Lovable-Gateway. Modelle mit Präfix `openai/` nutzen die Responses-Schnittstelle im Streaming-Modus, alle anderen die Chat-Schnittstelle. Platzhalter `{{name}}` werden vor dem Absenden ersetzt (Objekte als eingerücktes JSON). JSON-Antworten werden auch aus Code-Blöcken oder umgebendem Text herausgelöst. Bei Fehlern wird bis zu dreimal mit wachsender Wartezeit wiederholt — außer bei erschöpftem Guthaben oder Zugriffsverweigerung. Verbrauchte Token werden je Schritt mitgeschrieben.

---

## Anhang · Pfadverzeichnis je Markt

Statt einer handgepflegten Übersetzungstabelle führt jeder Markt ein Pfadverzeichnis (`market_paths`). Es wird auf vier Wegen gefüllt:

1. **Sitemap-Import** (Admin → Märkte → „Aus Sitemaps importieren"): robots.txt beider Domains liefert die Sitemaps, bis zu 12 Dateien werden gelesen und die dort hinterlegten hreflang-Alternates zu Segmentpaaren verarbeitet (`origin: sitemap`).
2. **hreflang-Ernte** aus S3/S7a (`origin: hreflang`).
3. **Live bestätigte KI-Vorschläge** aus S3 Stufe 3 (`origin: verified`).
4. **Manuelle Einträge** im Admin (`origin: manual`).

Die gepflegte `path_map` des Markts hat weiterhin Vorrang; das Verzeichnis füllt Lücken.
