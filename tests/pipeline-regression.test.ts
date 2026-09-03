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
  PathMapError,
} from "../src/lib/pipeline/paths";
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

describe("14 · Abhängigkeiten und leerer Index", () => {
  const ctx: JobContext = {};

  test("negativer Test: Markt ohne URL-Index blockiert vor der Verlinkung", () => {
    expect(dependencyBlocker("S5_style_profile", ctx, 0)).toContain("URL-Index");
    expect(dependencyBlocker("S7_link_candidates", ctx, 0)).toBeTruthy();
  });

  test("fehlgeschlagene Vorstufen blockieren nachgelagerte Schritte", () => {
    expect(dependencyBlocker("S11_generate_content", {}, 10)).toContain("S1");
    expect(
      dependencyBlocker(
        "S11_generate_content",
        {
          source: { sections: [], tables: [] } as never,
          plan: { sections: [] },
        },
        10,
      ),
    ).toContain("S6");
    expect(dependencyBlocker("S12_qa", {}, 10)).toContain("S11");
    expect(dependencyBlocker("S13_export", { content: [{ heading: "x", markdown: "y" }] }, 10)).toBeNull();
  });
});
