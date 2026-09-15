import type { GapEntry, PoolEntry, SearchLogEntry } from "./pool";

export type StepKey =
  | "S1_extract_source"
  | "S2_resolve_slug"
  | "S3_target_status"
  | "S4_compare"
  | "S7a_link_pool"
  | "S7b_serp_gap"
  | "S7c_serp_opportunities"

  | "S5_style_profile"
  | "S6_localization_plan"
  | "S7_link_candidates"
  | "S8_link_select"
  | "S9_link_verify"
  | "S10_localize_tables"
  | "S11_generate_content"
  | "S12_qa"
  | "S13_export";

export interface StepDef {
  key: StepKey;
  order: number;
  label: string;
  /** Prompt-Template-Key, falls der Schritt ein LLM verwendet. */
  promptKey?: string;
  description: string;
}

export const PIPELINE: StepDef[] = [
  {
    key: "S1_extract_source",
    order: 1,
    label: "S1 · Quelle extrahieren",
    description: "Deutsche Quell-URL laden, Struktur, Tabellen, Links und hreflang erfassen.",
  },
  {
    key: "S2_resolve_slug",
    order: 2,
    label: "S2 · Ziel-Slug ermitteln",
    promptKey: "resolve_target_slug",
    description: "Fachbegriff in die Zielsprache übersetzen und Slug-Kandidaten bilden.",
  },
  {
    key: "S3_target_status",
    order: 3,
    label: "S3 · Zielstatus prüfen",
    description:
      "EXISTS / VERIFIED_404 / NOT_IN_INDEX über hreflang, Hub-Liste und Live-Abruf bestimmen.",
  },
  {
    key: "S4_compare",
    order: 4,
    label: "S4 · Abgleich",
    promptKey: "compare",
    description: "Vorhandenen Zielinhalt mit der deutschen Quelle vergleichen (Lücken).",
  },
  {
    key: "S7a_link_pool",
    order: 5,
    label: "S7a · Link-Pool aufbauen",
    description:
      "Hub-Seite, Navigation und Geschwisterartikel des Zielmarkts abrufen (max. 8 Abrufe).",
  },
  {
    key: "S7b_serp_gap",
    order: 6,
    label: "S7b · SERP-Lückenanalyse",
    promptKey: "serp_gap_queries",
    description:
      "KI formuliert bis zu 5 site-beschränkte Suchanfragen (DataForSEO, 1. Seite) und übernimmt nur nützliche Treffer in den Pool.",
  },
  {
    key: "S7c_serp_opportunities",
    order: 7,
    label: "S7c · SERP-Linkchancen",
    promptKey: "serp_opportunity_queries",
    description:
      "KI leitet aus dem Quelltext bis zu 10 zusätzliche Linkchancen ab und sucht sie per DataForSEO auf der Zieldomain (inkl. Sprachverzeichnis).",
  },
  {
    key: "S5_style_profile",
    order: 8,
    label: "S5 · Stilprofil",
    promptKey: "style_profile",
    description: "Stilprofil aus den Geschwisterartikeln des Link-Pools ableiten (gecached).",
  },
  {
    key: "S6_localization_plan",
    order: 9,
    label: "S6 · Lokalisierungsplan",
    promptKey: "localization_plan",
    description: "Abschnittsweiser Plan mit Aktion (keep/adapt/replace/drop) je Abschnitt.",
  },
  {
    key: "S7_link_candidates",
    order: 10,
    label: "S7 · Linkkandidaten",
    description: "Zweistufig: Retrieval im Link-Pool, danach gezielte Site-Suche für Lücken.",
  },
  {
    key: "S8_link_select",
    order: 11,
    label: "S8 · Linkauswahl",
    promptKey: "link_select",
    description: "LLM wählt nur aus Kandidatennummern – niemals freie URLs.",
  },
  {
    key: "S9_link_verify",
    order: 12,
    label: "S9 · Linkprüfung",
    description: "Jede ausgewählte URL per GET prüfen: 200, Canonical, kein Soft-404.",
  },
  {
    key: "S10_localize_tables",
    order: 13,
    label: "S10 · Tabellen lokalisieren",
    promptKey: "localize_table",
    description: "Tabellen übersetzen und Einheiten/Normen an den Zielmarkt anpassen.",
  },
  {
    key: "S11_generate_content",
    order: 14,
    label: "S11 · Content erzeugen",
    promptKey: "generate_content",
    description: "Abschnittsweise Texterzeugung mit Stilprofil und verifizierten Links.",
  },
  {
    key: "S12_qa",
    order: 15,
    label: "S12 · QA",
    promptKey: "qa",
    description: "Sprach-, Marken- und Claim-Prüfung des Gesamttexts.",
  },
  {
    key: "S13_export",
    order: 16,
    label: "S13 · Export",
    description: "Markdown-Export inklusive Metadaten und Linkliste.",
  },
];


export const STEP_BY_KEY: Record<string, StepDef> = Object.fromEntries(
  PIPELINE.map((s) => [s.key, s]),
);

export type TargetStatus = "EXISTS" | "VERIFIED_404" | "NOT_IN_INDEX";

export interface SourceTable {
  index: number;
  markdown: string;
  caption?: string;
  /** Überschrift des Abschnitts, in dem die Tabelle im Original steht. */
  section_heading?: string;
}

export interface SourceSection {
  heading: string;
  level: number;
  text: string;
}

export interface SourceDoc {
  url: string;
  finalUrl: string;
  httpStatus: number;
  canonical: string | null;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  hreflang: { lang: string; href: string }[];
  sections: SourceSection[];
  tables: SourceTable[];
  wordCount: number;
  outline: string;
  /** Interne Links im Fließtext der Quellseite (Basis der hreflang-Ernte). */
  contentLinks?: { url: string; anchor: string }[];
}

export type PlanAction = "uebersetzen" | "lokalisieren" | "umschreiben" | "streichen";

export interface PlanAnchor {
  anchor: string;
  intent: string;
  search_terms: string[];
  path_type?: string | undefined;
}

export interface PlanSection {
  de_heading: string;
  target_heading: string;
  action: PlanAction;
  notes: string[];
  has_table: boolean;
  anchors: PlanAnchor[];
}

export interface VerifiedLink {
  anchor: string;
  target_url: string;
  http_status: number;
  canonical_ok: boolean;
  confidence?: string;
  /** Ein Absatz Inhaltszusammenfassung der Zielseite (S9). */
  summary?: string;
  /** "ratgeber" | "kategorie" | "produkt" | "sonstige" – aus der Zielseite abgeleitet. */
  page_type?: string;
}

export interface JobContext {
  source?: SourceDoc;
  slug?: { term_translated: string; slug_candidates: string[] };
  hreflangTargetUrl?: string | null;
  target?: {
    status: TargetStatus;
    url: string | null;
    checked: { url: string; status: number }[];
    doc?: SourceDoc | null;
    resolution_method?: "hreflang" | "hub" | "slug";
    hreflang_hint?: string | null;
    /** Nachweiskette der Zielermittlung (hreflang, Hub-Treffer, HTTP-Prüfungen). */
    evidence?: { step: string; detail: string }[];
  };
  /** Aus hreflang-Paaren abgeleitete Pfadübersetzung (ergänzt market.path_map). */
  derivedPathMap?: Record<string, string>;
  /** Ergebnis der hreflang-Ernte über die Content-Links der Quellseite. */
  hreflangHarvest?: {
    checked: {
      de_url: string;
      status: number;
      target_url: string | null;
      page_type?: "magazine" | "shop";
      discovered?: number;
    }[];
    entries: PoolEntry[];
    /** Zweite Ebene: nicht abgerufene Quellkandidaten (Anker + Adresse). */
    discovered?: PoolEntry[];
    derived_path_map: Record<string, string>;
    harvested_at: string;
  };
  /** S7a · Link-Pool statt Gesamtindex. */
  linkPool?: {
    hub_url: string | null;
    built_at: string;
    fetches: { url: string; status: number; links: number; role: string }[];
    entries: PoolEntry[];
    siblings: { url: string; title: string | null; text: string }[];
  };
  /** S7b · Ergebnis der SERP-Lückenanalyse (DataForSEO). */
  serpGap?: {
    ran_at: string;
    queries: string[];
    location_code: number;
    language_code: string;
    host: string;
    results: {
      query: string;
      keyword: string;
      status: "ok" | "skipped" | "error";
      hits: number;
      error?: string;
    }[];
    added: { url: string; anchor_text: string | null; intent: string | null }[];
    rejected: { url: string; reason: string }[];
  };
  /** S7c · zusätzliche Linkchancen über DataForSEO (bis zu 10 Abfragen). */
  serpOpportunities?: {
    ran_at: string;
    site: string;
    host: string;
    path_prefix: string;
    location_code: number;
    language_code: string;
    ideas: { topic: string; query: string; reason?: string }[];
    results: {
      query: string;
      keyword: string;
      status: "ok" | "skipped" | "error";
      hits: number;
      error?: string;
    }[];
    added: { url: string; anchor_text: string | null; intent: string | null }[];
    rejected: { url: string; reason: string }[];
  };

  /** Protokoll der zweistufigen Kandidatensuche (S7). */
  linkSearchLog?: SearchLogEntry[];
  /** Poolkandidaten, die die HTTP-Prüfung in S9 nicht bestanden haben. */
  brokenLinks?: { anchor: string; url: string; http_status: number; reason: string }[];
  gapReport?: GapEntry[];
  compare?: unknown;
  styleProfile?: unknown;
  plan?: { sections: PlanSection[] };
  linkCandidates?: Record<string, { url: string; title: string; path_type: string }[]>;
  linkSelection?: { anchor: string; url: string | null; confidence?: string }[];
  verifiedLinks?: VerifiedLink[];
  tables?: { index: number; markdown: string }[];
  content?: { heading: string; markdown: string }[];
  qa?: unknown;
  exportMarkdown?: string;
}

