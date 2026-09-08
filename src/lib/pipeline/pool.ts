/**
 * Link-Pool statt Gesamtindex (Hub-Harvesting). Rein, damit testbar.
 * Der Pool ersetzt den url_index als Kandidatenquelle für S3 und S7.
 */

export type PoolPathType = "magazine" | "category" | "other";
export type PoolOrigin =
  | "hub"
  | "nav"
  | "inline"
  | "footer"
  | "search"
  | "hreflang"
  | "candidate";

/**
 * `scope`:
 *  - "target"           – belegte URL im Zielmarkt, direkt verwendbar
 *  - "source_candidate" – deutsche Quell-URL, noch ohne geprüftes hreflang.
 *    Darf erst nach einem Abruf (fetched = true) verwendet werden.
 */
export type PoolScope = "target" | "source_candidate";

export interface PoolEntry {
  url: string;
  anchor_text: string | null;
  path_type: PoolPathType;
  origin: PoolOrigin;
  source_page: string;
  breadcrumb?: string | null;
  /** Wurde die Seite tatsächlich abgerufen? */
  fetched?: boolean;
  /** Kurzbeschreibung der Seite – nur vorhanden, wenn abgerufen wurde. */
  intent?: string | null;
  scope?: PoolScope;
}

/** Nur belegte Ziel-URLs sind unmittelbar verwendbar. */
export function isUsable(e: PoolEntry): boolean {
  return e.scope !== "source_candidate" && e.fetched !== false;
}

/** Mindest-Score, unterhalb dessen Stufe 2 (Site-Suche) ausgelöst wird. */
export const MIN_POOL_SCORE = 0.6;

export function slugOf(url: string): string {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    return (segs[segs.length - 1] ?? "").replace(/[-_]+/g, " ");
  } catch {
    return "";
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function trigrams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((g) => {
    if (b.has(g)) inter++;
  });
  return (2 * inter) / (a.size + b.size);
}

function entryText(e: PoolEntry): string {
  return [e.anchor_text, slugOf(e.url), e.breadcrumb].filter(Boolean).join(" ");
}

export interface PoolHit {
  url: string;
  title: string;
  path_type: string;
  origin: PoolOrigin;
  score: number;
}

/** Stufe 1: Termgewichtung über Ankertext, URL-Slug und Breadcrumb + Trigramme. */
export function retrieveFromPool(
  query: string,
  entries: PoolEntry[],
  opts: { pathType?: string | undefined; limit?: number } = {},
): PoolHit[] {
  const usable = entries.filter(isUsable);
  const pool =
    opts.pathType && opts.pathType !== "other"
      ? usable.filter((e) => e.path_type === opts.pathType)
      : usable;
  if (!pool.length) return [];
  const qTokens = tokens(query);
  const qTri = trigrams(query);
  const df = new Map<string, number>();
  const docs = pool.map((e) => {
    const text = entryText(e);
    const tk = tokens(text);
    new Set(tk).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
    return { e, text, tk };
  });
  const N = docs.length;

  const scored = docs.map((d) => {
    let score = 0;
    for (const t of qTokens) {
      if (!d.tk.includes(t)) continue;
      score += Math.log(1 + N / ((df.get(t) ?? 0) + 0.5));
    }
    score += dice(qTri, trigrams(d.text)) * 2;
    return {
      url: d.e.url,
      title: d.e.anchor_text || slugOf(d.e.url) || d.e.url,
      path_type: d.e.path_type,
      origin: d.e.origin,
      score,
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8);
}

/**
 * S3-Stufe 2: Passt ein Eintrag der Hub-Liste zum übersetzten Quellbegriff?
 * Fuzzy über Ankertext und Slug.
 */
export function matchHubEntry(
  entries: PoolEntry[],
  term: string,
  slugCandidates: string[] = [],
): { entry: PoolEntry; score: number } | null {
  const hub = entries.filter((e) => e.origin === "hub" && isUsable(e));
  if (!hub.length) return null;
  const wanted = [term, ...slugCandidates].filter(Boolean).map(norm);
  let best: { entry: PoolEntry; score: number } | null = null;
  for (const e of hub) {
    const fields = [norm(e.anchor_text ?? ""), norm(slugOf(e.url))].filter(Boolean);
    let score = 0;
    for (const w of wanted) {
      for (const f of fields) {
        if (!w || !f) continue;
        if (w === f) score = Math.max(score, 1);
        else score = Math.max(score, dice(trigrams(w), trigrams(f)));
      }
    }
    if (!best || score > best.score) best = { entry: e, score };
  }
  return best && best.score >= 0.72 ? best : null;
}

export interface SearchLogEntry {
  anchor: string;
  search_terms: string[];
  stage2: boolean;
  stage2_source?: "internal" | "web" | "none";
  hits: number;
}

export interface GapEntry {
  anchor: string;
  search_terms: string[];
  stage2_run: boolean;
  reason: string;
}

/** Gap-Report für S13: Anker ohne verifizierten Link. */
export function buildGapReport(
  anchors: { anchor: string; search_terms?: string[] }[],
  verified: { anchor: string }[],
  log: SearchLogEntry[],
): GapEntry[] {
  const done = new Set(verified.map((v) => v.anchor));
  const byAnchor = new Map(log.map((l) => [l.anchor, l]));
  return anchors
    .filter((a) => !done.has(a.anchor))
    .map((a) => {
      const l = byAnchor.get(a.anchor);
      const stage2 = Boolean(l?.stage2);
      return {
        anchor: a.anchor,
        search_terms: l?.search_terms ?? a.search_terms ?? [],
        stage2_run: stage2,
        reason: !l
          ? "nicht gesucht"
          : stage2
            ? l.hits
              ? "Kandidaten gefunden, aber keiner bestand die HTTP-Prüfung"
              : "im Zielmarkt nicht gefunden (Pool + Site-Suche)"
            : "keine Poolkandidaten, Site-Suche nicht ausgelöst",
      };
    });
}
