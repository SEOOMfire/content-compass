# Content-Erstellung zuverlässig absichern

## Ziel
Der Zieltext bleibt eng am Original, übernimmt Struktur und Aussagen ohne freie Erweiterungen und enthält jede lokalisierte Tabelle genau einmal an ihrer ursprünglichen Position. Fehler werden nicht nur gemeldet, sondern blockieren den Export.

## Umsetzung

### 1. Tabellen vollständig deterministisch einsetzen
- S11 erhält bei Tabellen nur noch einen eindeutigen Positionsmarker, nicht den Tabelleninhalt als Schreibauftrag.
- Vor der Texterzeugung werden Tabellen aus dem Abschnitt entfernt; nach der Erzeugung werden alle vom Modell ausgegebenen Markdown-Tabellen erkannt und verworfen beziehungsweise als Regelverstoß behandelt.
- Der Positionsmarker wird anschließend technisch durch exakt die zugeordnete, bereits in S10 lokalisierte Tabelle ersetzt.
- Fehlt der Marker, wird die Tabelle an der aus S1 dokumentierten Position im zugeordneten Abschnitt eingesetzt; sie wird nicht an einen beliebigen letzten Abschnitt angehängt.
- Eine harte Prüfung kontrolliert je Tabelle: genau ein Vorkommen, exakte Übereinstimmung mit S10, richtiger Abschnitt und keine zusätzliche fremde Tabelle.

### 2. Tabellen inhaltlich eng lokalisieren
- S10 darf Tabellenwerte übersetzen und nur ausdrücklich erlaubte Marktdaten anpassen, aber keine neuen Fakten, Bedingungen oder Interpretationen ergänzen.
- Nicht bestätigte marktgebundene Aussagen werden neutral entfernt oder eindeutig als Information der Quelle gekennzeichnet; es werden keine neuen rechtlichen Aussagen erfunden.
- Zeilenanzahl, Zeilenreihenfolge und Tabellenstruktur bleiben exakt erhalten.

### 3. Überschriften robust extrahieren und bereinigen
- Die Textextraktion erhält sichtbare Wortabstände zwischen verschachtelten Elementen, damit zusammengezogene Überschriften vermieden werden.
- Bereits vorhandene Markdown-Marker werden aus extrahierten Überschriftentexten entfernt.
- Vor S11 werden Quell- und Zielüberschriften normalisiert; S11 erzeugt exakt eine Überschriftenmarkierung der dokumentierten Ebene.
- Eine Schlussprüfung erkennt doppelte oder ineinander geschobene Überschriftenmarker.

### 4. Umfang und Abschnittstreue hart begrenzen
- Jeder Zielabschnitt erhält ein Wortbudget, abgeleitet aus dem zugehörigen Quellabschnitt. Die Gesamtfassung darf nur eine kleine, klar definierte Abweichung vom Original haben.
- Lokalisierungshinweise dürfen vorhandene Aussagen anpassen, aber keine zusätzlichen Empfehlungen, Bedingungen, Warnungen, Beispiele oder Themen erzeugen.
- Wiederholte allgemeine Hinweise werden weiterhin verhindert; zusätzliche Absätze ohne Entsprechung im Quellabschnitt gelten als Fehler.
- Überschreitet ein Abschnitt das Budget oder verletzt die Struktur, wird er mit präzisem Korrekturhinweis erneut erzeugt; nach ausgeschöpften Versuchen schlägt S11 fehl.

### 5. Struktur und Listen deterministisch prüfen
- Absatz-, Listen-, Tabellen- und Bildmarker werden aus S1 als Strukturprofil je Abschnitt weitergegeben.
- Nach jedem S11-Aufruf werden Anzahl und Reihenfolge der Listenpunkte mit der Quelle verglichen.
- Fließtext darf nicht in Listen umgewandelt werden und Listen dürfen nicht zu Fließtext werden.
- Inhaltsverzeichnisse bleiben ausschließlich technische Platzhalter.

### 6. QA zu einem echten Freigabegate machen
- S12 erhält zusätzlich Quelle, lokalisierte Tabellen, Abschnittsstruktur und Wortzahlen.
- Deterministische Prüfungen laufen unabhängig von der KI: Tabellenanzahl/-identität/-position, Überschriftenstruktur, Listenstruktur und Wortabweichung.
- Die KI prüft ergänzend Widersprüche, nicht belegte Ergänzungen und inkonsistente Lokalisierung.
- Kritische Befunde führen zu einem fehlgeschlagenen QA-Schritt; S13 exportiert keinen fehlerhaften Text mehr.

### 7. Prompts, Dokumentation und Versionierung synchronisieren
- Die Anweisungen für S10, S11 und S12 werden neutral und allgemein formuliert, ohne Länder- oder Fallbeispiele und ohne Verweise auf diesen Lauf.
- Neue Prompt-Versionen werden gespeichert, damit bestehende Versionen nachvollziehbar bleiben.
- Pipeline- und Prompt-Dokumentation werden an die tatsächlichen Prüf- und Einsetzregeln angeglichen.

## Technische Prüfung
- Regressionstests für genau eine Tabelle, falsche/zusätzliche Tabellen, Tabellenposition, zusammengezogene Überschriften, doppelte Markdown-Marker, Listenabweichungen und Wortbudgets.
- Bestehende Pipeline-Tests vollständig ausführen.
- Den hochgeladenen Lauf als anonymisierten Strukturfall gegen die neuen reinen Prüf- und Bereinigungsfunktionen testen.
