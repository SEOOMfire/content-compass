import { z } from "zod";

/** Verbindliches Aktionsvokabular (P2-3). */
export const PLAN_ACTIONS = ["uebersetzen", "lokalisieren", "umschreiben", "streichen"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const AnchorSchema = z.object({
  anchor: z.string().min(1),
  intent: z.string().default(""),
  search_terms: z.array(z.string().min(1)).default([]),
  path_type: z.string().optional(),
  origin: z.enum(["source_link", "plan"]).optional(),
  source_url: z.string().url().nullable().optional(),
});

export const PlanSectionSchema = z.object({
  de_heading: z.string().min(1),
  target_heading: z.string().min(1),
  action: z.enum(PLAN_ACTIONS),
  notes: z.array(z.string()).default([]),
  has_table: z.boolean().default(false),
  anchors: z.array(AnchorSchema).default([]),
});

/** S2 – kanonisches Ausgabeschema. */
export const S2OutputSchema = z.object({
  term_translated: z.string().min(1),
  slug_candidates: z.array(z.string().min(1)).min(1),
});

/** S6 – Plan inkl. Anker. */
export const S6OutputSchema = z.object({
  sections: z.array(PlanSectionSchema).min(1),
});

/** S8 – nur Kandidatennummern, niemals URLs. */
export const S8OutputSchema = z.object({
  choice: z.number().int().nullable().optional(),
  candidate_index: z.number().int().nullable().optional(),
  confidence: z.string().optional(),
  reason: z.string().optional(),
});

/** S10 – lokalisierte Tabelle als Markdown. */
export const S10OutputSchema = z.object({
  table_markdown: z.string().min(1),
});

export const QaIssueSchema = z.object({
  type: z.string().min(1),
  location: z.string().default(""),
  found: z.string().min(1),
  suggestion: z.string().default(""),
});

/** S12 – jeder Befund muss strukturiert und auswertbar sein. */
export const S12OutputSchema = z.object({
  issues: z.array(QaIssueSchema).default([]),
});

export class StepSchemaError extends Error {}

/** Validiert eine Schrittausgabe. Verstoß = Fehler, kein stiller Fallback. */
export function validateStepData<S extends z.ZodType>(
  stepKey: string,
  schema: S,
  data: unknown,
): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const issues = res.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new StepSchemaError(
      `Schemaverstoß in ${stepKey}: ${issues}. Erhalten: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return res.data;
}
