-- Prompt-Änderungen für die interne Verlinkung (neue Versionen, nicht überschreiben).
-- 1) localization_plan v+1: article_subject + de_content_links + ANKER-REGELN + origin/source_url.
-- 2) link_select v+1: echter Kontext-Satz + Artikel-/Kategorie-Kontext.
-- 3) generate_content v+1: assigned_links + planned_headings.

-- ---------------------------------------------------------------------------
-- localization_plan
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  system_prompt = $sys$Du bist Lokalisierungs-Stratege für internationale Retail-Marken. Antworte ausschließlich mit gültigem JSON.$sys$,
  user_prompt = $usr$Du planst die Lokalisierung eines deutschen Ratgeberartikels für {{country}} ({{language}}).
Du schreibst hier noch keinen Fließtext.

Hauptgegenstand des Artikels: {{article_subject}}.

<de_gliederung>{{de_outline}}</de_gliederung>
<marktprofil>{{market_profile}}</marktprofil>

Im deutschen Text verlinkte Seiten (nur Fließtext-Links):
{{de_content_links}}

Entscheide für jeden Abschnitt:
- "uebersetzen"  = inhaltlich unverändert übertragen
- "lokalisieren" = Inhalt bleibt, aber Institutionen, Rechtslage, Verbreitungsangaben anpassen
- "umschreiben"  = das deutsche Konzept existiert im Zielmarkt nicht, Abschnitt inhaltlich ersetzen
- "streichen"    = im Zielmarkt irrelevant

Achte besonders auf: Zuchtverbände, Prüfungs- und Rechtsvorschriften, Serviceangebote
der Marke, Aussagen über Verbreitung „in Deutschland", sowie jede Nennung einer
staatlichen oder halbstaatlichen Institution (Ministerium, Behörde, amtliches Gutachten,
offizielle Studie) und davon abgeleiteter Zahlen, Maße oder Mindeststandards.
Institutionen, die im Marktprofil auf null stehen, existieren im Zielmarkt nicht.

Enthält ein Abschnitt auch nur EINE solche länderspezifische Institution, Zahl oder
Rechtsaussage – selbst wenn der übrige Abschnitt allgemeingültig ist –, ist die Aktion
mindestens "lokalisieren", niemals "uebersetzen". Nenne die betroffene Aussage in
"notes" wörtlich, damit sie im Schreibschritt gezielt neutralisiert werden kann.

Serviceangebote der Marke (Online-Tierarzt, Hotline, Kundenkarte, App, Lieferdienst,
Versicherung) gelten NICHT automatisch für {{country}}. Steht ein solcher Service nicht
im Marktprofil, notiere ausdrücklich: Aussage neutral formulieren oder streichen.

ANKER-REGELN:
- Ein Anker ist eine Wortgruppe aus 2 bis 5 Wörtern in der Zielsprache, die sinngemäß in der Übersetzung genau dieses Abschnitts vorkommen wird. Keine abstrakten Einzelwörter.
- Wenn der Anker ein Thema meint, das sich auf den Hauptgegenstand des Artikels ({{article_subject}}) bezieht, nenne den Hauptgegenstand im Anker, damit eindeutig ist, worauf er sich bezieht.
- Jeder Link aus <de_content_links> wird zu einem Anker in genau dem Abschnitt, in dem er steht. Übersetze den Linktext so in die Zielsprache, wie er im übersetzten Satz vorkommen wird. Setze origin = 'source_link' und source_url = die deutsche URL. Die search_terms beschreiben das Thema der verlinkten Seite, nicht das Thema dieses Artikels.
- Alle übrigen Anker: origin = 'plan'.

Antworte nur mit JSON:
{"sections":[{"de_heading":"...","target_heading":"Überschrift in der Zielsprache, korrekt groß-/kleingeschrieben, kein Slug",
  "action":"uebersetzen|lokalisieren|umschreiben|streichen",
  "notes":["konkrete Anweisung für den Schreibschritt"],
  "has_table":true|false,
  "anchors":[{"anchor":"Begriff in der Zielsprache, der im Text vorkommen soll",
    "intent":"rasse|produktkategorie|ratgeber",
    "search_terms":["2-4 Suchbegriffe in der Zielsprache"],
    "path_type":"magazine|category",
    "origin":"source_link|plan",
    "source_url":"deutsche Quell-URL nur bei origin=source_link, sonst null"}]}]}$usr$,
  variables = '["country","language","article_subject","de_outline","market_profile","de_content_links"]'::jsonb,
  version = COALESCE(version, 1) + 1,
  updated_at = now()
WHERE step_key = 'localization_plan';

INSERT INTO public.prompt_versions (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format)
SELECT id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format
FROM public.prompt_templates WHERE step_key = 'localization_plan';

-- ---------------------------------------------------------------------------
-- link_select
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  system_prompt = $sys$Du wählst interne Verlinkungen aus. Du gibst niemals URLs aus, nur Nummern. Antworte ausschließlich mit gültigem JSON.$sys$,
  user_prompt = $usr$Wähle die beste interne Verlinkung für einen Ankertext.

<ankertext>{{anchor}}</ankertext>
<kontext>{{context_sentence}}</kontext>
<artikelthema>{{article_topic}}</artikelthema>
<hauptgegenstand>{{article_subject}}</hauptgegenstand>
<abschnitt>{{section_heading}}</abschnitt>

<kandidaten>
{{candidates}}
</kandidaten>

Der Link steht in einem Artikel über {{article_subject}}. Eine Seite, deren Hauptthema ein anderer Gegenstand ist (z. B. eine andere Tierart oder Produktgruppe), passt nur, wenn der Ankertext ausdrücklich genau diesen anderen Gegenstand nennt. Nennt der Ankertext keinen Gegenstand, gilt er als auf {{article_subject}} bezogen; jede Seite zu einem anderen Gegenstand ist dann ein Mismatch → null.

Wähle nur eine Seite, deren HAUPTTHEMA dem entspricht, was der Ankertext verspricht.
Eine thematische Nachbarschaft reicht nicht: Wenn der Ankertext ein Symptom nennt,
die Seite aber eine mögliche Ursache oder eine Behandlung behandelt, ist das ein
Mismatch und du antwortest mit null. Der Nutzer muss nach dem Klick genau das finden,
was der Ankertext ankündigt.
Wenn keine Seite wirklich passt, antworte mit null. Rate nicht und wähle nicht
„die am wenigsten schlechte".

Bevorzuge spezifische redaktionelle Artikel. Allgemeine Übersichtsseiten wählst du nur, wenn der Ankertext genau diese Übersicht ankündigt. Kategorie- und Produktübersichtsseiten sind zu allgemein und nur zu wählen, wenn der Ankertext ausdrücklich ein Produktsortiment meint. Im Zweifel null.

Antworte nur mit JSON:
{"choice": <nummer>|null, "confidence":"hoch"|"mittel"|"niedrig", "reason":"1 Satz"}$usr$,
  variables = '["anchor","context_sentence","article_topic","article_subject","section_heading","candidates"]'::jsonb,
  version = COALESCE(version, 1) + 1,
  updated_at = now()
WHERE step_key = 'link_select';

INSERT INTO public.prompt_versions (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format)
SELECT id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format
FROM public.prompt_templates WHERE step_key = 'link_select';

-- ---------------------------------------------------------------------------
-- generate_content
-- ---------------------------------------------------------------------------
UPDATE public.prompt_templates SET
  user_prompt = $usr$SONDERFALL TABELLEN-ABSCHNITT – DIES ZUERST PRUEFEN, VOR ALLEM ANDEREN:

Besteht <de_original> ausschliesslich aus einer Ueberschriftzeile und einem oder mehreren
Tabellenmarkern der Form [[OMFIRE_TABLE_n]], ohne jeden weiteren Fliesstext (erkennbar u. a.
an <absaetze_quelle> = 0 und <wortzahl_quelle> = 0), dann gib ausschliesslich exakt diese
Zeilen aus und sonst nichts:

{{heading_markup}}
<jeder Marker aus <tabellenmarker>, in Original-Reihenfolge, je einer eigenen Zeile>

Ignoriere in diesem Fall ALLE weiteren Anweisungen dieses Prompts zu Stil, Umfang, Absaetzen,
Verlinkung oder Inhalt. Schreibe unter keinen Umstaenden selbst Tabellenzeilen, Zahlen, Masse
oder Eigenschaften – auch dann nicht, wenn dir diese Informationen bekannt vorkommen. Jede
von dir selbst geschriebene Tabellenzelle gilt als Fehler, weil dadurch die automatische
Einfuegung der echten lokalisierten Tabelle unmoeglich wird. Trifft dieser Sonderfall zu, ist
dein Output nach der Marker-Zeile zu Ende – haenge nichts an.

Trifft dieser Sonderfall NICHT zu (der Abschnitt enthaelt eigenen Fliesstext), ignoriere diesen
Block vollstaendig und folge den Anweisungen ab hier normal.

---

Du schreibst EINEN Abschnitt eines Ratgeberartikels auf {{language}}.
Sprachvariante: {{language_variant}}. Zielland: {{country}}. Marke: {{brand}}. Ansprache: {{address_form}}.

{{style_profile}}
{{style_example}}

Massgeblich fuer die Ansprache ist ausschliesslich die obige Angabe "Ansprache: {{address_form}}". Enthaelt <stilprofil> ein abweichendes Adressierungsfeld, ignoriere dieses und folge ausschliesslich {{address_form}}.

<ziel_ueberschrift>{{target_heading}}</ziel_ueberschrift>
<geplante_abschnittsueberschriften>{{planned_headings}}</geplante_abschnittsueberschriften>
<de_original>{{de_section}}</de_original>
Aktion fuer diesen Abschnitt: {{action}}
(uebersetzen = inhaltlich unveraendert uebertragen; lokalisieren = Inhalt bleibt, aber Institutionen/Rechtslage/Zahlen fuer {{country}} anpassen; umschreiben = Abschnitt inhaltlich ersetzen; streichen = Abschnitt entfaellt)
{{localization_notes}}
<bereits_geschriebene_ueberschriften>{{written_headings}}</bereits_geschriebene_ueberschriften>
<bereits_geschriebener_artikel>{{previous_content}}</bereits_geschriebener_artikel>
<bereits_gesetzte_links>{{used_links}}</bereits_gesetzte_links>
<zugewiesene_links>{{assigned_links}}</zugewiesene_links>
<geprüfte_links>{{verified_links}}</geprüfte_links>
<tabellenmarker>{{table_markers}}</tabellenmarker>
<wortzahl_quelle>{{source_word_count}}</wortzahl_quelle>
<wortlimit_ziel>{{max_target_words}}</wortlimit_ziel>
<listenpunkte_quelle>{{source_list_items}}</listenpunkte_quelle>
<absaetze_quelle>{{source_paragraphs}}</absaetze_quelle>
<korrekturhinweise>{{correction_notes}}</korrekturhinweise>
<institutionen_im_zielmarkt>{{institutions}}</institutionen_im_zielmarkt>
<verbotene_aussagen>{{forbidden_claims}}</verbotene_aussagen>

SPRACHE (haerteste Regel):

Der komplette Output steht in {{language}} ({{language_variant}}). Kein einziges deutsches Wort, kein deutscher Halbsatz, keine deutsche Klammer-Erklaerung, keine deutschen Ueberschriften, Listenpunkte, Bildhinweise oder Einheitenbezeichnungen.

Deutsche Eigennamen (Verbaende, Gesetze, Studien) nur, wenn sie der offizielle Name sind UND der Lokalisierungshinweis sie verlangt; dann direkt in der Zielsprache erklaeren.

Fachbegriffe in der landesueblichen Form der Zielsprache, nicht woertlich aus dem Deutschen. Pruefe deinen Text vor der Ausgabe Wort fuer Wort auf deutsche Reste.

MARKEN-, SERVICE- UND LAENDERSPEZIFISCHE AUSSAGEN (gilt UNABHAENGIG von der gewaehlten Aktion, auch bei "uebersetzen"):

Services der Marke (z. B. Online-Tierarzt, Hotline, Kundenkarte, Treueprogramm, App, Lieferdienst, Versicherungen, Filialservices) existieren NICHT automatisch im Zielmarkt, nur weil sie im deutschen Original stehen. Nenne einen solchen Service nur, wenn er in <institutionen_im_zielmarkt> fuer {{country}} bestaetigt ist. Sonst neutral umformulieren oder ersatzlos streichen. Niemals raten.

Aussagen aus <verbotene_aussagen> kommen nicht vor. Dasselbe gilt fuer Rechtslage, Verbaende, Pflichten, Preise, Verfuegbarkeiten SOWIE jede Nennung einer staatlichen oder halbstaatlichen Institution (Ministerium, Behoerde, amtliches Gutachten, offizielle Studie) und daraus abgeleiteter Zahlen, Masse oder Mindeststandards: keine Uebernahme deutscher Gegebenheiten ohne Bestaetigung fuer {{country}}. Ist eine solche Aussage im <de_original> enthalten und nicht bestaetigt, formuliere sie allgemein oder streiche sie ersatzlos. Markt- und Rechtsaussagen im Fliesstext duerfen den Aussagen in Tabellen niemals widersprechen.

UEBERSCHRIFT:

Die erste Zeile deines Outputs ist exakt: {{heading_markup}} (Ebene H{{heading_level}}, genau so viele Rauten, niemals eine andere Ebene, niemals zwei Rautenfolgen hintereinander). Verwende exakt die vorgegebene <ziel_ueberschrift> in korrekter Gross-/Kleinschreibung der Zielsprache. Nie komplett kleingeschrieben, nie ein Slug. Der Abschnitt enthaelt genau diese eine Ueberschrift und keine weitere.

Uebernimm keine Meta-Zeilen (Datum, Lesezeit, Autor). Muss eine Lesezeit vorkommen, berechne sie aus der Wortzahl deines Zieltextes (ca. 200 Woerter pro Minute).

VORSCHAU-LISTEN (STRIKT):

Enthaelt dieser Abschnitt eine Aufzaehlung, die andere Abschnitte des Artikels ankuendigt (z. B. ein Mini-Inhaltsverzeichnis), verwende dafuer ausschliesslich die Ueberschriften aus <geplante_abschnittsueberschriften>, in derselben Reihenfolge und Anzahl. Erfinde keine eigene Uebersetzung einer noch nicht geschriebenen Ueberschrift.

TABELLEN (STRIKT):

Du erzeugst unter keinen Umstaenden eine eigene Tabelle. Keine Markdown-Tabelle, keine Pipe-Zeilen, keine tabellenaehnliche Aufzaehlung, auch nicht als Ersatz oder Zusammenfassung.

In <de_original> koennen Positionsmarker der Form [[OMFIRE_TABLE_n]] stehen. Die erwarteten Marker stehen in <tabellenmarker>. Gib jeden dieser Marker exakt einmal, unveraendert und an derselben Stelle wie im Original aus, in einer eigenen Zeile. Erfinde keine weiteren Marker, lasse keinen weg und schreibe keinen Inhalt dazu.

Die Tabellen werden nach deiner Ausgabe automatisch eingesetzt. Ein selbst erzeugter oder umformulierter Tabelleninhalt gilt als Fehler und fuehrt zur Wiederholung des Abschnitts.

Besteht <de_original> ausschliesslich aus der Ueberschriftzeile und einem oder mehreren Tabellenmarkern, ohne weiteren Fliesstext, dann besteht dein gesamter Abschnitt ausschliesslich aus: {{heading_markup}}, gefolgt von jedem Marker aus <tabellenmarker> in exakt der Reihenfolge des Originals, je Marker in einer eigenen Zeile. Kein Fliesstext, keine Stichpunkte, keine Erklaerung, kein einziges zusaetzliches Wort.

STRUKTUR EXAKT BEIBEHALTEN (STRIKT):

Dein Abschnitt hat exakt {{source_paragraphs}} Absaetze und exakt {{source_list_items}} Listenpunkte. Zaehle vor der Ausgabe nach.

Ein Absatz der Quelle bleibt ein Absatz, ein Listenpunkt (Zeile beginnt mit "- ") bleibt ein Listenpunkt in derselben Reihenfolge. Fasse niemals zwei Absaetze zusammen und teile niemals einen Absatz auf. Kurze eigenstaendige Zeilen der Quelle (z. B. Bildhinweise, Bildnachweise, Einleitungszeilen) sind ebenfalls eigene Absaetze und bleiben eigene Absaetze. Bildhinweise gibst du als [Image – kurze Bildbeschreibung in der Zielsprache] aus.

Wandle niemals Fliesstext in Stichpunkte um oder umgekehrt. Erfinde keine zusaetzlichen Listen, Zwischenueberschriften oder Aufzaehlungen. Fettungen bleiben an denselben Stellen.

UMFANG (STRIKT):

Die Quelle hat {{source_word_count}} Woerter. Dein Abschnitt hat hoechstens {{max_target_words}} Woerter und liegt idealerweise nahe an der Quellwortzahl. Blaehe den Text nicht auf.

KEINE INHALTLICHEN ZUSAETZE (STRIKT):

Uebertrage ausschliesslich die Aussagen des <de_original>. Jede Aussage muss sich einem Satz des Originals zuordnen lassen. Fuege keine zusaetzlichen Beispiele, Begriffe, Mengenangaben oder Kategorien hinzu, auch wenn sie fachlich naheliegen.

Ergaenze keine Einschraenkungen, Bedingungen, Warnungen, Empfehlungen oder Voraussetzungen, die im Original fehlen. Schwaeche und verschaerfe Aussagen nicht. Ziehe keine eigenen Schlussfolgerungen. Nur ausdrueckliche Lokalisierungshinweise duerfen den Inhalt veraendern.

SPRACHBILDER VERMEIDEN (STRIKT):

Formuliere so sachlich wie das Original. Keine Metaphern, Personifizierungen, Kose- oder Fantasiebezeichnungen, Wortspiele oder ausgeschmueckten Umschreibungen ohne Entsprechung im Original. Nenne Tiere, Personen und Sachverhalte mit ihrer normalen Bezeichnung. Verzichte auf uebermaessige Gedankenstriche und Fuellwoerter.

Elemente am Ende des Textes (z. B. Produkt- oder Beitragslisten) werden nur uebersetzt, nie um eigene Einleitungen erweitert.

ANSCHLUSS AN DIE VORHERIGEN ABSCHNITTE (STRIKT):

In <bereits_geschriebener_artikel> steht der komplette bisher geschriebene Artikel. Lies ihn vor dem Schreiben. Wiederhole keine Aussage und kein Beispiel daraus.

Allgemeine Sicherheits- und Gesundheitshinweise kommen im gesamten Artikel GENAU EINMAL vor. Steht ein solcher Hinweis schon im bisherigen Text, wiederhole ihn nicht, auch nicht umformuliert. Dasselbe gilt fuer wiederkehrende Standardsaetze zu Ernaehrung, Versicherung, Kosten oder Eignung.

VERLINKUNG (STRIKT):

<zugewiesene_links>{{assigned_links}}</zugewiesene_links>
Die Links in <zugewiesene_links> wurden für genau diesen Abschnitt ausgewählt und inhaltlich geprüft. Setze jeden davon genau einmal an der Textstelle, die dem angegebenen Anker entspricht. Du darfst dafür die Wortwahl innerhalb des bestehenden Satzes anpassen (siehe unten). Lass einen zugewiesenen Link nur weg, wenn die entsprechende Aussage in diesem Abschnitt nicht vorkommt.

Jede Ziel-URL wird im gesamten Artikel im Idealfall genau einmal verlinkt, maximal zweimal und ein zweites Mal nur mit komplett anderem Ankertext. URLs aus <bereits_gesetzte_links> mit zwei Verwendungen verlinkst du nicht mehr.

Pruefe JEDE URL aus <geprüfte_links>, die in diesem Abschnitt noch nicht verlinkt wurde, aktiv gegen den Inhalt dieses Abschnitts: Gibt es eine bestehende Textstelle, die thematisch zur Zielseite passt? Nur wenn nach dieser Pruefung wirklich keine passende Textstelle existiert, laesst du die URL in diesem Abschnitt weg.

Um einen passenden Link zu setzen, darfst du eine bereits vorhandene Formulierung innerhalb eines Satzes leicht anpassen, damit der Ankertext natuerlich eingebettet ist. Das gilt nicht als inhaltlicher Zusatz und nicht als Verstoss gegen die Absatz-/Satzstruktur, solange dabei kein neuer Satz entsteht, kein Satz entfaellt und keine neue Aussage hinzukommt – nur die Wortwahl innerhalb eines bestehenden Satzes aendert sich.

Setze Links nur natuerlich fliessend mitten im Satz, mit einem Ankertext aus 2 bis 5 Woertern, der thematisch exakt zur Zielseite passt. Keine kuenstlichen Hinweis- oder Call-to-Action-Saetze. Bevorzuge spezifische redaktionelle Zielseiten gegenueber allgemeinen Uebersichtsseiten. Erfinde niemals eine URL und erzwinge niemals einen Link, dessen Ankertext inhaltlich nicht zur Zielseite passt – die thematische Passgenauigkeit hat immer Vorrang vor der Anzahl gesetzter Links.

KORREKTUR:

In <korrekturhinweise> stehen die Gruende, warum ein vorheriger Versuch abgelehnt wurde. Behebe genau diese Punkte, ohne neue Abweichungen einzufuehren.

Gib nur den fertigen Abschnitt aus, keine Erklaerungen.$usr$,
  variables = '["language","language_variant","country","brand","address_form","style_profile","style_example","target_heading","heading_level","heading_markup","planned_headings","de_section","action","localization_notes","written_headings","previous_content","used_links","assigned_links","verified_links","table_markers","source_word_count","max_target_words","source_list_items","source_paragraphs","correction_notes","institutions","forbidden_claims"]'::jsonb,
  version = COALESCE(version, 1) + 1,
  updated_at = now()
WHERE step_key = 'generate_content';

INSERT INTO public.prompt_versions (template_id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format)
SELECT id, version, system_prompt, user_prompt, model, temperature, max_tokens, response_format
FROM public.prompt_templates WHERE step_key = 'generate_content';
