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
import { checkLocalizedTable, tableRows } from "../src/lib/pipeline/tables";
import { buildSectionInputs, PlanMappingError } from "../src/lib/pipeline/plan";
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
});

describe("9–11 · S11 Eingabe je Abschnitt", () => {
  const sourceSections: SourceSection[] = [
    { heading: "Steckbrief Mastiff", level: 2, text: "Der Mastiff ist eine britische Rasse …" },
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
    expect(dependencyBlocker("S13_export", { content: [{ heading: "x", markdown: "y" }] })).toBeNull();
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
