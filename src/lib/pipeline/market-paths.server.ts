/**
 * Pfadverzeichnis je Markt (`market_paths`).
 *
 * Ersetzt die handgepflegte `markets.path_map` als alleinige Quelle:
 * Segmentpaare (DE → Zielsprache) werden aus Sitemaps mit hreflang-Alternates
 * gelernt, aus der hreflang-Ernte übernommen oder nach Live-Prüfung einer
 * KI-Übersetzung bestätigt. Manuelle Einträge im Admin bleiben möglich.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchHtml } from "./extract.server";
import { derivePathPairs } from "./hreflang.server";

export type PathOrigin = "manual" | "sitemap" | "hreflang" | "verified";

export interface MarketPathRow {
  de_segment: string;
  target_segment: string;
  origin: PathOrigin;
  sample_url?: string | null;
  http_status?: number | null;
}

/** Alle gelernten Segmente eines Markts als Karte DE → Ziel. */
export async function loadMarketPathMap(marketId: string): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin
    .from("market_paths")
    .select("de_segment,target_segment")
    .eq("market_id", marketId);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { de_segment: string; target_segment: string }[]) {
    if (row.de_segment && row.target_segment) out[row.de_segment.toLowerCase()] = row.target_segment;
  }
  return out;
}

/** Segmentpaare speichern (eindeutig je Markt + DE-Segment). */
export async function saveMarketPaths(marketId: string, rows: MarketPathRow[]): Promise<number> {
  const clean = rows
    .map((r) => ({
      market_id: marketId,
      de_segment: r.de_segment.toLowerCase().trim(),
      target_segment: r.target_segment.trim(),
      origin: r.origin,
      sample_url: r.sample_url ?? null,
      http_status: r.http_status ?? null,
      confirmed_at: r.origin === "sitemap" || r.origin === "manual" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    .filter((r) => r.de_segment && r.target_segment);
  if (!clean.length) return 0;
  await supabaseAdmin
    .from("market_paths")
    .upsert(clean as never, { onConflict: "market_id,de_segment" });
  return clean.length;
}

function originOf(domain: string): string {
  const d = domain.replace(/\/+$/, "");
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

/** Sitemap-Adressen aus robots.txt, sonst /sitemap.xml. */
async function sitemapRoots(domain: string): Promise<string[]> {
  const base = originOf(domain);
  const { status, html } = await fetchHtml(`${base}/robots.txt`);
  const found: string[] = [];
  if (status === 200 && html) {
    for (const m of html.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) found.push(m[1]!);
  }
  return found.length ? found : [`${base}/sitemap.xml`];
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const ALT = /<xhtml:link[^>]*rel=["']alternate["'][^>]*>/gi;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return m ? m[1]! : null;
}

export interface SitemapImportResult {
  sitemaps: { url: string; status: number; urls: number; pairs: number }[];
  pairs: Record<string, string>;
  saved: number;
}

/**
 * Liest die Sitemaps der deutschen Quelle und des Zielmarkts und lernt
 * Segmentpaare aus den dort hinterlegten hreflang-Alternates.
 *
 * @param maxFiles Abrufbudget für Sitemap-Dateien (Index wird aufgelöst).
 */
export async function importPathsFromSitemaps(
  market: { id: string; domain: string; locale?: string | null },
  sourceDomain = "www.fressnapf.de",
  maxFiles = 12,
): Promise<SitemapImportResult> {
  const targetHost = new URL(originOf(market.domain)).hostname.replace(/^www\./, "");
  const queue: string[] = [
    ...(await sitemapRoots(sourceDomain)),
    ...(await sitemapRoots(market.domain)),
  ];
  const seen = new Set<string>();
  const log: SitemapImportResult["sitemaps"] = [];
  const pairs: Record<string, string> = {};
  let budget = maxFiles;

  while (queue.length && budget > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    budget--;
    const { status, html } = await fetchHtml(url);
    if (status !== 200 || !html) {
      log.push({ url, status, urls: 0, pairs: 0 });
      continue;
    }
    // Sitemap-Index: weitere Dateien einreihen.
    if (/<sitemapindex/i.test(html)) {
      const children = [...html.matchAll(LOC)].map((m) => m[1]!);
      for (const c of children.slice(0, 20)) queue.push(c);
      log.push({ url, status, urls: children.length, pairs: 0 });
      continue;
    }
    const blocks = html.split(/<url\b/i).slice(1);
    let learned = 0;
    for (const block of blocks) {
      const locMatch = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i);
      if (!locMatch) continue;
      const loc = locMatch[1]!;
      for (const tagMatch of block.matchAll(ALT)) {
        const tag = tagMatch[0];
        const href = attr(tag, "href");
        if (!href) continue;
        let host = "";
        try {
          host = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        if (host !== targetHost) continue;
        const derived = derivePathPairs(loc, href);
        for (const [k, v] of Object.entries(derived)) {
          if (!pairs[k]) {
            pairs[k] = v;
            learned++;
          }
        }
      }
    }
    log.push({ url, status, urls: blocks.length, pairs: learned });
  }

  const saved = await saveMarketPaths(
    market.id,
    Object.entries(pairs).map(([de_segment, target_segment]) => ({
      de_segment,
      target_segment,
      origin: "sitemap" as const,
    })),
  );
  return { sitemaps: log, pairs, saved };
}
