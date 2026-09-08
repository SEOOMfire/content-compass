# Die 14 Stationen im Detail

Jede Station wird nach demselben Muster erklärt:

- **Was reinkommt** — welche Informationen die Station benutzt
- **Was passiert** — was das Programm bzw. die KI damit macht
- **Was rauskommt** — welches Ergebnis gespeichert wird
- **Wenn es klemmt** — typische Fehler und was sie bedeuten

Bei jeder Station steht außerdem, ob eine KI beteiligt ist. Viele Stationen kommen
ganz ohne KI aus — das ist Absicht, denn alles, was man exakt berechnen oder nachprüfen
kann, soll auch exakt berechnet und nicht geraten werden.

---

## S1 · Den deutschen Artikel lesen

**Was reinkommt:** Die deutsche Artikel-Adresse, die beim Anlegen des Jobs eingegeben
wurde.

**Was passiert:** Das Tool ruft die Seite auf — so, wie es ein Browser tun würde — und
zerlegt sie in ihre Bestandteile:

- Überschrift der Seite und die große Hauptüberschrift
- die Kurzbeschreibung für Suchmaschinen
- die „offizielle" Adresse der Seite (Seiten können unter mehreren Adressen erreichbar
  sein; eine davon ist die maßgebliche)
- Hinweise auf Sprachversionen: Viele Seiten verraten selbst, unter welcher Adresse es
  sie in anderen Ländern gibt. Diese Angaben sind Gold wert und werden später mehrfach
  genutzt.
- alle Abschnitte mit Überschrift und Fließtext, in ihrer Gliederung
- alle Tabellen
- die Wortzahl und eine Inhaltsübersicht
- **die Links, die im Artikeltext selbst stehen** — nur die aus dem Fließtext, nicht
  aus Menü, Kopf- oder Fußzeile. Diese Liste ist die Grundlage für einen sehr wichtigen
  Trick in S3 und S7a.

**Was rauskommt:** Der vollständig zerlegte deutsche Artikel. Alle folgenden Stationen
arbeiten mit dieser Fassung, nicht mit der Live-Seite.

**Wenn es klemmt:** Antwortet die Seite nicht mit „OK", bricht die Station ab
(„Quelle antwortete mit HTTP …"). Meist ist die Adresse falsch oder die Seite
vorübergehend nicht erreichbar.

**KI beteiligt:** nein.

---

## S2 · Wie soll die Seite im Zielland heißen?

**Was reinkommt:** Die Hauptüberschrift des deutschen Artikels und das letzte Stück der
deutschen Adresse (z. B. `mastiff`) sowie Sprache und Land des Zielmarkts.

**Was passiert:** Die KI übersetzt den Fachbegriff in die Zielsprache und schlägt
mehrere mögliche Adressnamen vor. Das Programm bereinigt jeden Vorschlag anschließend
nach festen Regeln: alles klein, Umlaute und Akzente auflösen, Leerzeichen zu
Bindestrichen. Aus „Bullmastiff" wird so z. B. `bulmastif`.

**Was rauskommt:** Der übersetzte Begriff und eine Liste bereinigter Adressnamen-Vorschläge.

**Wenn es klemmt:** Liefert die KI gar keinen Vorschlag, nimmt das Tool einfach den
übersetzten Begriff selbst.

**KI beteiligt:** ja.

---

## S3 · Gibt es die Seite im Zielland schon?

Das ist die kniffligste Station, deshalb ausführlich. Die Frage „gibt es diesen Artikel
in Polen schon?" klingt einfach, ist es aber nicht: Wir können nicht die ganze Website
durchsuchen (dort liegen Hunderttausende Seiten), und raten dürfen wir nicht.

Deshalb arbeitet das Tool eine **Beweiskette** in fester Reihenfolge ab und hört auf,
sobald es einen belastbaren Nachweis hat.

**Stufe 1 — Die deutsche Seite verrät es selbst.**
Wenn der deutsche Artikel eine Sprachversion für genau unser Zielland angibt, ist das
die vom Betreiber selbst erklärte Zieladresse. Besser wird der Beweis nicht.

**Stufe 2 — Wir kennen die Seite bereits.**
Falls im gesammelten Link-Vorrat des Ziellandes (siehe S7a) schon eine passende Seite
liegt, wird sie geprüft.

**Stufe 2b — Der Umweg über die Nachbarartikel.**
Der wichtigste Kniff. Der deutsche Artikel verlinkt in seinem Text auf andere deutsche
Seiten — meist zehn oder mehr. Das Tool ruft bis zu **20** davon auf, immer mit **einer
Sekunde Abstand**, damit die Seite nicht belastet wird, und liest bei jeder nach, unter
welcher Adresse es sie im Zielland gibt. Aufgerufen werden auch Produkt- und
Kategorieseiten, denn auch die können passen. Daraus entstehen drei Dinge:

1. Eine Liste **belegter** Zieladressen — Seiten, von denen wir sicher wissen, dass es
   sie gibt. Sie wandern in den Link-Vorrat.
2. Eine **zweite Ebene an Kandidaten.** Aus den aufgerufenen Magazinseiten (nicht aus
   Produkt- oder Kategorieseiten) werden alle weiterführenden Magazin-Links mit Linktext
   und Adresse gesammelt. Diese Seiten werden **nicht** aufgerufen; im Vorrat steht bei
   ihnen ausdrücklich „nicht abgerufen". Sie dürfen so noch nicht verwendet werden —
   später kann anhand von Linktext und Adresse entschieden werden, welche davon
   nachgeladen und auf eine Entsprechung im Zielland geprüft werden.
3. Eine **automatisch gelernte Übersetzungstabelle für Adressbestandteile.** Wenn
   `…/magazin/hund/gesundheit/xyz/` in Irland `…/magazine/dog/health/xyz/` heißt, dann
   weiß das Tool ab sofort: `gesundheit` heißt hier `health`. Vorher musste man das von
   Hand pflegen — und ein fehlender Eintrag hat den ganzen Job abgebrochen. Diese Lücken
   schließen sich jetzt von selbst. (Von Hand gepflegte Einträge haben weiterhin Vorrang.)

**Stufe 3 — Adresse selbst zusammenbauen.**
Erst wenn keine der vorherigen Stufen greift, baut das Tool die Zieladresse aus dem
deutschen Pfad zusammen: jedes Adressstück wird übersetzt (gepflegte Tabelle plus die
in Stufe 2b gelernten Paare), hinten kommen die Namensvorschläge aus S2.

**Und dann wird geprüft.** Jede Kandidatenadresse wird tatsächlich aufgerufen: Antwortet
sie mit „OK"? Weist sie sich selbst als diese Adresse aus? Ist es keine getarnte
Fehlerseite (eine Seite, die „nicht gefunden" anzeigt, aber technisch „OK" meldet)?
Der erste saubere Treffer gewinnt und wird komplett heruntergeladen. Alle Nachweise
werden mitprotokolliert.

**Was rauskommt:** Einer von drei Zuständen:

- **EXISTS** — Die Seite gibt es, hier ist die Adresse.
- **VERIFIED_404** — Wir haben nachweislich geprüft: Die Seite gibt es nicht.
- **NOT_IN_INDEX** — Wir konnten es nicht feststellen. Das heißt ausdrücklich **nicht**
  „gibt es nicht" — es heißt „unbekannt".

**KI beteiligt:** nein. Diese Station argumentiert ausschließlich mit Beweisen.

---

## S4 · Was fehlt der bestehenden Seite?

**Was reinkommt:** Die Gliederung und Wortzahl des deutschen Artikels und — falls es die
Zielseite gibt — deren Gliederung, Wortzahl und ein Textauszug.

**Was passiert:** Die KI vergleicht beide und benennt inhaltliche Lücken, Dopplungen und
veraltete Stellen.

**Was rauskommt:** Eine Liste der Unterschiede.

**Sonderfall:** Existiert im Zielland noch keine Seite, wird diese Station übersprungen
und vermerkt: „Neuanlage". Es gibt dann nichts zu vergleichen.

**KI beteiligt:** ja.

---

## S7a · Den Link-Vorrat aufbauen

Damit die KI später sinnvoll intern verlinken kann, braucht sie eine Auswahl echter
Seiten aus dem Zielland. Früher wurde dafür die komplette Website erfasst — bei rund
einer Million Adressen ist das nicht machbar. Stattdessen holt das Tool **gezielt wenige,
dafür hochrelevante Seiten**.

**Was passiert, der Reihe nach:**

1. **Die Ernte aus S3 wird übernommen.** Die dort belegten Zieladressen (aus den
   Nachbarartikeln) kommen direkt und ganz vorn in den Vorrat. Sie sind thematisch
   garantiert passend, weil sie im Original-Artikel verlinkt waren.
2. **Übersichtsseiten finden.** Aus dem deutschen Pfad wird der übergeordnete Bereich im
   Zielland abgeleitet — aus `/magazin/hund/rassen/mastiff/` wird `/magazyn/pies/rasy/`,
   ersatzweise `/magazyn/pies/`. Das sind Seiten, die viele verwandte Artikel auflisten.
3. **Mit höchstens acht Abrufen** werden geladen: die erste erreichbare Übersichtsseite,
   die Navigation und bis zu drei „Geschwisterartikel" (Artikel aus demselben Bereich).
   Die Begrenzung ist bewusst — sie hält den Job schnell und schont die Zielseite.
4. **Alle darin gefundenen internen Links** werden eingesammelt und danach sortiert,
   woher sie stammen (Übersichtsseite, Navigation, Fließtext, Fußzeile).

Der Vorrat wird gespeichert und eine Woche lang wiederverwendet, damit nicht jeder Job
dieselben Seiten erneut abruft. Die Geschwisterartikel dienen zusätzlich als
Stilvorlage in S5.

**Was rauskommt:** Der Link-Vorrat, die Geschwisterartikel und ein Protokoll, welche
Seiten abgerufen wurden.

**KI beteiligt:** nein.

---

## S5 · Den Schreibstil des Ziellandes lernen

**Was reinkommt:** Zuerst wird nachgesehen, ob für diesen Markt schon ein Stilprofil
gespeichert ist. Falls nicht: die Geschwisterartikel aus S7a.

**Was passiert:** Die KI liest die Beispieltexte und beschreibt, wie dort geschrieben
wird: Tonfall, Satzlänge, Anrede (gesiezt oder geduzt), typische Textbausteine. Das
Ergebnis wird gespeichert, damit die nächsten Jobs im selben Markt es sofort nutzen können.

**Was rauskommt:** Das Stilprofil.

**Wenn es klemmt:** Ohne Geschwisterartikel geht es nicht — dann muss S7a noch einmal laufen.

**KI beteiligt:** ja (außer bei einem Treffer im Speicher).

---

## S6 · Den Bauplan erstellen

**Was reinkommt:** Die Gliederung des deutschen Artikels (je Abschnitt Überschrift und
ein Textanfang) plus das Marktprofil: Land, Sprache, Marke, wichtige Institutionen,
verbotene Aussagen, Anredeform.

**Was passiert:** Die KI entscheidet für **jeden** Abschnitt eine von vier Aktionen:

- **übersetzen** — inhaltlich gleich lassen
- **lokalisieren** — inhaltlich anpassen (andere Behörde, andere Rechtslage, andere
  Gewohnheiten)
- **umschreiben** — neu aufsetzen
- **streichen** — im Zielland nicht sinnvoll, entfällt

Dazu notiert sie Hinweise für die Umsetzung und schlägt vor, an welchen Stellen ein
interner Link sinnvoll wäre — mit dem gewünschten Linktext und der Absicht dahinter
(aber ausdrücklich **ohne** Adresse; die kommt später aus dem Vorrat).

**Was rauskommt:** Der Bauplan mit einem Eintrag je Abschnitt.

**KI beteiligt:** ja.

---

## S7 · Linkvorschläge sammeln

**Was reinkommt:** Alle gewünschten Linktexte aus dem Bauplan und der Link-Vorrat aus S7a.

**Was passiert, in zwei Stufen:**

- **Stufe 1 — Suche im Vorrat.** Für jeden gewünschten Linktext werden die passendsten
  Seiten aus dem Vorrat herausgesucht. Bewertet werden die Übereinstimmung von Wörtern
  im Linktext, in der Adresse und im Navigationspfad sowie die Ähnlichkeit der
  Schreibweise (damit auch knappe Abweichungen noch treffen). Höchstens acht Vorschläge
  je Linktext.
- **Stufe 2 — nur für Linktexte ohne Treffer.** Dann wird die interne Suche der
  Zielwebsite befragt — **maximal zehn Suchanfragen pro Job**. Neue Funde wandern in den
  Vorrat. Jede Suche wird protokolliert.

**Was rauskommt:** Je Linktext eine nummerierte Vorschlagsliste.

**KI beteiligt:** nein. Vorschläge stammen ausschließlich aus dem Vorrat oder aus der
Suche der echten Website.

---

## S8 · Die KI wählt aus — aber nur eine Nummer

**Was reinkommt:** Je Linktext die Vorschlagsliste — **nummeriert und ohne Adressen**.
Die KI sieht bewusst nur Titel und Thema, nie die Adresse selbst.

**Was passiert:** Die KI antwortet mit einer Nummer oder mit „keiner passt". Das
Programm prüft, ob die Nummer überhaupt in der Liste vorkommt, und schlägt erst dann
die zugehörige Adresse nach.

**Was rauskommt:** Je Linktext eine Adresse oder ausdrücklich „kein Link".

**Warum so umständlich?** Weil eine KI, die Adressen ausgeben darf, welche erfindet.
Über den Umweg der Nummer ist das technisch ausgeschlossen. Ungültige Nummer oder kein
Vorschlag bedeutet schlicht: kein Link.

**KI beteiligt:** ja — aber nur zur Auswahl.

---

## S9 · Jeden Link anklicken

**Was reinkommt:** Die Auswahl aus S8.

**Was passiert:** Frühere Prüfergebnisse dieses Jobs werden gelöscht (damit eine
Wiederholung sauber startet). Dann wird jede ausgewählte Adresse tatsächlich aufgerufen
und dreifach geprüft: Antwortet sie mit „OK"? Weist sie sich selbst als diese Adresse
aus? Ist es keine getarnte Fehlerseite? Nur bestandene Links werden gespeichert.

**Was rauskommt:** Die Liste der geprüften Links. Durchgefallene Kandidaten werden aus
dem Vorrat entfernt (damit sie nicht wieder vorgeschlagen werden) und als „fehlerhafte
Links" protokolliert.

**KI beteiligt:** nein.

---

## S10 · Tabellen ins Zielland übertragen

**Was reinkommt:** Die Tabellen aus dem deutschen Artikel sowie Sprache, Land und die
relevanten Institutionen des Zielmarkts.

**Was passiert:** Jede Tabelle wird einzeln von der KI bearbeitet: übersetzen, Einheiten
umstellen, Normen und Institutionen durch die im Zielland gültigen ersetzen. Der Aufbau
der Tabelle — Spalten und Zeilenzahl — bleibt unverändert.

**Was rauskommt:** Die überarbeiteten Tabellen. Hat der Artikel keine Tabellen, ist das
Ergebnis leer und die Station trotzdem erfolgreich.

**Wenn es klemmt:** Kommt eine Tabelle unverändert zurück, obwohl die Zielsprache nicht
Deutsch ist, gilt das als Fehler („Tabelle wurde nicht lokalisiert") und die Station
versucht es erneut (bis zu zweimal). Auch eine veränderte Zeilenzahl ist ein Fehler.

**KI beteiligt:** ja, ein Aufruf je Tabelle.

---

## S11 · Den Text schreiben

Die eigentliche Textproduktion — und sie läuft **abschnittsweise**, nicht in einem
Rutsch. Das ergibt bessere Qualität und macht Fehler leichter auffindbar.

**Was reinkommt, je Abschnitt:**

- der vollständige deutsche Abschnittstext (ungekürzt),
- die geplante Aktion aus S6 und die zugehörigen Hinweise,
- die vorgesehene Überschrift in der Zielsprache,
- das Stilprofil aus S5,
- Marke, Sprache, Sprachvariante und Anredeform des Marktes,
- die bereits geschriebenen Überschriften — damit sich nichts wiederholt,
- die geprüften Links aus S9,
- die passende Tabelle, falls dieser Abschnitt eine hat.

**Was passiert:** Die KI schreibt den Abschnitt. Abschnitte mit der Aktion „streichen"
werden übersprungen. Es dürfen ausschließlich die übergebenen, geprüften Links
verwendet werden — keine anderen.

**Was rauskommt:** Der fertige Text, Abschnitt für Abschnitt.

**Wenn es klemmt:** Lässt sich ein Bauplan-Abschnitt keinem deutschen Abschnitt
zuordnen, bricht die Station bewusst ab statt heimlich mit leerem Text zu arbeiten —
dann muss S6 wiederholt werden.

**KI beteiligt:** ja.

---

## S12 · Qualitätskontrolle

**Was reinkommt:** Der gesamte Text aus S11, dazu Marke, verbotene Aussagen und Sprache
des Marktes.

**Was passiert:** Die KI prüft systematisch: Stimmt die Sprache und die regionale
Variante? Wird die richtige Marke genannt? Kommen verbotene Aussagen vor
(z. B. gesundheitsbezogene Versprechen)? Ist die Anrede durchgehend gleich? Gibt es
Dopplungen? Passen die Links inhaltlich zum Umfeld?

**Was rauskommt:** Eine Befundliste mit Schweregrad.

**Wenn es klemmt:** Ohne Text keine Prüfung — dann muss erst S11 laufen.

**KI beteiligt:** ja.

---

## S13 · Die fertige Datei

**Was reinkommt:** Adressname und Überschrift, die deutsche Quelladresse, der Zielstatus
samt Nachweisen aus S3, die Textabschnitte, die geprüften Links, Angaben zum Link-Vorrat
und der Marktabschluss (ein fester Textbaustein je Markt).

**Was passiert:** Alles wird zu einem Dokument zusammengesetzt: Kopfdaten, Textabschnitte,
Linkliste mit Prüfergebnis und — wichtig für die Redaktion — ein **Lückenbericht**: Für
welche gewünschten Linktexte konnte kein geprüfter Link gefunden werden? Welche
Kandidaten sind durchgefallen? Wurde die Website-Suche bemüht?

**Was rauskommt:** Das fertige Markdown-Dokument. Der Job gilt danach als abgeschlossen.

**KI beteiligt:** nein.

---

# Wie man die Pipeline bedient

Es gibt drei Möglichkeiten, Stationen zu starten:

- **Einzeln** — „Ausführen" bzw. „Erneut" bei einer Station. Für gezielte Korrekturen.
- **Ab hier** — startet bei dieser Station und läuft bis zum Ende oder bis zum ersten
  Fehler.
- **Komplett** — alles von S1 bis S13 am Stück.

Wiederholen ist immer ungefährlich: Eine Station überschreibt nur ihr eigenes Ergebnis,
alles andere bleibt bestehen. Nachfolgende Stationen arbeiten dann automatisch mit dem
neuen Stand.

# Was die Statusangaben bedeuten

| Status | Bedeutung |
| --- | --- |
| **offen** | Noch nicht gelaufen. |
| **läuft** | Gerade in Arbeit. |
| **erledigt** | Sauber durchgelaufen. |
| **Fehler** | Abgebrochen. Die Fehlermeldung steht im Klartext an der Station und im Report. |
| **blockiert** | Es fehlt eine Voraussetzung aus einer früheren Station. Kein Fehler im eigentlichen Sinn — erst die vorgelagerte Station nachholen. |

Der Job insgesamt gilt nur dann als **fertig**, wenn keine einzige Station auf „Fehler"
oder „blockiert" steht. Sonst lautet der Jobstatus **„fertig mit Fehlern"** — die Datei
existiert, ist aber unvollständig und braucht eine redaktionelle Nachkontrolle.

# Wie die KI beauftragt wird

Die Anweisungen an die KI sind keine fest verdrahteten Programmzeilen, sondern
bearbeitbare Vorlagen im Admin-Bereich. Vor dem Absenden werden Platzhalter durch die
echten Daten ersetzt (etwa den deutschen Abschnittstext). Genau dieser fertige Auftrag
wird an der Station gespeichert und lässt sich im Report nachlesen.

Antwortet die KI unbrauchbar, versucht das Tool es bis zu dreimal erneut. Ist das
Nutzungslimit erreicht oder das Guthaben aufgebraucht, wird das als eigene, klar
benannte Meldung ausgegeben — nicht als allgemeiner Fehler.

# Feste Regeln, auf die man sich verlassen kann

- Die KI erzeugt **niemals** Adressen. In S8 wählt sie nur Nummern.
- Jede ausgelieferte Adresse wurde aufgerufen, antwortete mit „OK", wies sich korrekt
  aus und war keine getarnte Fehlerseite.
- „nachweislich nicht vorhanden" und „unbekannt" werden nie vermischt.
- Kein Abschnitt geht verloren: Jeder Bauplan-Abschnitt muss einem deutschen Abschnitt
  zugeordnet sein, sonst bricht die Station ab.
- Nur vier Aktionen sind erlaubt: übersetzen, lokalisieren, umschreiben, streichen.
- Für die Anzeige werden Daten gekürzt — für die KI niemals.
- Fehlende Übersetzungen von Adressbestandteilen blockieren den Job nicht mehr; sie
  werden in S3 automatisch aus den Nachbarartikeln gelernt.

---

# Für Entwickler: Wo liegt was?

Ablaufsteuerung `src/lib/pipeline/engine.server.ts` · Seitenabruf und Verifikation
`extract.server.ts` · KI-Aufrufe `ai.server.ts` · hreflang-Ernte `hreflang.server.ts` ·
Link-Vorrat und Lückenbericht `pool.ts` und `hub.server.ts`. Reine, testbare Logik:
`schemas.ts` (Prüfung der KI-Antworten), `paths.ts` (Adressübersetzung),
`tables.ts`, `plan.ts` (Bauplan → Schreibauftrag), `deps.ts` (Voraussetzungsprüfung).
Regressionstests: `tests/pipeline-regression.test.ts` (`bun test`).
