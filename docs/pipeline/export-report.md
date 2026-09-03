# Prozess-Report (.md) je Job

## Wozu

Der Report dokumentiert den **kompletten Pipeline-Durchlauf eines Jobs**: für jeden
Schritt S1–S13 wird gezeigt, was er als Eingabe bekommen hat und was er ausgegeben hat —
inklusive Modell, Prompt-Snapshot, Laufzeit, Laufzähler und Fehlermeldung.

## Nutzung

Job-Detailseite → Button **„Prozess-Report (.md)"**. Der Report wird serverseitig
erzeugt und als Datei `job-<id>-report.md` heruntergeladen.

## Aufbau

```text
# Prozess-Report · <Quell-URL>
  Kopf: Job-ID, Markt (Land/Sprache/Domain), Status, aktueller Schritt, Zeitstempel

## Zusammenfassung
  Tabelle: Schritt | Status | Läufe | Dauer | Modell

## S1 · Quelle extrahieren
  Beschreibung des Schritts (aus der Schrittdefinition)
  ### Eingabe        → Input-Snapshot als JSON
  ### Prompt-Snapshot→ tatsächlich gesendeter Prompt (falls LLM-Schritt)
  ### Ausgabe        → Output als JSON
  ### Fehler         → nur falls vorhanden
... (für jeden ausgeführten Schritt)

## Job-Kontext (Endstand)
  Der komplette `jobs.context` als JSON

## Verifizierte Links
  Tabelle: Anker | Ziel-URL | HTTP | Canonical OK

## Export-Markdown
  Das finale Ergebnis aus S13
```

Sehr große Werte (z. B. vollständige HTML-Abschnitte) werden zur Lesbarkeit gekürzt
und mit `… [gekürzt]` markiert.
