# Wo das Tool welche Informationen speichert

Diese Seite erklärt in einfacher Sprache, welche Daten das Tool sammelt und wozu. Man
kann sich das wie einen Aktenschrank mit beschrifteten Schubladen vorstellen.

## Die Schubladen

**Nutzer und Rechte**

| Schublade | Was drin liegt |
| --- | --- |
| `profiles` | Anzeigedaten je Nutzer: E-Mail, Name. |
| `user_roles` | Wer welche Rolle hat (Admin, Redakteur, Betrachter). Bewusst **getrennt** vom Profil: Läge die Rolle beim Profil, könnte sich jemand über die Profilbearbeitung selbst zum Admin machen. Rollen werden ausschließlich auf dem Server geprüft, nie im Browser. |

**Einstellungen**

| Schublade | Was drin liegt |
| --- | --- |
| `markets` | Alles über einen Zielmarkt: Land, Sprache, Adresse der Website, wo der Magazinbereich liegt, die Übersetzungstabelle für Adressbestandteile, Markenname, Anredeform (siezen/duzen), wichtige Institutionen, verbotene Aussagen, ein fester Schlusstext und wie höflich langsam die Website abgerufen werden soll. |
| `prompt_templates` | Der aktuell gültige Auftrag an die KI je Station — inklusive Modell und Einstellungen. Im Admin bearbeitbar. |
| `prompt_versions` | Die vollständige Änderungshistorie dazu. Jede Änderung wird archiviert, man kann jederzeit zurück. |

**Arbeitsdaten**

| Schublade | Was drin liegt |
| --- | --- |
| `link_pool` | Der gesammelte Link-Vorrat je Markt: Adresse, Linktext, Art der Seite und woher der Link stammt (Übersichtsseite, Navigation, Fließtext, Fußzeile, Suche, Sprachversion). Ersetzt die frühere Komplett-Erfassung der Website. |
| `jobs` | Ein Lokalisierungsvorgang: welcher deutsche Artikel, welcher Markt, aktueller Stand, an welcher Station, plus die gesammelten Zwischenergebnisse. |
| `job_steps` | Ein Eintrag je Station und Job: Status, Eingabe, Ausgabe, verwendeter KI-Auftrag, Modell, Verbrauch, Dauer, Fehler und wie oft die Station schon lief. |
| `verified_links` | Nur die tatsächlich geprüften Links eines Jobs, mit Prüfergebnis. |
| `style_profiles` | Das gelernte Stilprofil je Markt, damit es nicht bei jedem Job neu erarbeitet werden muss. |

Die frühere Schublade `url_index` (eine Komplettliste aller Adressen einer Website)
gibt es nicht mehr — bei rund einer Million Seiten war sie weder befüllbar noch aktuell
zu halten. An ihre Stelle ist der gezielt geerntete `link_pool` getreten.

Alle Schubladen sind zugriffsgeschützt: Ohne passende Rolle sieht man nichts.

## Die Sammelmappe eines Jobs

Jeder Job hat eine Sammelmappe, in die jede Station ihr Ergebnis legt. Die Mappe wächst
mit jedem Schritt und enthält am Ende unter anderem:

- den zerlegten deutschen Artikel (S1),
- die Adressnamen-Vorschläge (S2),
- den Zielstatus samt Nachweisen und, falls vorhanden, die geladene Zielseite (S3),
- die aus Nachbarartikeln gelernte Adressübersetzung und das Ernteprotokoll (S3/S7a),
- den Vergleich mit der bestehenden Seite (S4),
- das Stilprofil (S5),
- den Bauplan (S6),
- den Link-Vorrat, die Vorschläge, die Auswahl, die geprüften und die durchgefallenen
  Links samt Suchprotokoll (S7a bis S9),
- die überarbeiteten Tabellen (S10),
- die geschriebenen Abschnitte (S11),
- die Qualitätsbefunde (S12),
- den Lückenbericht und das fertige Dokument (S13).

Die genaue technische Struktur steht in `src/lib/pipeline/types.ts`.

## Warum man jeden Schritt gefahrlos wiederholen kann

Wird eine Station gestartet, läuft immer dieselbe Reihenfolge ab:

1. Job und Marktdaten laden.
2. Station auf „läuft" setzen und den Laufzähler erhöhen.
3. **Einen Schnappschuss der Eingabe speichern** — also festhalten, mit welchen Daten
   diese Station gearbeitet hat. Genau das macht später den Report so aussagekräftig.
4. Die eigentliche Arbeit ausführen.
5. Das Ergebnis in die Sammelmappe einfügen — und zwar **nur die eigenen Einträge**.
   Ergebnisse anderer Stationen bleiben unangetastet.
6. Status, Ausgabe, Modell, KI-Auftrag und Dauer festhalten.
7. Bei einem Fehler: Status auf „Fehler" und die Meldung im Klartext speichern. Die
   Sammelmappe bleibt dabei erhalten — es geht nichts verloren.

Deshalb gilt: Eine Station beliebig oft zu wiederholen ist unbedenklich. Nachfolgende
Stationen lesen automatisch den aktuellsten Stand.

## Was das Tool bewusst *nicht* speichert

- Keine Kopie der kompletten Zielwebsite.
- Keine Adressen, die nicht geprüft wurden.
- Keine Zugangsschlüssel im Browser — sämtliche Abrufe und KI-Aufrufe laufen auf dem
  Server.
