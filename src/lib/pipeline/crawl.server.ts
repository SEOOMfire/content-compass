import { parse } from "node-html-parser";
import { fetchHtml, USER_AGENT } from "./extract.server";

export type PathType = "magazine" | "category" | "product" | "other";

export interface MarketConfig {
  id: string;
  domain: string;
  path_prefix: string | null;
  magazine_root: string | null;
  category_root: string | null;
  crawl_delay_ms: number | null;
}

export interface IndexRow {
  market_id: string;
  url: string;
  path_type: PathType;
  title: string | null;
  h1: string | null;
  breadcrumb: string | null;
  meta_description: string | null;
  intro_text: string | null;
  canonical: string | null;
  http_status: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function classifyPath(url: string, market: MarketConfig): PathType {
  const path = safePath(url);
  if (market.magazine_root && url.startsWith(market.magazine_root)) return "magazine";
  if (market.category_root && url.startsWith(market.category_root)) return "category";
  if (/\/(magazyn|magazin|magazine|ratgeber|blog|poradnik)\//.test(path)) return "magazine";
  if (/\/p\/|\/produkt|\/product/.test(path)) return "product";
  if (/\/c\/|\/kategoria|\/kategorie/.test(path)) return "category";
  return "other";
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) return "";
  return res.text();
}

export async function discoverSitemaps(domain: string): Promise<string[]> {
  const robots = await fetchText(`${domain.replace(/\/$/, "")}/robots.txt`);
  const found = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
  if (found.length) return found;
  return [`${domain.replace(/\/$/, "")}/sitemap.xml`];
}

async function readSitemap(url: string): Promise<{ urls: string[]; sitemaps: string[] }> {
  const xml = await fetchText(url);
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!);
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Sammelt URLs aus robots.txt → Sitemap-Index → Sub-Sitemaps, mit BFS-Fallback. */
export async function collectUrls(
  market: MarketConfig,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 800;
  const delay = market.crawl_delay_ms ?? 400;
  const out = new Set<string>();

  const queue = await discoverSitemaps(market.domain);
  const seenMaps = new Set<string>();
  while (queue.length && out.size < limit) {
    const sm = queue.shift()!;
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm);
    const { urls, sitemaps } = await readSitemap(sm);
    urls.forEach((u) => {
      if (u.startsWith(market.domain)) out.add(u.split("#")[0]!);
    });
    sitemaps.forEach((s) => queue.push(s));
    await sleep(delay);
  }

  if (out.size === 0) {
    const roots = [market.magazine_root, market.category_root].filter(Boolean) as string[];
    const bfs = [...roots];
    const visited = new Set<string>();
    while (bfs.length && out.size < limit) {
      const url = bfs.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      const { status, html } = await fetchHtml(url);
      if (status !== 200) continue;
      out.add(url);
      parse(html)
        .querySelectorAll("a[href]")
        .forEach((a) => {
          const href = a.getAttribute("href") ?? "";
          const abs = href.startsWith("http")
            ? href
            : href.startsWith("/")
              ? `${market.domain.replace(/\/$/, "")}${href}`
              : "";
          if (abs && abs.startsWith(market.domain) && !visited.has(abs)) bfs.push(abs.split("#")[0]!);
        });
      await sleep(delay);
    }
  }

  return [...out].slice(0, limit);
}

export async function indexPage(url: string, market: MarketConfig): Promise<IndexRow | null> {
  const { status, html, finalUrl } = await fetchHtml(url);
  if (status !== 200 || !html) return null;
  const root = parse(html);
  const h1 = root.querySelector("h1")?.text.replace(/\s+/g, " ").trim() ?? null;
  const title = root.querySelector("title")?.text.replace(/\s+/g, " ").trim() ?? null;
  const meta = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? null;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const breadcrumb =
    root
      .querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="read" i] a')
      .map((a) => a.text.trim())
      .filter(Boolean)
      .join(" / ") || null;
  const intro =
    root
      .querySelectorAll("p")
      .map((p) => p.text.replace(/\s+/g, " ").trim())
      .find((t) => t.length > 80) ?? null;

  return {
    market_id: market.id,
    url: finalUrl || url,
    path_type: classifyPath(finalUrl || url, market),
    title,
    h1,
    breadcrumb,
    meta_description: meta,
    intro_text: intro ? intro.slice(0, 600) : null,
    canonical,
    http_status: status,
  };
}
