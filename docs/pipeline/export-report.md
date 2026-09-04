# Der Prozess-Report: Was ist im Job wirklich passiert?

## Wozu gibt es ihn?

Wenn ein Job fertig ist (oder unterwegs stecken bleibt), möchte man verstehen: Warum
sieht das Ergebnis so aus? Warum fehlt ein Link? Woran ist es gescheitert?

Der Prozess-Report ist eine einzelne Datei, die den **kompletten Durchlauf** eines Jobs
lückenlos dokumentiert. Für jede Station steht darin: was sie bekommen hat, was sie
daraus gemacht hat, wie lange sie gebraucht hat und ob etwas schiefging. Man braucht
keinen Zugriff auf die Technik, um damit zu arbeiten — die Datei lässt sich in jedem
Texteditor öffnen.

## Wie bekomme ich ihn?

Job-Detailseite öffnen → Schaltfläche **„Prozess-Report (.md)"** anklicken. Die Datei
wird auf dem Server erzeugt und heruntergeladen. Der Dateiname enthält die Job-Nummer,
z. B. `job-949b43b8-report.md`.

Das Format `.md` (Markdown) ist einfacher Text mit ein paar Formatierungszeichen. Man
kann die Datei per E-Mail weitergeben, in Word öffnen oder in ein Ticket einfügen.

## Was steht drin?

**1. Kopfbereich**
Um welchen deutschen Artikel geht es, welcher Zielmarkt (Land, Sprache, Domain), wie
ist der Stand des Jobs, an welcher Station steht er gerade, wann wurde der Report
erzeugt.

**2. Zusammenfassung**
Eine Tabelle mit allen Stationen auf einen Blick: Station, Status (erledigt, Fehler,
blockiert), wie oft sie gelaufen ist, wie lange sie gedauert hat und welches KI-Modell
verwendet wurde. Hier sieht man in fünf Sekunden, wo es klemmt.

**3. Jede Station einzeln**
Pro Station ein eigener Abschnitt mit:

- einer kurzen Beschreibung, was diese Station tut,
- **Eingabe** — die Daten, mit denen sie gearbeitet hat,
- **Prompt-Schnappschuss** — bei KI-Stationen der wortwörtliche Auftrag, der ans
  Modell geschickt wurde (so, wie er nach dem Einsetzen aller Variablen aussah),
- **Ausgabe** — das Ergebnis der Station,
- **Fehler** — nur wenn es einen gab, im Klartext.

**4. Job-Kontext (Endstand)**
Die vollständige Sammlung aller Zwischenergebnisse, so wie sie am Ende vorlag.

**5. Verifizierte Links**
Eine Tabelle aller Links, die es tatsächlich in den Text geschafft haben: Linktext,
Zieladresse, Antwortcode der Seite und ob die Seite sich selbst als diese Adresse
ausweist.

**6. Fertiger Text**
Das Ergebnis der letzten Station — der komplette Exporttext.

## Gut zu wissen

Sehr lange Inhalte (etwa ein kompletter Artikeltext im Eingabe-Bereich) werden im
Report gekürzt und mit `… [gekürzt]` markiert, damit die Datei lesbar bleibt. Wichtig:
Gekürzt wird **nur die Anzeige im Report** — die KI hat immer den vollständigen Text
bekommen.
