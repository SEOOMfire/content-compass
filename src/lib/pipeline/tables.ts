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
  const rows = tableDataRows(table);
  if (!rows.length) return true;
  const haystack = text.split("\n").map(rowKey);
  const found = rows.filter((r) => haystack.includes(rowKey(r))).length;
  return found >= Math.max(1, Math.ceil(rows.length / 2));
}

/** Indizes der Tabellen, die im Zieltext fehlen. */
export function missingTableIndices(
  text: string,
  tables: { index: number; markdown: string }[],
): number[] {
  return tables.filter((t) => !tableIsPresent(text, t.markdown)).map((t) => t.index);
}
