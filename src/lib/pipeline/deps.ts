import type { JobContext } from "./types";

/** Abhängigkeitsprüfung (P2-1). Rückgabe = Klartextgrund, sonst null. */
export function dependencyBlocker(
  stepKey: string,
  ctx: JobContext,
  indexCount: number,
): string | null {
  const needSource = () => (ctx.source ? null : "S1 (Quelle extrahieren) muss zuerst laufen.");
  const needIndex = () =>
    indexCount > 0
      ? null
      : 'Der URL-Index dieses Markts ist leer. Bitte zuerst im Admin „Index aufbauen" ausführen.';
  const anchors = (ctx.plan?.sections ?? []).flatMap((s) => s.anchors ?? []);

  switch (stepKey) {
    case "S2_resolve_slug":
    case "S3_target_status":
      return needSource();
    case "S4_compare":
      return needSource();
    case "S5_style_profile":
      return needIndex();
    case "S6_localization_plan":
      return needSource();
    case "S7_link_candidates":
      return !ctx.plan?.sections?.length
        ? "S6 (Lokalisierungsplan) muss zuerst laufen."
        : !anchors.length
          ? "S6 hat keine Anker geliefert – bitte S6 erneut ausführen."
          : needIndex();
    case "S8_link_select":
      return Object.values(ctx.linkCandidates ?? {}).some((l) => l.length)
        ? null
        : "S7 hat keinen einzigen Linkkandidaten geliefert.";
    case "S10_localize_tables":
      return needSource();
    case "S11_generate_content": {
      if (!ctx.source) return needSource();
      if (!ctx.plan?.sections?.length) return "S6 (Lokalisierungsplan) muss zuerst laufen.";
      if (!ctx.styleProfile) return "S5 (Stilprofil) muss zuerst erfolgreich laufen.";
      if (ctx.source.tables.length && !ctx.tables)
        return "S10 (Tabellen lokalisieren) muss zuerst laufen.";
      return null;
    }
    case "S12_qa":
    case "S13_export":
      return ctx.content?.length ? null : "S11 (Content erzeugen) muss zuerst laufen.";
    default:
      return null;
  }
}
