import { parse, type HTMLElement } from "node-html-parser";
import type { SourceDoc, SourceSection, SourceTable } from "./types";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; OMfireLocalizationBot/1.0; +https://www.fressnapf.de/)";

export async function fetchHtml(
  url: string,
): Promise<{ status: number; finalUrl: string; html: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
  });
  const html = res.headers.get("content-type")?.includes("text/") ? await res.text() : "";
  return { status: res.status, finalUrl: res.url || url, html };
}

function textOf(el: HTMLElement | null | undefined): string {
  if (!el) return "";
  return el.text.replace(/\s+/g, " ").trim();
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

  const h1 = textOf(main.querySelector("h1")) || null;

  const sections: SourceSection[] = [];
  let current: SourceSection = { heading: h1 ?? "Intro", level: 1, text: "" };
  main.querySelectorAll("h1,h2,h3,p,li").forEach((node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      if (current.text.trim()) sections.push(current);
      current = { heading: textOf(node), level: Number(tag[1]), text: "" };
    } else {
      const t = textOf(node);
      if (t.length > 1) current.text += (current.text ? "\n" : "") + t;
    }
  });
  if (current.text.trim()) sections.push(current);

  const tables: SourceTable[] = main.querySelectorAll("table").map((t, i) => ({
    index: i,
    markdown: tableToMarkdown(t),
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
  };
}

export async function extractPage(url: string): Promise<SourceDoc> {
  const { status, finalUrl, html } = await fetchHtml(url);
  return extractDoc(url, finalUrl, status, html);
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
  reason?: string;
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
