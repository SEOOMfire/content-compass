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
