export type StepKey =
  | "S1_extract_source"
  | "S2_resolve_slug"
  | "S3_target_status"
  | "S4_compare"
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
    description: "EXISTS / VERIFIED_404 / NOT_IN_INDEX anhand Index und Live-Abruf bestimmen.",
  },
  {
    key: "S4_compare",
    order: 4,
    label: "S4 · Abgleich",
    promptKey: "compare",
    description: "Vorhandenen Zielinhalt mit der deutschen Quelle vergleichen (Lücken).",
  },
  {
    key: "S5_style_profile",
    order: 5,
    label: "S5 · Stilprofil",
    promptKey: "style_profile",
    description: "Stilprofil des Zielmarkts aus Referenztexten ableiten (gecached).",
  },
  {
    key: "S6_localization_plan",
    order: 6,
    label: "S6 · Lokalisierungsplan",
    promptKey: "localization_plan",
    description: "Abschnittsweiser Plan mit Aktion (keep/adapt/replace/drop) je Abschnitt.",
  },
  {
    key: "S7_link_candidates",
    order: 7,
    label: "S7 · Linkkandidaten",
    description: "Hybrid-Retrieval aus dem Ziel-URL-Index je geplantem Anker.",
  },
  {
    key: "S8_link_select",
    order: 8,
    label: "S8 · Linkauswahl",
    promptKey: "link_select",
    description: "LLM wählt nur aus Kandidatennummern – niemals freie URLs.",
  },
  {
    key: "S9_link_verify",
    order: 9,
    label: "S9 · Linkprüfung",
    description: "Jede ausgewählte URL per GET prüfen: 200, Canonical, kein Soft-404.",
  },
  {
    key: "S10_localize_tables",
    order: 10,
    label: "S10 · Tabellen lokalisieren",
    promptKey: "localize_table",
    description: "Tabellen übersetzen und Einheiten/Normen an den Zielmarkt anpassen.",
  },
  {
    key: "S11_generate_content",
    order: 11,
    label: "S11 · Content erzeugen",
    promptKey: "generate_content",
    description: "Abschnittsweise Texterzeugung mit Stilprofil und verifizierten Links.",
  },
  {
    key: "S12_qa",
    order: 12,
    label: "S12 · QA",
    promptKey: "qa",
    description: "Sprach-, Marken- und Claim-Prüfung des Gesamttexts.",
  },
  {
    key: "S13_export",
    order: 13,
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
    resolution_method?: "hreflang" | "slug";
    hreflang_hint?: string | null;
  };
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

