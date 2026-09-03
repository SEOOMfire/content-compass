/**
 * S7a · Link-Pool per Hub-Harvesting.
 * Ersetzt den Gesamtindex: statt Millionen URLs werden gezielt wenige Seiten
 * geladen (Hub, Navigation, Geschwisterartikel) und daraus ein Link-Pool gebildet.
 */
import { parse, type HTMLElement } from "node-html-parser";
import { fetchHtml, USER_AGENT } from "./extract.server";
import { buildHubUrls, PathMapError, type MarketPathInfo } from "./paths";
import type { PoolEntry, PoolOrigin, PoolPathType } from "./pool";

export const POOL_FETCH_BUDGET = 8;
export const SEARCH_BUDGET = 10;
export const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HubMarket extends MarketPathInfo {
  id: string;
  domain: string;
  magazine_root?: string | null;
  category_root?: string | null;
  crawl_delay_ms?: number | null;
  search_url_pattern?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function originOf(domain: string): string {
  const d = domain.replace(/\/+$/, "");
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function classify(url: string, market: HubMarket): PoolPathType {
  if (market.magazine_root && url.startsWith(market.magazine_root)) return "magazine";
  if (market.category_root && url.startsWith(market.category_root)) return "category";
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  if (/\/(magazyn|magazin|magazine|ratgeber|blog|poradnik|guide|conseils)\//.test(path))
    return "magazine";
  if (/\/(c|kategoria|kategorie|category|shop)\//.test(path)) return "category";
  return "other";
}

function containerOrigin(el: HTMLElement): PoolOrigin {
  let node: HTMLElement | null = el;
  for (let i = 0; i < 12 && node; i++) {
    const tag = node.tagName?.toLowerCase();
    const cls = `${node.getAttribute?.("class") ?? ""} ${node.getAttribute?.("id") ?? ""}`.toLowerCase();
    if (tag === "footer" || /footer/.test(cls)) return "footer";
    if (tag === "nav" || tag === "header" || /(^|\s)(nav|menu|header)/.test(cls)) return "nav";
    node = node.parentNode as HTMLElement | null;
  }
  return "inline";
}

/** Alle internen Links einer Seite mit Ankertext und Herkunft. */
export function extractLinks(
  html: string,
  pageUrl: string,
  market: HubMarket,
  defaultOrigin: PoolOrigin,
): PoolEntry[] {
  const host = new URL(originOf(market.domain)).hostname.replace(/^www\./, "");
  const root = parse(html);
  const seen = new Set<string>();
  const out: PoolEntry[] = [];
  for (const a of root.querySelectorAll("a[href]")) {
    const abs = absolutize(a.getAttribute("href") ?? "", pageUrl);
    if (!abs) continue;
    let h: string;
    try {
      h = new URL(abs).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (h !== host) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = a.text.replace(/\s+/g, " ").trim();
    const o = defaultOrigin === "hub" ? (containerOrigin(a) === "inline" ? "hub" : containerOrigin(a)) : containerOrigin(a);
    out.push({
      url: abs,
      anchor_text: text || null,
      path_type: classify(abs, market),
      origin: o,
      source_page: pageUrl,
    });
  }
  return out;
}

export interface LinkPoolResult {
  hub_url: string | null;
  entries: PoolEntry[];
  fetches: { url: string; status: number; links: number; role: string }[];
  siblings: { url: string; title: string | null; text: string }[];
}

function plainText(html: string): string {
  const root = parse(html);
  root.querySelectorAll("script,style,nav,footer,header").forEach((n) => n.remove());
  return root.text.replace(/\s+/g, " ").trim();
}

/**
 * Baut den Link-Pool mit maximal POOL_FETCH_BUDGET Abrufen:
 * 1 Hub (ggf. 1 Fallback-Ebene), 1 Startseite (Navigation), bis zu 3 Geschwisterartikel.
 */
export async function buildLinkPool(
  market: HubMarket,
  sourceUrl: string,
): Promise<LinkPoolResult> {
  const delay = market.crawl_delay_ms ?? 400;
  const fetches: LinkPoolResult["fetches"] = [];
  const entries: PoolEntry[] = [];
  const siblings: LinkPoolResult["siblings"] = [];
  let budget = POOL_FETCH_BUDGET;
  let hubUrl: string | null = null;

  const push = (list: PoolEntry[]) => {
    const known = new Set(entries.map((e) => e.url));
    list.forEach((e) => {
      if (!known.has(e.url)) {
        known.add(e.url);
        entries.push(e);
      }
    });
  };

  const load = async (url: string, role: string, origin: PoolOrigin) => {
    if (budget <= 0) return null;
    budget--;
    const { status, html, finalUrl } = await fetchHtml(url);
    const links = status === 200 && html ? extractLinks(html, finalUrl || url, market, origin) : [];
    fetches.push({ url, status, links: links.length, role });
    if (links.length) push(links);
    await sleep(delay);
    return status === 200 && html ? { html, finalUrl: finalUrl || url } : null;
  };

  // 1 · Hub-Seiten (Elternpfad über path_map übersetzt)
  let hubCandidates: string[] = [];
  try {
    hubCandidates = buildHubUrls(sourceUrl, market);
  } catch (e) {
    if (!(e instanceof PathMapError)) throw e;
    hubCandidates = [market.magazine_root, market.category_root].filter(Boolean) as string[];
    if (!hubCandidates.length) throw e;
  }
  for (const cand of hubCandidates.slice(0, 2)) {
    const res = await load(cand, "hub", "hub");
    if (res) {
      hubUrl = res.finalUrl;
      break;
    }
  }

  // 2 · Navigation von der Startseite bzw. dem Magazin-Root
  await load(market.magazine_root || originOf(market.domain), "navigation", "nav");

  // 3 · Geschwisterartikel für Stilprofil (S5) und Inline-/Footer-Links
  const hubArticles = entries
    .filter((e) => e.origin === "hub" && e.path_type === "magazine" && e.url !== hubUrl)
    .slice(0, 3);
  for (const art of hubArticles) {
    if (budget <= 0) break;
    budget--;
    const { status, html, finalUrl } = await fetchHtml(art.url);
    fetches.push({ url: art.url, status, links: 0, role: "geschwisterartikel" });
    if (status === 200 && html) {
      const links = extractLinks(html, finalUrl || art.url, market, "inline");
      push(links);
      fetches[fetches.length - 1]!.links = links.length;
      siblings.push({
        url: finalUrl || art.url,
        title: parse(html).querySelector("h1")?.text.replace(/\s+/g, " ").trim() ?? null,
        text: plainText(html).slice(0, 6000),
      });
    }
    await sleep(delay);
  }

  return { hub_url: hubUrl, entries, fetches, siblings };
}

/**
 * Stufe 2 für S7: gezielte Suche im Zielmarkt.
 * Bevorzugt die marktinterne Suche (market.search_url_pattern mit {q}),
 * sonst – falls konfiguriert – eine site:-Websuche über Firecrawl.
 */
export async function siteSearch(
  market: HubMarket,
  query: string,
): Promise<{ source: "internal" | "web" | "none"; entries: PoolEntry[] }> {
  if (market.search_url_pattern?.includes("{q}")) {
    const url = market.search_url_pattern.replace("{q}", encodeURIComponent(query));
    const { status, html, finalUrl } = await fetchHtml(url);
    if (status === 200 && html) {
      const entries = extractLinks(html, finalUrl || url, market, "inline")
        .filter((e) => e.path_type !== "other")
        .slice(0, 8)
        .map((e) => ({ ...e, origin: "search" as PoolOrigin }));
      return { source: "internal", entries };
    }
    return { source: "internal", entries: [] };
  }

  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key || !key.startsWith("fc-")) return { source: "none", entries: [] };
  const host = new URL(originOf(market.domain)).hostname;
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: `site:${host} ${query}`, limit: 5 }),
  });
  if (!res.ok) return { source: "web", entries: [] };
  const json = (await res.json()) as { data?: { url?: string; title?: string }[] };
  const entries = (json.data ?? [])
    .filter((r) => typeof r.url === "string")
    .map((r) => ({
      url: r.url!,
      anchor_text: r.title ?? null,
      path_type: classify(r.url!, market),
      origin: "search" as PoolOrigin,
      source_page: "site-search",
    }));
  return { source: "web", entries };
}

export { USER_AGENT };

/** Einzelner Hub-Abruf für S3, falls der Link-Pool noch nicht gebaut wurde. */
export async function fetchHubEntries(
  market: HubMarket,
  sourceUrl: string,
): Promise<{ hub_url: string | null; entries: PoolEntry[]; status: number }> {
  let candidates: string[] = [];
  try {
    candidates = buildHubUrls(sourceUrl, market);
  } catch (e) {
    if (!(e instanceof PathMapError)) throw e;
    candidates = [market.magazine_root, market.category_root].filter(Boolean) as string[];
  }
  for (const cand of candidates.slice(0, 2)) {
    const { status, html, finalUrl } = await fetchHtml(cand);
    if (status === 200 && html) {
      return {
        hub_url: finalUrl || cand,
        entries: extractLinks(html, finalUrl || cand, market, "hub"),
        status,
      };
    }
  }
  return { hub_url: null, entries: [], status: 0 };
}
