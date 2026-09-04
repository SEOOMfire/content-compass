# Wie das Lokalisierungs-Tool arbeitet

Diese Dokumentation erklärt in einfacher Sprache, was das Tool macht — Schritt für
Schritt, ohne Programmierkenntnisse.

## Was macht das Tool überhaupt?

Wir haben deutsche Ratgeber-Artikel auf fressnapf.de. Diese Artikel sollen in anderen
Ländern erscheinen (z. B. auf maxizoo.pl in Polen oder maxizoo.ie in Irland) — aber
nicht als reine Übersetzung, sondern **an das jeweilige Land angepasst**: richtige
Sprache, passende Marke, landesübliche Einheiten, richtige Behörden und Verbände,
und vor allem: **interne Links, die im Zielland auch wirklich existieren**.

Genau das macht dieses Tool automatisch. Man gibt eine deutsche Artikel-Adresse ein und
wählt den Zielmarkt. Am Ende kommt ein fertiger Text als Datei heraus, den die Redaktion
prüfen und veröffentlichen kann.

## Die wichtigsten Spielregeln

1. **Die KI erfindet niemals Links.**
   Das ist die zentrale Regel. Eine KI würde ohne Weiteres Adressen erfinden, die gut
   aussehen, aber ins Leere führen. Deshalb sammelt das Tool zuerst selbst echte Links
   im Zielland, nummeriert sie, und die KI darf nur noch sagen: „Nimm Nummer 3."
   Welche Adresse hinter Nummer 3 steckt, weiß nur das Programm.

2. **Jeder Link wird vor der Auslieferung angeklickt.**
   Das Tool ruft jede Adresse tatsächlich auf und prüft: Antwortet die Seite mit „OK"?
   Ist es wirklich die Seite, die sie zu sein vorgibt? Ist es keine getarnte
   Fehlerseite? Nur was besteht, kommt in den Text.

3. **„Existiert nicht" und „Wissen wir nicht" sind zwei verschiedene Dinge.**
   Das Tool sagt nie „die Seite gibt es nicht", wenn es das nur vermutet. Es
   unterscheidet klar zwischen „nachweislich nicht vorhanden" und „konnten wir nicht
   feststellen".

4. **Jeder Schritt kann einzeln wiederholt werden.**
   Geht etwas schief, muss nicht alles von vorn laufen. Man wiederholt nur den einen
   Schritt; die Ergebnisse der anderen bleiben erhalten.

5. **Alles passiert auf dem Server, nichts im Browser.**
   Zugangsschlüssel und Seitenabrufe bleiben geschützt.

6. **Die Anweisungen an die KI sind editierbar.**
   Im Admin-Bereich lässt sich jeder KI-Auftrag ändern, testen und auf eine frühere
   Fassung zurücksetzen — ohne Programmierung.

## Der Ablauf in Kurzform

Ein Job durchläuft 14 Stationen. Kurz zusammengefasst:

```text
Deutscher Artikel wird gelesen
        ↓
Wie soll die Seite im Zielland heißen? (Adressname finden)
        ↓
Gibt es die Seite im Zielland schon? (nachsehen und belegen)
        ↓
Falls ja: Was fehlt dort im Vergleich zum deutschen Text?
        ↓
Link-Vorrat im Zielland sammeln (echte, existierende Seiten)
        ↓
Schreibstil des Ziellandes lernen
        ↓
Bauplan erstellen: Welcher Abschnitt wird übersetzt, angepasst, neu geschrieben, gestrichen?
        ↓
Passende Links vorschlagen → KI wählt aus → jeder Link wird geprüft
        ↓
Tabellen ins Zielland übertragen (Einheiten, Normen, Institutionen)
        ↓
Text abschnittsweise schreiben
        ↓
Qualitätskontrolle (Sprache, Marke, verbotene Aussagen)
        ↓
Fertige Datei zum Herunterladen
```

## Die einzelnen Dokumente

| Datei | Worum es geht |
| --- | --- |
| [`pipeline-schritte.md`](./pipeline-schritte.md) | Jede der 14 Stationen ausführlich erklärt: Was geht rein, was passiert, was kommt raus, was kann schiefgehen |
| [`datenmodell.md`](./datenmodell.md) | Wo das Tool welche Informationen speichert und warum |
| [`export-report.md`](./export-report.md) | Der Prozess-Report: eine Datei, die den kompletten Durchlauf eines Jobs nachvollziehbar macht |

## Mitschrift: Nichts passiert unsichtbar

Zu jeder Station wird protokolliert, was sie bekommen hat, was sie gemacht hat, wie
lange es dauerte, welches KI-Modell beteiligt war und ob es einen Fehler gab. Diese
Mitschrift kann man als Datei herunterladen (siehe Prozess-Report). Damit lässt sich
im Nachhinein genau nachvollziehen, warum ein Text so aussieht, wie er aussieht.
