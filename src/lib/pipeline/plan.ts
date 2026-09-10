/** Verdrahtung Plan (S6) → Schreibschritt (S11). Rein, damit testbar. */
import type { PlanAction } from "./schemas";
import type { PlanSection, SourceSection, VerifiedLink } from "./types";

export interface GenerateSectionInput {
  de_heading: string;
  de_body: string;
  target_heading: string;
  /** Überschriftenebene aus dem Quelldokument (1–3), wird 1:1 übernommen. */
  heading_level: number;
  /** Inhaltsverzeichnis-Abschnitt: nur Platzhalter, keine KI-Erstellung. */
  is_toc: boolean;
  action: PlanAction;
  notes: string[];
  has_table: boolean;
  table_markdown: string | null;
  written_headings: string[];
  verified_links: VerifiedLink[];
  style_profile: unknown;
  market: unknown;
}

const TOC_HEADINGS = [
  "inhaltsverzeichnis",
  "inhalt",
  "das erwartet dich",
  "das erwartet dich hier",
  "uberblick",
  "ubersicht",
  "auf einen blick",
  "table of contents",
];

/** Erkennt Inhaltsverzeichnis-Abschnitte anhand der Überschrift. */
export function isTocHeading(heading: string): boolean {
  const n = norm(heading);
  return TOC_HEADINGS.includes(n);
}

export class PlanMappingError extends Error {}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Verknüpft jeden Planabschnitt über de_heading mit dem deutschen Quellabschnitt.
 * Keine Zuordnung = Fehler, kein stiller Fallback (P0-1).
 * Tabellen werden nur an Abschnitte mit has_table === true vergeben (P0-3).
 */
export function buildSectionInputs(args: {
  plan: PlanSection[];
  sourceSections: SourceSection[];
  tables: { index: number; markdown: string }[];
  verifiedLinks: VerifiedLink[];
  styleProfile: unknown;
  market: unknown;
}): GenerateSectionInput[] {
  const { plan, sourceSections, tables } = args;
  const unmatched: string[] = [];
  const bodies = new Map<string, string>();
  for (const s of sourceSections) {
    const key = norm(s.heading);
    bodies.set(key, [bodies.get(key), s.text].filter(Boolean).join("\n"));
  }

  const sorted = [...tables].sort((a, b) => a.index - b.index);
  let tableCursor = 0;

  const out: GenerateSectionInput[] = [];
  for (const section of plan) {
    const body = bodies.get(norm(section.de_heading));
    if (body == null) {
      unmatched.push(section.de_heading);
      continue;
    }
    const hasTable = Boolean(section.has_table);
    const table = hasTable ? (sorted[tableCursor++]?.markdown ?? null) : null;
    out.push({
      de_heading: section.de_heading,
      de_body: body,
      target_heading: section.target_heading,
      action: section.action,
      notes: section.notes ?? [],
      has_table: hasTable && table !== null,
      table_markdown: table,
      written_headings: [],
      verified_links: args.verifiedLinks,
      style_profile: args.styleProfile,
      market: args.market,
    });
  }

  if (unmatched.length) {
    throw new PlanMappingError(
      `Kein Quellabschnitt zu diesen Planüberschriften gefunden: ${unmatched
        .map((h) => `„${h}"`)
        .join(", ")}. Bitte S6 erneut ausführen.`,
    );
  }
  return out;
}
