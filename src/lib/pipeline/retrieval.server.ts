export interface IndexEntry {
  url: string;
  title: string | null;
  h1: string | null;
  breadcrumb: string | null;
  meta_description: string | null;
  intro_text: string | null;
  path_type: string;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function trigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, " ");
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

function docText(e: IndexEntry): string {
  return [e.h1, e.title, e.breadcrumb, e.meta_description, e.intro_text, e.url]
    .filter(Boolean)
    .join(" ");
}

/** Hybrid-Retrieval: BM25-artige Termgewichtung + Trigramm-Ähnlichkeit. */
export function retrieve(
  query: string,
  entries: IndexEntry[],
  opts: { pathType?: string; limit?: number } = {},
): { url: string; title: string; path_type: string; score: number }[] {
  const pool = opts.pathType ? entries.filter((e) => e.path_type === opts.pathType) : entries;
  if (!pool.length) return [];

  const docs = pool.map((e) => ({ entry: e, text: docText(e), tokens: tokenize(docText(e)) }));
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d.tokens).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const N = docs.length;
  const avgLen = docs.reduce((n, d) => n + d.tokens.length, 0) / N || 1;
  const qTokens = tokenize(query);
  const qTri = trigrams(query);
  const k1 = 1.4;
  const b = 0.75;

  const scored = docs.map((d) => {
    let bm = 0;
    for (const t of qTokens) {
      const f = d.tokens.filter((x) => x === t).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      bm += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.tokens.length) / avgLen)));
    }
    const sim = dice(qTri, trigrams(d.entry.h1 ?? d.entry.title ?? d.entry.url));
    return {
      url: d.entry.url,
      title: d.entry.h1 ?? d.entry.title ?? d.entry.url,
      path_type: d.entry.path_type,
      score: bm + sim * 2,
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, opts.limit ?? 10);
}
