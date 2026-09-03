# Dokumentation · Content-Lokalisierungs-Pipeline

Diese Dokumentation beschreibt exakt, was in jedem Pipeline-Schritt passiert, welche
Daten hineingehen, wie sie verarbeitet werden und was herauskommt.

## Inhalt

| Datei | Inhalt |
| --- | --- |
| [`pipeline-schritte.md`](./pipeline-schritte.md) | S1–S13 im Detail: Input, Verarbeitung, Output, Fehlerfälle |
| [`datenmodell.md`](./datenmodell.md) | Tabellen, Job-Kontext, Persistenz und Idempotenz |
| [`export-report.md`](./export-report.md) | Der Prozess-Report (.md) je Job: Aufbau und Nutzung |

## Grundprinzipien

1. **Alle Netzwerk- und LLM-Aufrufe laufen serverseitig** (`createServerFn`, `*.server.ts`).
   Kein Schlüssel und kein Crawl läuft im Browser.
2. **Das LLM erzeugt niemals URLs.** In S8 wählt das Modell ausschließlich eine
   Kandidatennummer aus einer serverseitig erzeugten Liste; die URL löst der Code auf.
3. **Jede ausgegebene URL ist verifiziert**: HTTP 200 + Canonical-Prüfung + Soft-404-Prüfung.
4. **Zielstatus wird unterschieden**: `EXISTS`, `VERIFIED_404`, `NOT_IN_INDEX`.
5. **Jeder Schritt ist einzeln wiederholbar und idempotent.** Ein erneuter Lauf
   überschreibt Status, Output und den betroffenen Teil des Job-Kontexts.
6. **Prompts sind editierbar, versioniert und testbar** (Admin → Prompts).

## Datenfluss auf einen Blick

```text
Quell-URL (DE)
   │  S1 extract            → SourceDoc (Struktur, Tabellen, hreflang)
   ▼
Slug-Kandidaten (S2) ─► Zielstatus (S3) ─► Abgleich (S4, nur wenn Ziel existiert)
   │
   ├─ Stilprofil (S5, gecached je Markt)
   ▼
Lokalisierungsplan (S6)
   │
   ├─ Linkkandidaten aus URL-Index (S7)
   ├─ Linkauswahl per Nummer (S8)
   └─ Linkverifikation per GET (S9)
   │
Tabellen lokalisieren (S10) ─► Content erzeugen (S11) ─► QA (S12) ─► Export (S13)
```

Jeder Schritt schreibt seinen Input-Snapshot, seinen Output, Modell, Prompt-Snapshot,
Laufzeit, Laufzähler und ggf. den Fehler nach `job_steps`. Daraus wird der
Prozess-Report erzeugt.
