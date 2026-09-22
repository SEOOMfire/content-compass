/**
 * Artikelthema und Kategorie-Segmente (rein, testbar).
 *
 * Keine hartkodierten Länder, Domains, Pfadsegmente oder Tierarten: alles wird
 * zur Laufzeit aus Quell-URL, H1/Titel, path_map, market_paths und Link-Pool
 * abgeleitet.
 */
import { pathSegments } from "./paths";

/** Magazin-Wort, das in der URL die Magazin-Wurzel markiert. */
const MAGAZINE_WORD = /^(magazin|magazine|magazyn|ratgeber|blog|guide|conseils|poradnik|advice)$/i;

/** Normalisierte Pfadsegmente (klein, ohne leere Segmente). */
export function pathSegmentsOf(url: string): string[] {
  return pathSegments(url).map((s) => s.toLowerCase());
}

/** Grobe Singular-/Plural-Normalisierung (gemeinsamer Stamm, sprachneutral). */
export function stemSegment(s: string): string {
  const lower = s.toLowerCase().replace(/[-_]+/g, " ").trim();
  if (lower.length > 3 && lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

/** Erstes Pfadsegment unterhalb der Magazin-Wurzel, sonst null. */
export function categorySegmentOfUrl(url: string): string | null {
  const segs = pathSegments(url);
  const m = segs.findIndex((s) => MAGAZINE_WORD.test(s));
  if (m === -1) return null;
  const cat = segs[m + 1];
  if (!cat) return null;
  // Kategorie darf nicht das letzte Segment (der Slug) sein.
  if (m + 1 >= segs.length - 1) return null;
  return cat.toLowerCase();
}

/** Übersetzt ein DE-Segment über path_map → combinedMap (market_paths + derived). */
export function translateSegment(
  de: string,
  market: { path_map?: unknown },
  combinedMap: Record<string, string>,
): string | null {
  const raw = market.path_map;
  const pathMap: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) pathMap[k.toLowerCase()] = v.trim();
    }
  }
  const key = de.toLowerCase();
  return pathMap[key] ?? combinedMap[key] ?? null;
}

export interface ArticleTopic {
  main_subject_de: string;
  category_segment_de: string | null;
  category_segment_target: string | null;
  main_subject_target: string | null;
}

/** Hauptgegenstand aus H1/Titel/URL-Segment, ohne Länder-/Themenwissen. */
export function mainSubjectOf(source: { h1?: string | null; title?: string | null }, sourceUrl: string): string {
  const head = (s: string | null | undefined): string =>
    (s ?? "").split(/\s*[–—:|]\s*/)[0]?.trim() ?? "";
  const fromH1 = head(source.h1);
  if (fromH1) return fromH1;
  const fromTitle = head(source.title);
  if (fromTitle) return fromTitle;
  const segs = pathSegments(sourceUrl);
  const last = segs[segs.length - 1] ?? "";
  return last.replace(/[-_]+/g, " ").trim() || fromTitle || "Artikel";
}

/** Baut den articleTopic-Kontextschlüssel (Code, kein LLM). */
export function buildArticleTopic(args: {
  source: { h1?: string | null; title?: string | null };
  sourceUrl: string;
  slug?: { term_translated?: string } | undefined;
  market: { path_map?: unknown };
  combinedMap: Record<string, string>;
}): { topic: ArticleTopic; warning: string | null } {
  const category_segment_de = categorySegmentOfUrl(args.sourceUrl);
  const category_segment_target = category_segment_de
    ? translateSegment(category_segment_de, args.market, args.combinedMap)
    : null;
  const warning =
    category_segment_de && !category_segment_target
      ? `Kategorie-Segment „${category_segment_de}“ fehlt in path_map/market_paths – Themenfilter in S7 läuft ohne Kategorie-Bonus.`
      : null;
  return {
    topic: {
      main_subject_de: mainSubjectOf(args.source, args.sourceUrl),
      category_segment_de,
      category_segment_target,
      main_subject_target: args.slug?.term_translated ?? null,
    },
    warning,
  };
}

/**
 * Alle Themen-Segmente des Zielmarkts direkt unterhalb der Magazin-Wurzel,
 * abgeleitet aus path_map/market_paths-Werten und realen Pool-Pfaden.
 * Singular-/Plural-Varianten werden über den gemeinsamen Stamm zusammengeführt.
 */
export function getCategorySegments(
  market: { magazine_root?: string | null; path_map?: unknown },
  combinedMap: Record<string, string>,
  entries: { url: string }[],
): Set<string> {
  const rootPath = (() => {
    const r = (market.magazine_root ?? "").trim();
    if (!r) return "";
    try {
      return /^https?:\/\//i.test(r) ? new URL(r).pathname : r;
    } catch {
      return r;
    }
  })();

  const out = new Set<string>();
  const addValues = (map: Record<string, string>) => {
    for (const v of Object.values(map)) {
      const seg = v.split("/").filter(Boolean)[0];
      if (seg) out.add(stemSegment(seg));
    }
  };
  addValues(combinedMap);
  if (market.path_map && typeof market.path_map === "object" && !Array.isArray(market.path_map)) {
    addValues(market.path_map as Record<string, string>);
  }
  for (const e of entries) {
    const segs = pathSegmentsOf(e.url);
    if (!rootPath) continue;
    const rootSegs = rootPath.split("/").filter(Boolean);
    // Nur Pfade unterhalb der Magazin-Wurzel betrachten.
    if (rootSegs.length && !rootSegs.every((r, i) => segs[i] === r.toLowerCase())) continue;
    const idx = rootSegs.length;
    const cat = segs[idx];
    if (cat && idx < segs.length - 1) out.add(stemSegment(cat));
  }
  return out;
}

/** Liegt die URL auf der Magazin-Wurzel selbst oder einer reinen Übersichts-/Listenseite? */
export function isOverviewPath(
  url: string,
  magazineRoot: string | null,
): boolean {
  const root = (() => {
    const r = (magazineRoot ?? "").trim();
    if (!r) return "";
    try {
      return /^https?:\/\//i.test(r) ? new URL(r).pathname : r;
    } catch {
      return r;
    }
  })();
  const rootSegs = root.split("/").filter(Boolean).map((s) => s.toLowerCase());
  const segs = pathSegmentsOf(url);
  if (!rootSegs.length) return false;
  // Magazin-Wurzel selbst.
  if (segs.length === rootSegs.length && rootSegs.every((r, i) => segs[i] === r)) return true;
  // Wurzel + genau ein Kategorie-Segment (reine Übersichtsseite).
  if (segs.length !== rootSegs.length + 1) return false;
  return rootSegs.every((r, i) => segs[i] === r);
}
