import type { JobContext } from "./types";

/**
 * Abhängigkeitsprüfung (P2-1). Rückgabe = Klartextgrund, sonst null.
 * Grundlage ist der Link-Pool (S7a), nicht mehr ein Gesamtindex des Markts.
 */
export function dependencyBlocker(stepKey: string, ctx: JobContext): string | null {
  const needSource = () => (ctx.source ? null : "S1 (Quelle extrahieren) muss zuerst laufen.");
  const needPool = () =>
    ctx.linkPool?.entries?.length
      ? null
      : "S7a (Link-Pool aufbauen) muss zuerst laufen – ohne Pool gibt es keine Zielkandidaten.";
  const anchors = (ctx.plan?.sections ?? []).flatMap((s) => s.anchors ?? []);

  switch (stepKey) {
    case "S2_resolve_slug":
    case "S3_target_status":
    case "S4_compare":
    case "S7a_link_pool":
      return needSource();
    case "S7b_serp_gap":
    case "S7c_serp_opportunities":
      return ctx.source ? needPool() : needSource();

    case "S5_style_profile":
      return ctx.linkPool?.siblings?.length
        ? null
        : "S7a (Link-Pool) muss zuerst Geschwisterartikel geladen haben.";
    case "S6_localization_plan":
      return needSource();
    case "S7_link_candidates":
      return !ctx.plan?.sections?.length
        ? "S6 (Lokalisierungsplan) muss zuerst laufen."
        : !anchors.length
          ? "S6 hat keine Anker geliefert – bitte S6 erneut ausführen."
          : needPool();
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
      return ctx.content?.length ? null : "S11 (Content erzeugen) muss zuerst laufen.";
    case "S13_export":
      return !ctx.content?.length
        ? "S11 (Content erzeugen) muss zuerst laufen."
        : !ctx.qa
          ? "S12 (QA) muss zuerst erfolgreich laufen."
          : ctx.qa.issues.length
            ? `S12 enthält ${ctx.qa.issues.length} ungelöste Qualitätsfehler.`
            : null;
    default:
      return null;
  }
}
