import { checkExactTables, stripMarkdownTables } from "./tables";

export const MAX_SECTION_WORD_RATIO = 1.35;
export const MAX_ARTICLE_WORD_RATIO = 1.3;
/** Kleine Abweichungen in der Absatzzahl sind unkritisch (Bild-/Nachweiszeilen). */
export const PARAGRAPH_TOLERANCE = 1;

/** Vergleichsform: Tabellen zu Markern, Marker vereinheitlicht. */
export function normalizeForComparison(text: string): string {
  const stripped = stripMarkdownTables(text).text;
  return stripped
    .replace(/\[TABELLE (\d+)\]/g, (_m, i: string) => `[[OMFIRE_TABLE_${i}]]`)
    .replace(/^\s*\[\[OMFIRE_TABLE_\d+\]\]\s*$/gm, "");
}


export function countWords(text: string): number {
  return text
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\[\[[^\]]+\]\]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function countListItems(text: string): number {
  return text.split("\n").filter((line) => /^\s*[-*+]\s+\S/.test(line)).length;
}

export function countParagraphs(text: string): number {
  const withoutStructuralLines = text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*#{1,6}\s/.test(line) &&
        !/^\s*[-*+]\s+/.test(line) &&
        !/^\s*\|/.test(line) &&
        !/^\[\[OMFIRE_TABLE_\d+\]\]$/.test(line.trim()),
    )
    .join("\n");
  const separator = /\n\s*\n/.test(withoutStructuralLines) ? /\n\s*\n/ : /\n/;
  return withoutStructuralLines
    .split(separator)
    .map((block) => block.trim())
    .filter(Boolean).length;
}

/**
 * Erkennt Abschnitte, deren Quellinhalt ausschließlich aus Tabellenmarkern der
 * Form [[OMFIRE_TABLE_n]] besteht (kein Fließtext, keine Listen, keine Absätze).
 * Solche Abschnitte werden in S11 ohne LLM-Aufruf direkt zusammengesetzt.
 */
export function isTableOnlySection(sourceWithMarkers: string): boolean {
  const lines = sourceWithMarkers
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every((l) => /^\[\[OMFIRE_TABLE_\d+\]\]$/.test(l));
}

export function headingLines(text: string): string[] {
  return text.split("\n").filter((line) => /^\s*#{1,6}\s+\S/.test(line));
}

export function hasNestedHeadingMarkers(text: string): boolean {
  return text.split("\n").some((line) => /^\s*#{1,6}\s+#{1,6}\s*/.test(line));
}

export interface SectionGuardResult {
  ok: boolean;
  /** Alle Beanstandungen (hart + weich) – Grundlage für einen Korrekturversuch. */
  reasons: string[];
  /** Nur Verstöße, die einen Abschnitt unbrauchbar machen. */
  hardReasons: string[];
  /** Abweichungen, die als Hinweis genügen und den Lauf nicht stoppen. */
  softReasons: string[];
  sourceWords: number;
  targetWords: number;
}

/** Struktur- und Umfangsprüfung je Abschnitt, sprachunabhängig. */
export function checkGeneratedSection(source: string, target: string): SectionGuardResult {
  const src = normalizeForComparison(source);
  const tgt = normalizeForComparison(target);
  const sourceWords = countWords(src);
  const targetWords = countWords(tgt);
  const hardReasons: string[] = [];
  const softReasons: string[] = [];
  const sourceLists = countListItems(src);
  const targetLists = countListItems(tgt);
  if (sourceLists !== targetLists) {
    const reason = `Listenpunktzahl weicht ab (Quelle ${sourceLists}, Ziel ${targetLists}).`;
    if (Math.abs(sourceLists - targetLists) > 1) hardReasons.push(reason);
    else softReasons.push(reason);
  }
  const sourceParagraphs = countParagraphs(src);
  const targetParagraphs = countParagraphs(tgt);
  if (Math.abs(sourceParagraphs - targetParagraphs) > PARAGRAPH_TOLERANCE) {
    softReasons.push(`Absatzanzahl weicht ab (Quelle ${sourceParagraphs}, Ziel ${targetParagraphs}).`);
  }
  const headings = headingLines(tgt);
  if (headings.length !== 1) {
    hardReasons.push(`Abschnitt enthält ${headings.length} statt genau einer Überschrift.`);
  }
  if (hasNestedHeadingMarkers(tgt)) {
    hardReasons.push("Überschrift enthält verschachtelte Markdown-Marker.");
  }
  const maxWords = Math.ceil(sourceWords * MAX_SECTION_WORD_RATIO + 15);
  if (sourceWords > 0 && targetWords > maxWords) {
    softReasons.push(
      `Wortbudget überschritten (Quelle ${sourceWords}, Ziel ${targetWords}, Maximum ${maxWords}).`,
    );
  }
  return {
    ok: hardReasons.length === 0 && softReasons.length === 0,
    reasons: [...hardReasons, ...softReasons],
    hardReasons,
    softReasons,
    sourceWords,
    targetWords,
  };
}

export type IssueSeverity = "error" | "warning";

export interface ArticleGuardIssue {
  type: string;
  location: string;
  found: string;
  suggestion: string;
  severity: IssueSeverity;
}

/**
 * Nur diese Befundarten stoppen den Export. Alles andere ist ein Hinweis.
 * `marke` fehlt hier bewusst: Die LLM-Einschätzung zu Markennamen/Ansprache ist
 * zu unzuverlässig, um zu blockieren. Eine echte, falsch geschriebene Fundstelle
 * wird stattdessen deterministisch über `deterministicBrandIssues` (marke_falsch)
 * abgefangen.
 */
export const BLOCKING_ISSUE_TYPES = [
  "tabelle",
  "tabelle_fehlt",
  "tabelle_zusaetzlich",
  "claim",
  "verbotene_aussage",
];

export function issueSeverity(issue: { type: string; severity?: string }): IssueSeverity {
  if (issue.severity === "error" || issue.severity === "warning") return issue.severity;
  return BLOCKING_ISSUE_TYPES.includes(issue.type) ? "error" : "warning";
}

export function blockingIssues<T extends { type: string; severity?: string }>(issues: T[]): T[] {
  return issues.filter((i) => issueSeverity(i) === "error");
}

/** Levenshtein-Distanz für den Marken-Abgleich (kurze Eingaben, nicht hot). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Deterministische Markenprüfung (kein LLM). Blockiert nur bei einer tatsächlich
 * falsch geschriebenen Fundstelle der Marke im Zieltext. Groß-/Kleinschreibung und
 * Leer-/Bindestrich-Varianten gelten als korrekt und werden nicht beanstandet.
 */
export function deterministicBrandIssues(targetText: string, brand: string): ArticleGuardIssue[] {
  const trimmed = brand.trim();
  if (!trimmed) return [];
  const norm = trimmed.toLowerCase().replace(/[\s-]+/g, "");
  if (norm.length < 4) return [];
  const threshold = norm.length >= 8 ? 2 : 1;
  const tokens = targetText.match(/[A-Za-zÀ-ž]+/g) ?? [];
  const seen = new Set<string>();
  const issues: ArticleGuardIssue[] = [];
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (t === norm || seen.has(t)) continue;
    const dist = levenshtein(t, norm);
    if (dist >= 1 && dist <= threshold) {
      seen.add(t);
      issues.push({
        type: "marke_falsch",
        location: "Gesamtartikel",
        found: `Marke möglicherweise falsch geschrieben: „${token}“ (erwartet „${trimmed}“).`,
        suggestion: "Markennamen exakt wie vorgegeben schreiben.",
        severity: "error",
      });
    }
  }
  return issues;
}

/** Deterministische Schlussprüfung, unabhängig vom Urteil des Sprachmodells. */
export function deterministicArticleIssues(args: {
  sourceText: string;
  targetText: string;
  tables: { index: number; markdown: string }[];
  sections: { heading: string; source: string; target: string }[];
  brand?: string;
  verifiedLinks?: { anchor: string; target_url: string; section_de_heading?: string }[];
}): ArticleGuardIssue[] {
  const issues: ArticleGuardIssue[] = [];
  const tableCheck = checkExactTables(args.targetText, args.tables);
  if (tableCheck.missing.length) {
    issues.push({
      type: "tabelle_fehlt",
      location: "Gesamtartikel",
      found: `Fehlende Tabellen: ${tableCheck.missing.map((i) => i + 1).join(", ")}`,
      suggestion: "Die lokalisierten Tabellen erneut deterministisch einsetzen.",
      severity: "error",
    });
  }
  if (tableCheck.duplicated.length || tableCheck.foreign) {
    issues.push({
      type: "tabelle_zusaetzlich",
      location: "Gesamtartikel",
      found: `${tableCheck.duplicated.length} doppelte und ${tableCheck.foreign} fremde Tabellen.`,
      suggestion: "Nur die exakt lokalisierten Tabellen je einmal ausgeben.",
      severity: "error",
    });
  }
  for (const section of args.sections) {
    const result = checkGeneratedSection(section.source, section.target);
    for (const reason of result.hardReasons) {
      issues.push({
        type: "struktur",
        location: section.heading,
        found: reason,
        suggestion: "Quellstruktur exakt einhalten.",
        severity: "warning",
      });
    }
    for (const reason of result.softReasons) {
      issues.push({
        type: "struktur_hinweis",
        location: section.heading,
        found: reason,
        suggestion: "Umfang und Absatzaufteilung näher an die Quelle bringen.",
        severity: "warning",
      });
    }
  }
  const sourceWords = countWords(normalizeForComparison(args.sourceText));
  const targetWords = countWords(normalizeForComparison(args.targetText));
  const maxWords = Math.ceil(sourceWords * MAX_ARTICLE_WORD_RATIO + 25);
  if (sourceWords > 0 && targetWords > maxWords) {
    issues.push({
      type: "laenge",
      location: "Gesamtartikel",
      found: `Quelle ${sourceWords} Wörter, Ziel ${targetWords} Wörter, Maximum ${maxWords}.`,
      suggestion: "Zusätze entfernen und den Umfang an die Quelle angleichen.",
      severity: "warning",
    });
  }
  if (args.brand) {
    issues.push(...deterministicBrandIssues(args.targetText, args.brand));
  }
  // Deterministischer Link-Check (S12): verifizierte vs. tatsächlich gesetzte Links.
  if (args.verifiedLinks && args.verifiedLinks.length) {
    const used = markdownLinkUrls(args.targetText);
    if (!used.size) {
      issues.push({
        type: "keine_links",
        location: "Gesamtartikel",
        found: `${args.verifiedLinks.length} verifizierte Links, aber 0 im Text gesetzt.`,
        suggestion: "Verifizierte interne Links an den passenden Stellen in den Fließtext setzen.",
        severity: "warning",
      });
    }
    for (const l of args.verifiedLinks) {
      if (!used.has(normalizeLinkUrl(l.target_url))) {
        issues.push({
          type: "link_ungenutzt",
          location: l.section_de_heading ?? "Gesamtartikel",
          found: `Verifizierter Link ungenutzt: [${l.anchor}](${l.target_url})`,
          suggestion: "Link an der passenden Textstelle setzen oder bewusst weglassen.",
          severity: "warning",
        });
      }
    }
  }
  return issues;

}

/** Alle Ziel-URLs von Markdown-Links im Text (normalisiert, ohne Fragment). */
export function markdownLinkUrls(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    out.add(normalizeLinkUrl(m[1]!));
  }
  return out;
}

function normalizeLinkUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}