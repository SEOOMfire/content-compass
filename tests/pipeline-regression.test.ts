/**
 * Regressionstest zum Referenzfall
 * https://www.fressnapf.de/magazin/hund/rassen/mastiff/ → Polen/Polnisch.
 * Prüft die Verdrahtung zwischen den Schritten (nicht die Prompt-Qualität).
 * Ausführen: bun test
 */
import { describe, expect, test } from "bun:test";
import {
  buildTargetUrl,
  buildTargetUrls,
  hreflangHint,
  lastPathSegment,
  matchHreflang,
  missingSegments,
  PathMapError,
} from "../src/lib/pipeline/paths";
import {
  derivePathPairs,
  extractContentLinks,
  isEditorialUrl,
} from "../src/lib/pipeline/hreflang.server";
import { buildKeyword, serpTarget } from "../src/lib/pipeline/serp.server";
import { isUsable, retrieveFromPool } from "../src/lib/pipeline/pool";
import {
  checkExactTables,
  checkLocalizedTable,
  extractMarkdownTables,
  missingTableIndices,
  stripMarkdownTables,
  tableRows,
} from "../src/lib/pipeline/tables";
import { buildSectionInputs, PlanMappingError } from "../src/lib/pipeline/plan";
import {
  blockingIssues,
  checkGeneratedSection,
  deterministicArticleIssues,
  deterministicBrandIssues,
  isTableOnlySection,
  issueSeverity,
} from "../src/lib/pipeline/content-guards";

import { cleanHeadingText } from "../src/lib/pipeline/extract.server";
import { extractDoc } from "../src/lib/pipeline/extract.server";
import {
  S2OutputSchema,
  S6OutputSchema,
  validateStepData,
  StepSchemaError,
} from "../src/lib/pipeline/schemas";
import { dependencyBlocker } from "../src/lib/pipeline/deps";
import type { JobContext, PlanSection, SourceSection } from "../src/lib/pipeline/types";

const SOURCE_URL = "https://www.fressnapf.de/magazin/hund/rassen/mastiff/";
const MARKET_PL = {
  domain: "maxizoo.pl",
  locale: "pl-PL",
  language: "Polnisch",
  path_map: { magazin: "magazyn", hund: "pies", rassen: "rasy", katze: "kot" },
};
const HREFLANG = [
  { lang: "de-DE", href: "https://www.fressnapf.de/magazin/hund/rassen/mastiff/" },
  { lang: "de-AT", href: "https://www.fressnapf.at/magazin/hund/rassen/mastiff/" },
  { lang: "de-CH", href: "https://www.fressnapf.ch/magazin/hund/rassen/mastiff/" },
  { lang: "de-LU", href: "https://www.fressnapf.lu/magazin/hund/rassen/mastiff/" },
  { lang: "fr-FR", href: "https://www.maxizoo.fr/magazine/chien/races/mastiff/" },
];

describe("1 · S1 hreflang", () => {
  test("Alternates vorhanden, pl fehlt → hreflang_hint gesetzt", () => {
    expect(HREFLANG.length).toBeGreaterThan(0);
    expect(matchHreflang(HREFLANG, "pl-PL")).toBeNull();
    expect(hreflangHint(HREFLANG, "pl-PL")).toContain("pl-PL");
  });

  test("passende Locale → direkte Übernahme, kein Hinweis", () => {
    const alt = matchHreflang(HREFLANG, "de-AT");
    expect(alt?.href).toBe("https://www.fressnapf.at/magazin/hund/rassen/mastiff/");
    expect(hreflangHint(HREFLANG, "de-AT")).toBeNull();
    expect(lastPathSegment(alt!.href)).toBe("mastiff");
  });
});

describe("2 · S2 Kandidaten", () => {
  test("Übersetzungsgrundlage ist das URL-Segment, nicht die H1", () => {
    expect(lastPathSegment(SOURCE_URL)).toBe("mastiff");
  });

  test("kanonisches Schema erzwingt term_translated + slug_candidates", () => {
    expect(() => validateStepData("S2", S2OutputSchema, { slugs: ["mastif-angielski"] })).toThrow(
      StepSchemaError,
    );
    const ok = validateStepData("S2", S2OutputSchema, {
      term_translated: "mastif angielski",
      slug_candidates: ["mastif-angielski", "mastif"],
    });
    expect(ok.slug_candidates).toContain("mastif-angielski");
  });
});

describe("3 · S3 checked-URLs über path_map", () => {
  test("kompletter Pfad wird übersetzt, nur das letzte Segment ersetzt", () => {
    expect(buildTargetUrl(SOURCE_URL, MARKET_PL, "mastif-angielski")).toBe(
      "https://maxizoo.pl/magazyn/pies/rasy/mastif-angielski/",
    );
    const urls = buildTargetUrls(SOURCE_URL, MARKET_PL, ["mastif-angielski", "mastif"]);
    expect(urls).toHaveLength(2);
    urls.forEach((u) => expect(u).toMatch(/^https:\/\/maxizoo\.pl\/magazyn\/pies\/rasy\/[^/]+\/$/));
  });

  test("fehlendes path_map-Segment bricht mit Nennung des Segments ab", () => {
    const broken = { ...MARKET_PL, path_map: { magazin: "magazyn", hund: "pies" } };
    expect(() => buildTargetUrl(SOURCE_URL, broken, "mastif")).toThrow(PathMapError);
    try {
      buildTargetUrl(SOURCE_URL, broken, "mastif");
    } catch (e) {
      expect((e as PathMapError).message).toContain("rassen");
    }
  });
});

describe("5 · S6 Anker", () => {
  const plan = {
    sections: [
      {
        de_heading: "Steckbrief Mastiff",
        target_heading: "Mastif angielski w skrócie",
        action: "uebersetzen",
        notes: ["Tabelle beibehalten"],
        has_table: true,
        anchors: [
          { anchor: "rasy psów", intent: "rasse", search_terms: ["rasy", "psy"], path_type: "magazine" },
          { anchor: "karma dla psa", intent: "produktkategorie", search_terms: ["karma"] },
        ],
      },
      {
        de_heading: "Charakter",
        target_heading: "Charakter mastifa",
        action: "lokalisieren",
        notes: ["ZKwP statt VDH"],
        has_table: false,
        anchors: [
          { anchor: "szkolenie psa", intent: "ratgeber", search_terms: ["szkolenie"] },
          { anchor: "zabawki dla psa", intent: "produktkategorie", search_terms: ["zabawki"] },
          { anchor: "legowisko", intent: "produktkategorie", search_terms: ["legowisko"] },
        ],
      },
    ],
  };

  test("Ausgabeschema akzeptiert Anker und zählt ≥ 5", () => {
    const parsed = validateStepData("S6", S6OutputSchema, plan);
    const anchors = parsed.sections.flatMap((s) => s.anchors);
    expect(anchors.length).toBeGreaterThanOrEqual(5);
    expect(anchors.every((a) => !/https?:\/\//.test(a.anchor))).toBe(true);
  });

  test("unbekanntes Aktionsvokabular ist ein Fehler (P2-3)", () => {
    expect(() =>
      validateStepData("S6", S6OutputSchema, {
        sections: [{ ...plan.sections[0], action: "adapt" }],
      }),
    ).toThrow(StepSchemaError);
  });
});

describe("8 · S10 Tabellenprüfung", () => {
  const de = "| Herkunft | Großbritannien |\n| --- | --- |\n| Größe | 70–91 cm |";
  const pl = "| Pochodzenie | Wielka Brytania |\n| --- | --- |\n| Wielkość | 70–91 cm |";

  test("identische Ausgabe wird abgelehnt", () => {
    const res = checkLocalizedTable(de, de, "Polnisch");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("nicht lokalisiert");
  });

  test("abweichende Zeilenzahl wird abgelehnt", () => {
    const shortened = pl.split("\n").slice(0, 2).join("\n");
    expect(checkLocalizedTable(de, shortened, "Polnisch").ok).toBe(false);
  });

  test("korrekte Lokalisierung wird akzeptiert", () => {
    expect(checkLocalizedTable(de, pl, "Polnisch").ok).toBe(true);
    expect(tableRows(pl)).toHaveLength(tableRows(de).length);
  });

  test("abweichende Spaltenzahl wird abgelehnt", () => {
    const malformed = "| Pochodzenie |\n| --- |\n| Wielkość |";
    expect(checkLocalizedTable(de, malformed, "Polnisch").ok).toBe(false);
  });
});

describe("9–11 · S11 Eingabe je Abschnitt", () => {
  const sourceSections: SourceSection[] = [
    { heading: "Steckbrief Mastiff", level: 2, text: "Der Mastiff ist eine britische Rasse …\n[TABELLE 0]" },
    { heading: "Charakter", level: 2, text: "Ruhig, wachsam und sehr anhänglich …" },
    { heading: "Pflege", level: 2, text: "Kurzes Fell, wöchentliches Bürsten …" },
  ];
  const plan: PlanSection[] = [
    {
      de_heading: "Steckbrief Mastiff",
      target_heading: "Mastif angielski w skrócie",
      action: "uebersetzen",
      notes: ["Tabelle beibehalten"],
      has_table: true,
      anchors: [],
    },
    {
      de_heading: "Charakter",
      target_heading: "Charakter mastifa",
      action: "lokalisieren",
      notes: [],
      has_table: false,
      anchors: [],
    },
    {
      de_heading: "Pflege",
      target_heading: "Pielęgnacja mastifa",
      action: "umschreiben",
      notes: [],
      has_table: false,
      anchors: [],
    },
  ];
  const tables = [{ index: 0, markdown: "| Pochodzenie | Wielka Brytania |" }];

  const inputs = buildSectionInputs({
    plan,
    sourceSections,
    tables,
    verifiedLinks: [],
    styleProfile: { tone: "freundlich" },
    market: { country: "Polen" },
  });

  test("jeder Abschnitt erhält den deutschen Volltext", () => {
    expect(inputs).toHaveLength(3);
    inputs.forEach((i, n) => {
      expect(i.de_body).toBe(sourceSections[n]!.text);
      expect(i.de_body.length).toBeGreaterThan(10);
    });
  });

  test("Zielüberschriften sind verschieden und stammen aus dem Plan", () => {
    const headings = inputs.map((i) => i.target_heading);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toEqual(plan.map((p) => p.target_heading));
  });

  test("genau ein Abschnitt bekommt die Tabelle (P0-3)", () => {
    expect(inputs.filter((i) => i.table_markdown !== null)).toHaveLength(1);
    expect(inputs[0]!.table_markdown).toBe(tables[0]!.markdown);
    expect(inputs[1]!.table_markdown).toBeNull();
  });

  test("nicht zuordenbare Planüberschrift ist ein Fehler, kein Fallback", () => {
    expect(() =>
      buildSectionInputs({
        plan: [{ ...plan[0]!, de_heading: "Gibt es nicht" }],
        sourceSections,
        tables,
        verifiedLinks: [],
        styleProfile: {},
        market: {},
      }),
    ).toThrow(PlanMappingError);
  });
});

describe("14 · Abhängigkeiten (Link-Pool statt Gesamtindex)", () => {
  const ctx: JobContext = {};

  test("ohne Link-Pool blockieren Stilprofil und Verlinkung", () => {
    expect(dependencyBlocker("S5_style_profile", ctx)).toContain("S7a");
    expect(dependencyBlocker("S7_link_candidates", ctx)).toBeTruthy();
  });

  test("S7a benötigt nur die Quelle", () => {
    expect(dependencyBlocker("S7a_link_pool", ctx)).toContain("S1");
    expect(
      dependencyBlocker("S7a_link_pool", { source: { sections: [], tables: [] } as never }),
    ).toBeNull();
  });

  test("fehlgeschlagene Vorstufen blockieren nachgelagerte Schritte", () => {
    expect(dependencyBlocker("S11_generate_content", {})).toContain("S1");
    expect(
      dependencyBlocker("S11_generate_content", {
        source: { sections: [], tables: [] } as never,
        plan: { sections: [] },
      }),
    ).toContain("S6");
    expect(dependencyBlocker("S12_qa", {})).toContain("S11");
    expect(dependencyBlocker("S13_export", { content: [{ heading: "x", markdown: "y" }] })).toContain("S12");
    expect(
      dependencyBlocker("S13_export", {
        content: [{ heading: "x", markdown: "y" }],
        qa: { issues: [] },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 15 · hreflang-Ernte über die Content-Links der Quellseite
// ---------------------------------------------------------------------------
describe("15 · hreflang-Ernte", () => {
  test("Segmentpaare werden aus äquivalenten URLs abgeleitet (ohne Slug)", () => {
    const pairs = derivePathPairs(
      "https://www.fressnapf.de/magazin/hund/gesundheit/zahnstein/",
      "https://www.maxizoo.ie/magazine/dog/health/tartar/",
    );
    expect(pairs).toEqual({ magazin: "magazine", hund: "dog", gesundheit: "health" });
  });

  test("unterschiedliche Pfadtiefe liefert keine Paare", () => {
    expect(
      derivePathPairs("https://a.de/magazin/hund/x/", "https://b.ie/magazine/dog/health/x/"),
    ).toEqual({});
  });

  test("abgeleitete Pfade füllen Lücken, market.path_map bleibt maßgeblich", () => {
    const market = { domain: "maxizoo.ie", path_map: { magazin: "magazine", hund: "dog" } };
    const url = buildTargetUrl(
      "https://www.fressnapf.de/magazin/hund/gesundheit/analdruesenentzuendung/",
      market,
      "anal-gland-infection",
      { gesundheit: "health", hund: "hound" },
    );
    expect(url).toBe("https://maxizoo.ie/magazine/dog/health/anal-gland-infection/");
  });

  test("nur interne Fließtext-Links werden geerntet", () => {
    const html = `<main><nav><a href="/nav/">Nav</a></nav>
      <p><a href="/magazin/hund/gesundheit/zahnstein/">Zahnstein</a>
      <a href="https://extern.de/x">Extern</a>
      <a href="#top">Anker</a>
      <a href="/bild.jpg">Bild</a></p></main>`;
    const links = extractContentLinks(html, "https://www.fressnapf.de/magazin/hund/rassen/barbet/");
    expect(links.map((l) => l.url)).toEqual([
      "https://www.fressnapf.de/magazin/hund/gesundheit/zahnstein/",
    ]);
  });
});

describe("16 · Zweite Ebene des Link-Pools", () => {
  test("Magazinseiten werden erkannt, Produkt-/Kategorieseiten nicht", () => {
    expect(isEditorialUrl("https://www.fressnapf.de/magazin/hund/rassen/barbet/")).toBe(true);
    expect(isEditorialUrl("https://www.fressnapf.de/p/royal-canin-12kg/")).toBe(false);
    expect(isEditorialUrl("https://www.fressnapf.de/c/hund/trockenfutter/")).toBe(false);
  });

  test("nicht abgerufene Quellkandidaten sind nicht direkt verwendbar", () => {
    const target = {
      url: "https://maxizoo.ie/magazine/dog/health/tartar/",
      anchor_text: "tartar in dogs",
      path_type: "magazine" as const,
      origin: "hreflang" as const,
      source_page: "x",
      fetched: true,
      scope: "target" as const,
    };
    const candidate = {
      url: "https://www.fressnapf.de/magazin/hund/gesundheit/zahnstein/",
      anchor_text: "Zahnstein beim Hund",
      path_type: "magazine" as const,
      origin: "candidate" as const,
      source_page: "y",
      fetched: false,
      scope: "source_candidate" as const,
    };
    expect(isUsable(target)).toBe(true);
    expect(isUsable(candidate)).toBe(false);
    const hits = retrieveFromPool("zahnstein hund", [target, candidate]);
    expect(hits.some((h) => h.url === candidate.url)).toBe(false);
  });
});

describe("17 · S7b SERP-Lückenanalyse", () => {
  test("Suchanfragen werden immer auf die Zieldomain eingeschränkt", () => {
    expect(buildKeyword("choroby psów", "maxizoo.pl")).toBe("site:maxizoo.pl choroby psów");
    // Vom Modell mitgelieferte Operatoren werden entfernt, nicht verdoppelt.
    expect(buildKeyword("site:example.com kleszcze", "maxizoo.pl")).toBe(
      "site:maxizoo.pl kleszcze",
    );
  });

  test("Standort und Sprache stammen aus dem Markt", () => {
    const t = serpTarget({
      domain: "https://www.maxizoo.pl",
      locale: "pl-PL",
      language: "Polnisch",
      country: "Polen",
    });
    expect(t).toEqual({
      location_code: 2616,
      language_code: "pl",
      host: "maxizoo.pl",
      site: "maxizoo.pl",
      path_prefix: "",
    });
    // Sprachverzeichnis fließt in die site:-Einschränkung ein.
    expect(
      serpTarget({
        domain: "fressnapf.ch",
        locale: "fr-CH",
        language: "Französisch",
        country: "Schweiz",
        path_prefix: "/fr",
      }).site,
    ).toBe("fressnapf.ch/fr");
    expect(() =>
      serpTarget({ domain: "fressnapf.hu", locale: "hu-HU", language: "Ungarisch", country: "Ungarn" }),
    ).toThrow();
  });
});


describe("18 · Pfadpräfix und Pfadlücken", () => {
  const chFr = {
    domain: "fressnapf.ch",
    locale: "fr-CH",
    path_prefix: "/fr",
    path_map: { magazin: "magazine", terra: "terra", weitere: "autres" },
  };

  test("Sprachpräfix wird der Zieladresse vorangestellt", () => {
    expect(
      buildTargetUrl(
        "https://www.fressnapf.de/magazin/terra/weitere/gottesanbeterin/",
        chFr,
        "mante-religieuse",
      ),
    ).toBe("https://fressnapf.ch/fr/magazine/terra/autres/mante-religieuse/");
  });

  test("fehlende Segmente werden benannt statt geraten", () => {
    const market = { ...chFr, path_map: { magazin: "magazine" } };
    expect(
      missingSegments("https://www.fressnapf.de/magazin/terra/weitere/gottesanbeterin/", market),
    ).toEqual(["terra", "weitere"]);
    expect(
      missingSegments("https://www.fressnapf.de/magazin/terra/weitere/gottesanbeterin/", market, {
        terra: "terra",
        weitere: "autres",
      }),
    ).toEqual([]);
  });
});

describe("19 · Tabellenzuordnung und Tabellenprüfung", () => {
  const sourceSections: SourceSection[] = [
    { heading: "Steckbrief", level: 2, text: "Kurzprofil …\n[TABELLE 0]" },
    { heading: "Charakter", level: 2, text: "- Ruhig\n- Wachsam" },
  ];
  const plan: PlanSection[] = [
    {
      de_heading: "Steckbrief",
      target_heading: "W skrócie",
      action: "uebersetzen",
      notes: [],
      has_table: false,
      anchors: [],
    },
    {
      de_heading: "Charakter",
      target_heading: "Charakter",
      action: "uebersetzen",
      notes: [],
      has_table: false,
      anchors: [],
    },
  ];
  const tables = [{ index: 0, markdown: "| Pochodzenie | Wielka Brytania |\n| --- | --- |\n| Waga | 70 kg |" }];

  test("Positionsmarker gewinnt über fehlendes has_table-Kennzeichen", () => {
    const inputs = buildSectionInputs({
      plan,
      sourceSections,
      tables,
      verifiedLinks: [],
      styleProfile: {},
      market: {},
    });
    expect(inputs[0]?.has_table).toBe(true);
    expect(inputs[0]?.table_markdown).toContain("Wielka Brytania");
    expect(inputs[1]?.has_table).toBe(false);
  });

  test("ohne Marker oder Abschnittsbeleg wird die Tabelle nicht beliebig angehängt", () => {
    expect(() =>
      buildSectionInputs({
        plan,
        sourceSections: [
          { heading: "Steckbrief", level: 2, text: "Kurzprofil …" },
          { heading: "Charakter", level: 2, text: "- Ruhig" },
        ],
        tables,
        verifiedLinks: [],
        styleProfile: {},
        market: {},
      }),
    ).toThrow(PlanMappingError);
  });

  test("fehlende Tabelle im Zieltext wird erkannt", () => {
    expect(missingTableIndices("Nur Text ohne Tabelle", tables)).toEqual([0]);
    expect(missingTableIndices(`Text\n\n${tables[0]!.markdown}`, tables)).toEqual([]);
  });

  test("Listenpunkte bleiben als Listenzeilen erhalten", () => {
    const inputs = buildSectionInputs({
      plan,
      sourceSections,
      tables,
      verifiedLinks: [],
      styleProfile: {},
      market: {},
    });
    expect(inputs[1]?.de_body).toContain("- Ruhig");
  });
});

describe("20 · Harte Content-Schutzregeln", () => {
  const table = "| Name | Wert |\n| --- | --- |\n| Größe | 8 cm |";

  test("genau eine exakte Tabelle wird akzeptiert", () => {
    expect(checkExactTables(`Text\n\n${table}`, [{ index: 0, markdown: table }]).ok).toBe(true);
    expect(extractMarkdownTables(`Text\n\n${table}`)).toHaveLength(1);
  });

  test("doppelte und frei erzeugte Tabellen werden erkannt", () => {
    const invented = "| Name | Deutung |\n| --- | --- |\n| Größe | variabel |";
    const duplicate = checkExactTables(`${table}\n\n${table}`, [{ index: 0, markdown: table }]);
    expect(duplicate.duplicated).toEqual([0]);
    expect(checkExactTables(`${table}\n\n${invented}`, [{ index: 0, markdown: table }]).foreign).toBe(1);
    expect(stripMarkdownTables(`Absatz\n\n${invented}`).removed).toHaveLength(1);
  });

  test("Listenabweichung, doppelte Überschrift und zu langer Text blockieren", () => {
    const source = "Ein kurzer Absatz.\n- Punkt eins\n- Punkt zwei";
    const target = "## Ziel\n\n## Zweite Überschrift\n\nEin sehr langer Absatz mit vielen frei ergänzten Wörtern, Hinweisen, Beispielen und weiteren Aussagen.\n- Nur ein Punkt";
    const result = checkGeneratedSection(source, target);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("Listenpunktzahl"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("statt genau einer Überschrift"))).toBe(true);
  });

  test("Gesamtprüfung blockiert fremde Tabellen und starke Verlängerung", () => {
    const target = `## Ziel\n\n${table}\n\n| Fremd | Wert |\n| --- | --- |\n| A | B |\n\n${"Zusatz ".repeat(80)}`;
    const issues = deterministicArticleIssues({
      sourceText: "Kurzer Ursprungstext.",
      targetText: target,
      tables: [{ index: 0, markdown: table }],
      sections: [],
    });
    expect(issues.some((i) => i.type === "tabelle_zusaetzlich")).toBe(true);
    expect(issues.some((i) => i.type === "laenge")).toBe(true);
  });

  test("Überschriftentext verliert doppelte Markdown-Marker", () => {
    expect(cleanHeadingText("## # Profil Tier")).toBe("Profil Tier");
  });

  test("verschachtelte Überschriftenteile behalten sichtbare Wortabstände", () => {
    const doc = extractDoc(
      "https://example.test/source",
      "https://example.test/source",
      200,
      "<main><h1><span>Profil</span><strong> Tier</strong></h1><p>Text</p></main>",
    );
    expect(doc.h1).toBe("Profil Tier");
    expect(doc.sections[0]?.heading).toBe("Profil Tier");
  });

  test("doppelte Quellüberschriften werden nicht still zusammengeführt", () => {
    expect(() =>
      buildSectionInputs({
        plan: [{
          de_heading: "Steckbrief",
          target_heading: "Profil",
          action: "uebersetzen",
          notes: [],
          has_table: false,
          anchors: [],
        }],
        sourceSections: [
          { heading: "Steckbrief", level: 2, text: "A" },
          { heading: "Steckbrief", level: 2, text: "B" },
        ],
        tables: [],
        verifiedLinks: [],
        styleProfile: {},
        market: {},
      }),
    ).toThrow(PlanMappingError);
  });
});

describe("21 · Weiche Abweichungen stoppen den Lauf nicht", () => {
  const source = "Absatz eins mit Inhalt.\n\nAbsatz zwei mit Inhalt.\n\n[TABELLE 1]";
  const target = "## Titel\n\nAkapit jeden z trescia.\n\nAkapit dwa z trescia.\n\n[[OMFIRE_TABLE_1]]";

  test("Tabellenmarker und Tabellen werden beim Vergleich gleich behandelt", () => {
    const guard = checkGeneratedSection(source, target);
    expect(guard.hardReasons.length).toBe(0);
  });

  test("Umfang und Absatzabweichung sind Hinweise, keine Blocker", () => {
    const issues = deterministicArticleIssues({
      sourceText: source,
      targetText: target,
      tables: [],
      sections: [
        { heading: "Titel", source, target: target + "\n\nJeszcze jeden dodatkowy akapit tekstu." },
      ],
    });
    expect(blockingIssues(issues).length).toBe(0);
  });
});

describe("22 · Reine Tabellen-Abschnitte (kein LLM-Aufruf)", () => {
  test("nur Marker → reiner Tabellen-Abschnitt", () => {
    expect(isTableOnlySection("[[OMFIRE_TABLE_0]]")).toBe(true);
    expect(isTableOnlySection("[[OMFIRE_TABLE_0]]\n[[OMFIRE_TABLE_1]]")).toBe(true);
  });

  test("Fließtext neben dem Marker → kein reiner Tabellen-Abschnitt", () => {
    expect(isTableOnlySection("Der Mastiff ist eine britische Rasse.\n[[OMFIRE_TABLE_0]]")).toBe(false);
    expect(isTableOnlySection("[[OMFIRE_TABLE_0]]\nNoch ein Satz.")).toBe(false);
  });

  test("leer oder nur Fließtext → kein reiner Tabellen-Abschnitt", () => {
    expect(isTableOnlySection("")).toBe(false);
    expect(isTableOnlySection("Nur ein Absatz.")).toBe(false);
  });
});

describe("23 · Marke blockiert nicht mehr, deterministischer Abgleich bleibt", () => {
  test("marke-Funde sind Hinweise, keine Blocker", () => {
    expect(issueSeverity({ type: "marke" })).toBe("warning");
    expect(blockingIssues([{ type: "marke" }]).length).toBe(0);
    expect(blockingIssues([{ type: "tabelle" }]).length).toBe(1);
    expect(blockingIssues([{ type: "verbotene_aussage" }]).length).toBe(1);
  });

  test("deterministischer Abgleich erkennt nur echte Rechtschreibfehler", () => {
    const brand = "maxizoo";
    // Exakte Schreibweise und Groß-/Kleinschreibung sind ok.
    expect(deterministicBrandIssues("Willkommen bei maxizoo.", brand)).toHaveLength(0);
    expect(deterministicBrandIssues("Willkommen bei MaxiZoo.", brand)).toHaveLength(0);
    // Echte Fehlschreibung blockiert (Typ marke_falsch, severity error).
    const hits = deterministicBrandIssues("Willkommen bei maxizox.", brand);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.type).toBe("marke_falsch");
    expect(hits[0]?.severity).toBe("error");
  });

  test("fehlende Markennennung ist kein Befund", () => {
    expect(deterministicBrandIssues("Ein Text ohne Markennennung.", "maxizoo")).toHaveLength(0);
  });

  test("themenfremde, aber ähnlich klingende Wörter lösen keinen Fehlalarm aus", () => {
    expect(deterministicBrandIssues("Der maximale Wert.", "maxizoo")).toHaveLength(0);
  });
});
