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
  tables: { index: number; markdown: string }[];
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
  tables: { index: number; markdown: string; section_heading?: string }[];
  verifiedLinks: VerifiedLink[];
  styleProfile: unknown;
  market: unknown;
}): GenerateSectionInput[] {
  const { plan, sourceSections, tables } = args;
  const unmatched: string[] = [];
  const bodies = new Map<string, string>();
  const levels = new Map<string, number>();
  for (const s of sourceSections) {
    const key = norm(s.heading);
    if (bodies.has(key)) {
      throw new PlanMappingError(`Die Quellüberschrift „${s.heading}“ kommt mehrfach vor und kann nicht eindeutig zugeordnet werden.`);
    }
    bodies.set(key, s.text);
    if (!levels.has(key)) levels.set(key, s.level);
  }

  const sorted = [...tables].sort((a, b) => a.index - b.index);
  const byIndex = new Map(sorted.map((t) => [t.index, t]));
  const assigned = new Set<number>();

  // Zuordnung erfolgt deterministisch über die Positionsmarker [TABELLE n] aus S1,
  // nicht über das has_table-Flag des Plans (dieses war unzuverlässig).
  const markersOf = (body: string): number[] =>
    [...body.matchAll(/\[TABELLE (\d+)\]/g)]
      .map((m) => Number(m[1]))
       .filter((n) => byIndex.has(n));

  let tableCursor = 0;
  const nextFreeTable = (): number | null => {
    while (tableCursor < sorted.length) {
      const idx = sorted[tableCursor++]?.index;
      if (idx != null && !assigned.has(idx)) return idx;
    }
    return null;
  };

  const out: GenerateSectionInput[] = [];
  for (const section of plan) {
    const body = bodies.get(norm(section.de_heading));
    if (body == null) {
      unmatched.push(section.de_heading);
      continue;
    }
    let indices = markersOf(body);
    if (!indices.length) {
      const matchedByHeading = sorted
        .filter((t) => !assigned.has(t.index) && t.section_heading && norm(t.section_heading) === norm(section.de_heading))
        .map((t) => t.index);
      if (matchedByHeading.length) indices = matchedByHeading;
      else if (section.has_table) {
        const idx = nextFreeTable();
        if (idx != null) indices = [idx];
      }
    }
    indices.forEach((i) => assigned.add(i));
    const sectionTables = indices.map((i) => byIndex.get(i)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    const table = sectionTables.length ? sectionTables.map((t) => t.markdown).join("\n\n") : null;
    out.push({
      de_heading: section.de_heading,
      de_body: body,
      target_heading: section.target_heading,
      heading_level: Math.min(3, Math.max(1, levels.get(norm(section.de_heading)) ?? 2)),
      is_toc: isTocHeading(section.de_heading),
      action: section.action,
      notes: section.notes ?? [],
      has_table: Boolean(table),
      table_markdown: table,
      tables: sectionTables.map(({ index, markdown }) => ({ index, markdown })),
      written_headings: [],
      verified_links: args.verifiedLinks,
      style_profile: args.styleProfile,
      market: args.market,
    });
  }

  // Keine Tabelle darf an einen beliebigen Abschnitt geraten.
  const leftover = sorted.filter((t) => !assigned.has(t.index));
  if (leftover.length) {
    throw new PlanMappingError(
      `Tabelle(n) ${leftover.map((t) => t.index + 1).join(", ")} konnten keinem Quellabschnitt eindeutig zugeordnet werden. Bitte S1 erneut ausführen.`,
    );
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
