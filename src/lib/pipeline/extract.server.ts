import { parse, type HTMLElement } from "node-html-parser";
import type { ContentLink, SourceDoc, SourceSection, SourceTable } from "./types";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; OMfireLocalizationBot/1.0; +https://www.fressnapf.de/)";

export async function fetchHtml(
  url: string,
): Promise<{ status: number; finalUrl: string; html: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const html = res.headers.get("content-type")?.includes("text/") ? await res.text() : "";
    return { status: res.status, finalUrl: res.url || url, html };
  } catch {
    // Netzwerk-/URL-Fehler dürfen die Pipeline nicht abbrechen.
    return { status: 0, finalUrl: url, html: "" };
  }
}

function textOf(el: HTMLElement | null | undefined): string {
  if (!el) return "";
  return el.structuredText.replace(/\s+/g, " ").trim();
}

/** Entfernt versehentliche Markdown-Marker aus sichtbaren HTML-Überschriften. */
export function cleanHeadingText(value: string): string {
  return value.replace(/^\s*(?:#{1,6}\s*)+/, "").replace(/\s+/g, " ").trim();
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = table.querySelectorAll("tr");
  const lines: string[] = [];
  rows.forEach((row, i) => {
    const cells = row.querySelectorAll("th,td").map((c) => textOf(c).replace(/\|/g, "\\|"));
    if (!cells.length) return;
    lines.push(`| ${cells.join(" | ")} |`);
    if (i === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });
  return lines.join("\n");
}

function insideTable(node: HTMLElement): boolean {
  let p = node.parentNode as HTMLElement | null;
  while (p) {
    if (p.tagName?.toLowerCase() === "table") return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

/** Text des ersten Textknotens eines Links (reiner Linktext ohne Teaser). */
function firstTextNodeText(el: HTMLElement): string {
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      return ((child as unknown as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/** Kürzt auf maximal n Wörter. */
function maxWords(s: string, n: number): string {
  return s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

const BLOCK_TAGS = ["p", "li", "div", "section", "article", "main", "body"];

/** Text des nächstgelegenen Block-Containers eines Links. */
function parentBlockText(el: HTMLElement): string {
  let p = el.parentNode as HTMLElement | null;
  while (p && p.tagName && !BLOCK_TAGS.includes(p.tagName.toLowerCase())) {
    p = p.parentNode as HTMLElement | null;
  }
  return p ? textOf(p) : textOf(el);
}

/** Satz aus einem Blocktext, der den Ankertext enthält (max. 300 Zeichen). */
function sentenceContaining(blockText: string, anchor: string): string {
  const clean = blockText.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const a = anchor.replace(/\s+/g, " ").trim();
  const candidates = clean.split(/(?<=[.!?;])\s+/);
  const hit = a ? candidates.find((c) => c.includes(a)) : candidates[0];
  return (hit ?? clean).trim().slice(0, 300);
}

/** "teaser" für Kachel-/Teaser-Links (langer Ankertext oder Überschrift im Link). */
function linkKind(a: HTMLElement): "inline" | "teaser" {
  const words = (a.text.match(/\S+/g) ?? []).length;
  const hasHeading = Boolean(a.querySelector("h1,h2,h3,h4,h5"));
  return words > 12 || hasHeading ? "teaser" : "inline";
}

/** Interne Links im Fließtext (nav/header/footer sind vorher entfernt), inkl. Fundstelle. */
function collectContentLinks(main: HTMLElement, pageUrl: string): ContentLink[] {
  const seen = new Set<string>();
  const out: ContentLink[] = [];
  let currentHeading = "";
  // h1/h2/h3 + a[href] in Dokumentreihenfolge → Link gehört zum letzten Abschnitt.
  for (const node of main.querySelectorAll("h1,h2,h3,a[href]")) {
    const tag = node.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      currentHeading = cleanHeadingText(textOf(node));
      continue;
    }
    const href = node.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (!sameHost(abs.toString(), pageUrl)) continue;
    if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4)$/i.test(abs.pathname)) continue;
    abs.hash = "";
    const u = abs.toString();
    if (u.replace(/\/$/, "") === pageUrl.replace(/\/$/, "")) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    const anchor = textOf(node);
    out.push({
      url: u,
      anchor,
      ...(currentHeading ? { section_heading: currentHeading } : {}),
      ...(parentBlockText(node) ? { sentence: sentenceContaining(parentBlockText(node), anchor) } : {}),
      ...(firstTextNodeText(node) ? { anchor_clean: maxWords(firstTextNodeText(node), 8) } : {}),
      kind: linkKind(node),
    });
  }
  return out;
}

export function extractDoc(url: string, finalUrl: string, status: number, html: string): SourceDoc {
  const root = parse(html);
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const title = textOf(root.querySelector("title")) || null;
  const metaDescription =
    root.querySelector('meta[name="description"]')?.getAttribute("content") ?? null;
  const hreflang = root
    .querySelectorAll('link[rel="alternate"][hreflang]')
    .map((l) => ({
      lang: l.getAttribute("hreflang") ?? "",
      href: l.getAttribute("href") ?? "",
    }))
    .filter((l) => l.lang && l.href);

  const main =
    root.querySelector("main") ??
    root.querySelector("article") ??
    root.querySelector("body") ??
    root;

  root.querySelectorAll("script,style,noscript,nav,footer,header").forEach((n) => n.remove());

  const h1 = cleanHeadingText(textOf(main.querySelector("h1"))) || null;

  const sections: SourceSection[] = [];
  let current: SourceSection = { heading: h1 ?? "Intro", level: 1, text: "" };
  const tableHeadings: Record<number, string> = {};
  let tableIdx = 0;
  main.querySelectorAll("h1,h2,h3,p,li,table").forEach((node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      if (current.text.trim()) sections.push(current);
      current = { heading: cleanHeadingText(textOf(node)), level: Number(tag[1]), text: "" };
    } else if (tag === "table") {
      tableHeadings[tableIdx] = current.heading;
      current.text += (current.text ? "\n" : "") + `[TABELLE ${tableIdx}]`;
      tableIdx++;
    } else {
      // Inhalte innerhalb von Tabellen nicht doppelt als Fließtext erfassen.
      if (insideTable(node)) return;
      const t = textOf(node);
      // Ursprüngliche Formatierung festhalten: echte Listenpunkte als "- ",
      // Absätze als eigene Zeile ohne Marker.
      if (t.length > 1) current.text += (current.text ? "\n" : "") + (tag === "li" ? `- ${t}` : t);
    }
  });
  if (current.text.trim()) sections.push(current);

  const contentLinks = collectContentLinks(main, finalUrl || url);

  const tables: SourceTable[] = main.querySelectorAll("table").map((t, i) => ({
    index: i,
    markdown: tableToMarkdown(t),
    ...(tableHeadings[i] ? { section_heading: tableHeadings[i] } : {}),
  }));

  const wordCount = sections.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  const outline = sections.map((s) => `${"#".repeat(s.level)} ${s.heading}`).join("\n");

  return {
    url,
    finalUrl,
    httpStatus: status,
    canonical,
    title,
    h1,
    metaDescription,
    hreflang,
    sections,
    tables,
    wordCount,
    outline,
    contentLinks,
  };
}

export async function extractPage(url: string): Promise<SourceDoc> {
  const { status, finalUrl, html } = await fetchHtml(url);
  return extractDoc(url, finalUrl, status, html);
}

/**
 * Ein einziger Abruf: prüft die URL (200, Canonical, Soft-404) UND liefert bei
 * Erfolg den extrahierten Seiteninhalt für die Zusammenfassung (S9).
 */
export async function verifyAndExtract(
  url: string,
): Promise<{ verification: UrlVerification; doc: SourceDoc | null }> {
  try {
    const { status, finalUrl, html } = await fetchHtml(url);
    const verification = verifyHtml(url, finalUrl, status, html);
    const doc = status === 200 ? extractDoc(url, finalUrl, status, html) : null;
    return { verification, doc };
  } catch (err) {
    return {
      verification: {
        url,
        ok: false,
        http_status: 0,
        canonical_ok: false,
        soft404: false,
        reason: err instanceof Error ? err.message : "Fehler",
      },
      doc: null,
    };
  }
}

function normalizeUrl(u: string): string {
  try {
    const p = new URL(u);
    return `${p.origin}${p.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

const SOFT_404_MARKERS = [
  "seite nicht gefunden",
  "nie znaleziono",
  "nie znaleziono strony",
  "page not found",
  "404",
  "strona nie istnieje",
];

export interface UrlVerification {
  url: string;
  ok: boolean;
  http_status: number;
  canonical_ok: boolean;
  soft404: boolean;
  reason?: string | undefined;
}

/** Prüft bereits geladenes HTML: 200, Canonical passt, kein Soft-404. */
export function verifyHtml(
  url: string,
  finalUrl: string,
  status: number,
  html: string,
): UrlVerification {
  if (status !== 200) {
    return { url, ok: false, http_status: status, canonical_ok: false, soft404: false, reason: `HTTP ${status}` };
  }
  const root = parse(html);
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const canonical_ok = canonical
    ? normalizeUrl(canonical) === normalizeUrl(finalUrl) || normalizeUrl(canonical) === normalizeUrl(url)
    : false;
  const heading = textOf(root.querySelector("h1")).toLowerCase();
  const titleText = textOf(root.querySelector("title")).toLowerCase();
  const soft404 = SOFT_404_MARKERS.some((m) => heading.includes(m) || titleText.includes(m));
  return {
    url,
    ok: canonical_ok && !soft404,
    http_status: status,
    canonical_ok,
    soft404,
    reason: soft404 ? "Soft-404" : canonical_ok ? undefined : "Canonical weicht ab oder fehlt",
  };
}

/** GET-Prüfung: 200, Canonical passt zur URL, kein Soft-404. Kein Canonical = nicht ok. */
export async function verifyUrl(url: string): Promise<UrlVerification> {
  try {
    const { status, finalUrl, html } = await fetchHtml(url);
    if (status !== 200) {
      return {
        url,
        ok: false,
        http_status: status,
        canonical_ok: false,
        soft404: false,
        reason: `HTTP ${status}`,
      };
    }
    const root = parse(html);
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
    const canonical_ok = canonical
      ? normalizeUrl(canonical) === normalizeUrl(finalUrl) || normalizeUrl(canonical) === normalizeUrl(url)
      : false;
    const heading = textOf(root.querySelector("h1")).toLowerCase();
    const titleText = textOf(root.querySelector("title")).toLowerCase();
    const soft404 = SOFT_404_MARKERS.some((m) => heading.includes(m) || titleText.includes(m));
    return {
      url,
      ok: canonical_ok && !soft404,
      http_status: status,
      canonical_ok,
      soft404,
      reason: soft404 ? "Soft-404" : canonical_ok ? undefined : "Canonical weicht ab oder fehlt",
    };
  } catch (err) {
    return {
      url,
      ok: false,
      http_status: 0,
      canonical_ok: false,
      soft404: false,
      reason: err instanceof Error ? err.message : "Fehler",
    };
  }
}
