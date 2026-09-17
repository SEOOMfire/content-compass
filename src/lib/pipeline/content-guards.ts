import { checkExactTables } from "./tables";

export const MAX_SECTION_WORD_RATIO = 1.25;
export const MAX_ARTICLE_WORD_RATIO = 1.2;

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
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block &&
        !/^#{1,6}\s/.test(block) &&
        !/^\s*[-*+]\s/m.test(block) &&
        !/^\s*\|/.test(block) &&
        !/^\[\[OMFIRE_TABLE_\d+\]\]$/.test(block),
    ).length;
}

export function headingLines(text: string): string[] {
  return text.split("\n").filter((line) => /^\s*#{1,6}\s+\S/.test(line));
}

export function hasNestedHeadingMarkers(text: string): boolean {
  return text.split("\n").some((line) => /^\s*#{1,6}\s+#{1,6}\s*/.test(line));
}

export interface SectionGuardResult {
  ok: boolean;
  reasons: string[];
  sourceWords: number;
  targetWords: number;
}

/** Harte, sprachunabhängige Struktur- und Umfangsprüfung je Abschnitt. */
export function checkGeneratedSection(source: string, target: string): SectionGuardResult {
  const sourceWords = countWords(source);
  const targetWords = countWords(target);
  const reasons: string[] = [];
  const sourceLists = countListItems(source);
  const targetLists = countListItems(target);
  if (sourceLists !== targetLists) {
    reasons.push(`Listenpunktzahl weicht ab (Quelle ${sourceLists}, Ziel ${targetLists}).`);
  }
  const sourceParagraphs = countParagraphs(source);
  const targetParagraphs = countParagraphs(target);
  if (sourceParagraphs !== targetParagraphs) {
    reasons.push(`Absatzanzahl weicht ab (Quelle ${sourceParagraphs}, Ziel ${targetParagraphs}).`);
  }
  const headings = headingLines(target);
  if (headings.length !== 1) reasons.push(`Abschnitt enthält ${headings.length} statt genau einer Überschrift.`);
  if (hasNestedHeadingMarkers(target)) reasons.push("Überschrift enthält verschachtelte Markdown-Marker.");
  const maxWords = Math.ceil(sourceWords * MAX_SECTION_WORD_RATIO + 5);
  if (sourceWords > 0 && targetWords > maxWords) {
    reasons.push(`Wortbudget überschritten (Quelle ${sourceWords}, Ziel ${targetWords}, Maximum ${maxWords}).`);
  }
  return { ok: reasons.length === 0, reasons, sourceWords, targetWords };
}

export interface ArticleGuardIssue {
  type: string;
  location: string;
  found: string;
  suggestion: string;
}

/** Deterministische Schlussprüfung, unabhängig vom Urteil des Sprachmodells. */
export function deterministicArticleIssues(args: {
  sourceText: string;
  targetText: string;
  tables: { index: number; markdown: string }[];
  sections: { heading: string; source: string; target: string }[];
}): ArticleGuardIssue[] {
  const issues: ArticleGuardIssue[] = [];
  const tableCheck = checkExactTables(args.targetText, args.tables);
  if (tableCheck.missing.length) {
    issues.push({
      type: "tabelle_fehlt",
      location: "Gesamtartikel",
      found: `Fehlende Tabellen: ${tableCheck.missing.map((i) => i + 1).join(", ")}`,
      suggestion: "Die lokalisierten Tabellen erneut deterministisch einsetzen.",
    });
  }
  if (tableCheck.duplicated.length || tableCheck.foreign) {
    issues.push({
      type: "tabelle_zusaetzlich",
      location: "Gesamtartikel",
      found: `${tableCheck.duplicated.length} doppelte und ${tableCheck.foreign} fremde Tabellen.`,
      suggestion: "Nur die exakt lokalisierten Tabellen je einmal ausgeben.",
    });
  }
  for (const section of args.sections) {
    const result = checkGeneratedSection(section.source, section.target);
    for (const reason of result.reasons) {
      issues.push({ type: "struktur", location: section.heading, found: reason, suggestion: "Quellstruktur und Wortbudget exakt einhalten." });
    }
  }
  const sourceWords = countWords(args.sourceText);
  const targetWords = countWords(args.targetText);
  const maxWords = Math.ceil(sourceWords * MAX_ARTICLE_WORD_RATIO + 10);
  if (sourceWords > 0 && targetWords > maxWords) {
    issues.push({
      type: "laenge",
      location: "Gesamtartikel",
      found: `Quelle ${sourceWords} Wörter, Ziel ${targetWords} Wörter, Maximum ${maxWords}.`,
      suggestion: "Zusätze entfernen und den Umfang an die Quelle angleichen.",
    });
  }
  return issues;
}