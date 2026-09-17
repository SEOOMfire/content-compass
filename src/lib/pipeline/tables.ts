/** Prüfungen für lokalisierte Tabellen (P0-2). Rein, damit testbar. */

export function tableRows(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
}

export function sameRowCount(a: string, b: string): boolean {
  return tableRows(a).length === tableRows(b).length;
}

function normalize(md: string): string {
  return md.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface MarkdownTableBlock {
  start: number;
  end: number;
  markdown: string;
}

/** Erkennt vollständige GFM-Tabellenblöcke samt Position im Text. */
export function extractMarkdownTables(text: string): MarkdownTableBlock[] {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const blocks: MarkdownTableBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i] ?? "")) continue;
    let endLine = i;
    while (endLine + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[endLine + 1] ?? "")) {
      endLine++;
    }
    const blockLines = lines.slice(i, endLine + 1);
    const hasSeparator = blockLines.some((line) => /^\s*\|[\s|:-]+\|?\s*$/.test(line));
    if (hasSeparator && blockLines.length >= 2) {
      const start = offsets[i] ?? 0;
      const end = (offsets[endLine] ?? start) + (lines[endLine]?.length ?? 0);
      blocks.push({ start, end, markdown: text.slice(start, end) });
    }
    i = endLine;
  }
  return blocks;
}

/** Entfernt alle Tabellen, die ein Modell entgegen der Vorgabe selbst erzeugt hat. */
export function stripMarkdownTables(text: string): { text: string; removed: string[] } {
  const blocks = extractMarkdownTables(text);
  let clean = text;
  for (const block of [...blocks].reverse()) {
    clean = clean.slice(0, block.start) + clean.slice(block.end);
  }
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), removed: blocks.map((b) => b.markdown) };
}

export interface ExactTableCheck {
  ok: boolean;
  missing: number[];
  duplicated: number[];
  foreign: number;
}

/** Genau eine exakte Tabelle je erwarteter Tabelle, ohne zusätzliche Modelltabellen. */
export function checkExactTables(
  text: string,
  tables: { index: number; markdown: string }[],
): ExactTableCheck {
  const actual = extractMarkdownTables(text).map((b) => normalize(b.markdown));
  const expectedCounts = new Map<string, number>();
  for (const table of tables) {
    const key = normalize(table.markdown);
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }
  const actualCounts = new Map<string, number>();
  for (const key of actual) actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  const missing: number[] = [];
  const duplicated: number[] = [];
  for (const table of tables) {
    const key = normalize(table.markdown);
    const expected = expectedCounts.get(key) ?? 0;
    const found = actualCounts.get(key) ?? 0;
    if (found < expected) missing.push(table.index);
    if (found > expected) duplicated.push(table.index);
  }
  const known = new Set(expectedCounts.keys());
  const foreign = actual.filter((key) => !known.has(key)).length;
  return {
    ok: missing.length === 0 && duplicated.length === 0 && foreign === 0,
    missing: [...new Set(missing)],
    duplicated: [...new Set(duplicated)],
    foreign,
  };
}

export interface TableCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Harte Prüfungen: gleiche Zeilenzahl und – bei Zielsprache ≠ Deutsch –
 * tatsächlich verändertes Ergebnis.
 */
export function checkLocalizedTable(
  original: string,
  localized: string,
  language: string,
): TableCheck {
  if (!localized.trim()) return { ok: false, reason: "Leere Tabellenausgabe." };
  if (!sameRowCount(original, localized)) {
    return {
      ok: false,
      reason: `Zeilenzahl weicht ab (Original ${tableRows(original).length}, Ausgabe ${tableRows(localized).length}).`,
    };
  }
  const isGerman = /deutsch|german/i.test(language);
  if (!isGerman && normalize(original) === normalize(localized)) {
    return { ok: false, reason: "Tabelle wurde nicht lokalisiert." };
  }
  return { ok: true };
}

/** Datenzeilen ohne Trennzeile (|---|---|). */
export function tableDataRows(md: string): string[] {
  return tableRows(md).filter((r) => !/^\|[\s|:-]+\|?$/.test(r));
}

function rowKey(row: string): string {
  return row.replace(/\s+/g, " ").replace(/\s*\|\s*/g, "|").trim().toLowerCase();
}

/**
 * Harte Schlussprüfung: Ist die Tabelle im Zieltext tatsächlich enthalten?
 * Kriterium: mindestens die Hälfte der Datenzeilen (mind. 1) steht wörtlich im Text.
 */
export function tableIsPresent(text: string, table: string): boolean {
  return extractMarkdownTables(text).some((block) => normalize(block.markdown) === normalize(table));
}

/** Indizes der Tabellen, die im Zieltext fehlen. */
export function missingTableIndices(
  text: string,
  tables: { index: number; markdown: string }[],
): number[] {
  return tables.filter((t) => !tableIsPresent(text, t.markdown)).map((t) => t.index);
}
