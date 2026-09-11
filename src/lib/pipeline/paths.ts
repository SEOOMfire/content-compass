/** Pfad- und hreflang-Logik der Zielermittlung (S2/S3). Rein, damit testbar. */

export interface MarketPathInfo {
  domain: string;
  locale?: string | null;
  language?: string | null;
  path_map?: unknown;
  /** Sprachpräfix des Markts, z. B. "/fr" bei fressnapf.ch. */
  path_prefix?: string | null;
}

export function pathSegments(url: string): string[] {
  try {
    const u = new URL(url);
    return u.pathname.split("/").filter(Boolean);
  } catch {
    return url.split("/").filter(Boolean);
  }
}

/** Letztes Pfadsegment der Quell-URL – Übersetzungsgrundlage für S2 (P1-2). */
export function lastPathSegment(url: string): string {
  const segs = pathSegments(url);
  return segs[segs.length - 1] ?? "";
}

function pathMapOf(market: MarketPathInfo): Record<string, string> {
  const raw = market.path_map;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k.toLowerCase()] = v.trim();
  }
  return out;
}

/** market.path_map plus abgeleitete hreflang-Paare (letztere ergänzen nur Lücken). */
export function mergedMap(
  market: MarketPathInfo,
  extraMap: Record<string, string> = {},
): Record<string, string> {
  const derived: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraMap)) {
    if (typeof v === "string" && v.trim()) derived[k.toLowerCase()] = v.trim();
  }
  return { ...derived, ...pathMapOf(market) };
}

export class PathMapError extends Error {
  constructor(public missing: string[]) {
    super(
      `Fehlende Einträge in der path_map des Markts: ${missing.join(", ")}. ` +
        `Bitte im Admin unter „Märkte" ergänzen.`,
    );
  }
}

function origin(domain: string): string {
  const d = domain.replace(/\/+$/, "");
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

/**
 * Sprachpräfix des Markts als Segmentliste (z. B. "/fr" → ["fr"]).
 * Märkte ohne Präfix liefern eine leere Liste.
 */
export function prefixSegments(market: MarketPathInfo): string[] {
  const raw = (market.path_prefix ?? "").trim();
  if (!raw || raw === "/") return [];
  return raw.split("/").filter(Boolean);
}

/** DE-Pfadsegmente ohne letztes Segment, die in keiner Karte stehen. */
export function missingSegments(
  sourceUrl: string,
  market: MarketPathInfo,
  extraMap: Record<string, string> = {},
): string[] {
  const map = mergedMap(market, extraMap);
  return pathSegments(sourceUrl)
    .slice(0, -1)
    .filter((s) => !map[s.toLowerCase()]);
}


/**
 * Übersetzt den kompletten DE-Pfad segmentweise über market.path_map und ersetzt
 * nur das letzte Segment durch den Slug-Kandidaten (P1-3).
 */
export function buildTargetUrl(
  sourceUrl: string,
  market: MarketPathInfo,
  slugCandidate: string,
  extraMap: Record<string, string> = {},
): string {
  const segs = pathSegments(sourceUrl);
  if (!segs.length) throw new PathMapError(["(kein Pfad in der Quell-URL)"]);
  const map = mergedMap(market, extraMap);
  const prefix = segs.slice(0, -1);
  const missing = prefix.filter((s) => !map[s.toLowerCase()]);
  if (missing.length) throw new PathMapError(missing);
  const translated = prefix.map((s) => map[s.toLowerCase()]!);
  const segsOut = [...prefixSegments(market), ...translated, slugCandidate];
  return `${origin(market.domain)}/${segsOut.join("/")}/`;
}

export function buildTargetUrls(
  sourceUrl: string,
  market: MarketPathInfo,
  slugCandidates: string[],
  extraMap: Record<string, string> = {},
): string[] {
  return slugCandidates.map((s) => buildTargetUrl(sourceUrl, market, s, extraMap));
}

export interface HreflangAlternate {
  lang: string;
  href: string;
}

function normLang(s: string): string {
  return s.toLowerCase().replace("_", "-").trim();
}

/** Erste Stufe der Zielermittlung: passendes Alternate zur Markt-Locale (P1-4). */
export function matchHreflang(
  alternates: HreflangAlternate[],
  locale: string | null | undefined,
): HreflangAlternate | null {
  if (!locale) return null;
  const want = normLang(locale);
  const wantLang = want.split("-")[0]!;
  return (
    alternates.find((a) => normLang(a.lang) === want) ??
    alternates.find((a) => normLang(a.lang) === wantLang) ??
    null
  );
}

/**
 * Alternates vorhanden, Ziel-Locale fehlt → starkes Indiz gegen die Existenz
 * der Zielseite. Ergebnis wird in context.target.hreflang_hint gespeichert.
 */
export function hreflangHint(
  alternates: HreflangAlternate[],
  locale: string | null | undefined,
): string | null {
  if (!alternates.length) return null;
  if (matchHreflang(alternates, locale)) return null;
  return (
    `Die Quellseite listet ${alternates.length} hreflang-Alternates ` +
    `(${alternates.map((a) => a.lang).join(", ")}), aber keine für ${locale ?? "die Ziel-Locale"}. ` +
    `Starkes Indiz, dass die Zielseite nicht existiert.`
  );
}

/**
 * Hub-Kandidaten für S7a: Elternpfad der Quell-URL über path_map übersetzt,
 * danach eine Ebene höher als Fallback.
 * /magazin/hund/rassen/mastiff/ → /magazyn/pies/rasy/ , /magazyn/pies/
 */
export function buildHubUrls(
  sourceUrl: string,
  market: MarketPathInfo,
  extraMap: Record<string, string> = {},
): string[] {
  const segs = pathSegments(sourceUrl).slice(0, -1);
  if (!segs.length) throw new PathMapError(["(kein Elternpfad in der Quell-URL)"]);
  const map = mergedMap(market, extraMap);
  const missing = segs.filter((s) => !map[s.toLowerCase()]);
  if (missing.length) throw new PathMapError(missing);
  const translated = segs.map((s) => map[s.toLowerCase()]!);
  const pre = prefixSegments(market);
  const out: string[] = [];
  for (let i = translated.length; i >= 1; i--) {
    out.push(`${origin(market.domain)}/${[...pre, ...translated.slice(0, i)].join("/")}/`);
  }
  return out;
}
