/**
 * Primäre Kandidatenquelle: hreflang-Äquivalente der im Content der Quellseite
 * verlinkten Beiträge.
 *
 * Idee: Die deutsche Quellseite verlinkt im Fließtext thematisch passende
 * Artikel. Jeder dieser Artikel wird abgerufen und sein `hreflang`-Alternate für
 * die Ziel-Locale gelesen. Damit entstehen (a) belegte Ziel-URLs für den
 * Link-Pool und (b) eine aus echten URL-Paaren abgeleitete Pfadübersetzung
 * (`/gesundheit/` → `/health/`), die fehlende `path_map`-Einträge ersetzt.
 *
 * Marktunabhängig: es wird nichts geraten, nur ausgelesen.
 */
import { parse } from "node-html-parser";
import { fetchHtml } from "./extract.server";
import { matchHreflang, pathSegments } from "./paths";
import type { PoolEntry, PoolPathType } from "./pool";

/** Bis zu 20 im Fließtext verlinkte Nachbarseiten werden abgerufen. */
export const HREFLANG_FETCH_BUDGET = 20;
/** Mindestabstand zwischen zwei Abrufen, um die Quellseite nicht zu belasten. */
export const HREFLANG_FETCH_DELAY_MS = 1000;

const MAGAZINE_PATH =
  /\/(magazin|magazine|magazyn|ratgeber|blog|guide|conseils|poradnik|advice)(\/|$)/i;

/** Ist die URL eine redaktionelle Seite (kein Produkt, keine Kategorie)? */
export function isEditorialUrl(url: string): boolean {
  try {
    return MAGAZINE_PATH.test(new URL(url).pathname);
  } catch {
    return MAGAZINE_PATH.test(url);
  }
}

export interface HreflangMarket {
  domain: string;
  locale?: string | null;
  magazine_root?: string | null;
  category_root?: string | null;
  crawl_delay_ms?: number | null;
}

export interface HreflangHarvestResult {
  /** Ziel-URLs, die per hreflang belegt sind. */
  entries: PoolEntry[];
  /** Aus URL-Paaren abgeleitete Pfadübersetzung (DE-Segment → Zielsegment). */
  derivedPathMap: Record<string, string>;
  /** Protokoll je geprüftem Content-Link. */
  checked: { de_url: string; status: number; target_url: string | null }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(value: string): string {
  try {
    const u = /^https?:\/\//i.test(value) ? new URL(value) : new URL(`https://${value}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^www\./, "");
  }
}

function classify(url: string, market: HreflangMarket): PoolPathType {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  if (market.magazine_root && url.startsWith(market.magazine_root)) return "magazine";
  if (market.category_root && url.startsWith(market.category_root)) return "category";
  if (/\/(magazyn|magazin|magazine|ratgeber|blog|poradnik|guide|conseils)\//.test(path))
    return "magazine";
  if (/\/(c|kategoria|kategorie|category|shop)\//.test(path)) return "category";
  return "other";
}

/**
 * Segmentpaare zweier äquivalenter URLs. Nur bei gleicher Segmentanzahl, und das
 * letzte Segment (der eigentliche Slug) wird bewusst ausgelassen.
 */
export function derivePathPairs(deUrl: string, targetUrl: string): Record<string, string> {
  const de = pathSegments(deUrl);
  const tg = pathSegments(targetUrl);
  if (!de.length || de.length !== tg.length) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < de.length - 1; i++) {
    const from = de[i]!.toLowerCase();
    const to = tg[i]!;
    if (from && to) out[from] = to;
  }
  return out;
}

/** Interne Content-Links einer Seite (ohne nav/header/footer, ohne Assets). */
export function extractContentLinks(html: string, pageUrl: string): { url: string; anchor: string }[] {
  const root = parse(html);
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root;
  main.querySelectorAll("nav,header,footer,aside,script,style").forEach((n) => n.remove());
  const host = hostOf(pageUrl);
  const seen = new Set<string>();
  const out: { url: string; anchor: string }[] = [];
  for (const a of main.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (hostOf(abs.toString()) !== host) continue;
    if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4)$/i.test(abs.pathname)) continue;
    abs.hash = "";
    const url = abs.toString();
    if (url.replace(/\/$/, "") === pageUrl.replace(/\/$/, "")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, anchor: a.text.replace(/\s+/g, " ").trim() });
  }
  return out;
}

/**
 * Ruft die im Content verlinkten Beiträge ab und liest deren hreflang-Alternate
 * für die Ziel-Locale aus.
 */
export async function harvestHreflangEquivalents(
  sourceHtmlOrLinks: { url: string; anchor: string }[],
  market: HreflangMarket,
  opts: { limit?: number; delayMs?: number } = {},
): Promise<HreflangHarvestResult> {
  const limit = opts.limit ?? HREFLANG_FETCH_BUDGET;
  const delay = opts.delayMs ?? market.crawl_delay_ms ?? 300;
  const targetHost = hostOf(market.domain);
  const entries: PoolEntry[] = [];
  const derivedPathMap: Record<string, string> = {};
  const checked: HreflangHarvestResult["checked"] = [];

  for (const link of sourceHtmlOrLinks.slice(0, limit)) {
    const { status, html, finalUrl } = await fetchHtml(link.url);
    if (status !== 200 || !html) {
      checked.push({ de_url: link.url, status, target_url: null });
      await sleep(delay);
      continue;
    }
    const root = parse(html);
    const alternates = root
      .querySelectorAll('link[rel="alternate"][hreflang]')
      .map((l) => ({ lang: l.getAttribute("hreflang") ?? "", href: l.getAttribute("href") ?? "" }))
      .filter((l) => l.lang && l.href);
    const alt = matchHreflang(alternates, market.locale);
    const targetUrl = alt && hostOf(alt.href) === targetHost ? alt.href : null;
    checked.push({ de_url: finalUrl || link.url, status, target_url: targetUrl });
    if (targetUrl) {
      const title =
        root.querySelector("h1")?.text.replace(/\s+/g, " ").trim() || link.anchor || null;
      entries.push({
        url: targetUrl,
        anchor_text: link.anchor || title,
        path_type: classify(targetUrl, market),
        origin: "hreflang",
        source_page: finalUrl || link.url,
      });
      Object.assign(derivedPathMap, derivePathPairs(finalUrl || link.url, targetUrl));
    }
    await sleep(delay);
  }

  return { entries, derivedPathMap, checked };
}
