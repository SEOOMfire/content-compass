import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PIPELINE, STEP_BY_KEY, type JobContext, type PlanSection } from "./types";
import { extractPage, verifyUrl } from "./extract.server";
import { runPrompt, type PromptTemplateRow } from "./ai.server";
import { retrieve, type IndexEntry } from "./retrieval.server";

type MarketRow = Record<string, unknown> & {
  id: string;
  country: string;
  language: string;
  domain: string;
  brand: string | null;
  language_variant: string | null;
  magazine_root: string | null;
  category_root: string | null;
  address_form: string | null;
  closing_note: string | null;
  forbidden_claims: unknown;
  institutions: unknown;
  path_map: unknown;
};

async function loadTemplate(stepKey: string): Promise<PromptTemplateRow> {
  const { data, error } = await supabaseAdmin
    .from("prompt_templates")
    .select("*")
    .eq("step_key", stepKey)
    .maybeSingle();
  if (error || !data) throw new Error(`Prompt-Template "${stepKey}" nicht gefunden.`);
  return data as unknown as PromptTemplateRow;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface StepRunResult {
  output: unknown;
  context: Partial<JobContext>;
  model?: string;
  promptSnapshot?: string;
}

export async function runStep(
  stepKey: string,
  job: { id: string; source_url: string; context: JobContext },
  market: MarketRow,
): Promise<StepRunResult> {
  const ctx = job.context ?? {};

  switch (stepKey) {
    case "S1_extract_source": {
      const doc = await extractPage(job.source_url);
      if (doc.httpStatus !== 200) throw new Error(`Quelle antwortete mit HTTP ${doc.httpStatus}.`);
      return { output: { ...doc, sections: doc.sections.length }, context: { source: doc } };
    }

    case "S2_resolve_slug": {
      const source = requireSource(ctx);
      const tpl = await loadTemplate("resolve_target_slug");
      const res = await runPrompt<{ term_translated: string; slug_candidates?: string[] }>(tpl, {
        term: source.h1 ?? source.title ?? job.source_url,
        language: market.language,
        country: market.country,
      });
      const term = res.data.term_translated ?? "";
      const candidates = (res.data.slug_candidates ?? [term]).map(slugify).filter(Boolean);
      return {
        output: res.data,
        context: { slug: { term_translated: term, slug_candidates: candidates } },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
      };
    }

    case "S3_target_status": {
      const slug = ctx.slug;
      if (!slug) throw new Error("Schritt S2 muss zuerst laufen.");
      const base = (market.magazine_root ?? market.domain).replace(/\/$/, "");
      const urls = slug.slug_candidates.map((s) => `${base}/${s}/`);

      const { data: indexHits } = await supabaseAdmin
        .from("url_index")
        .select("url,h1,title")
        .eq("market_id", market.id)
        .in("url", urls);

      const checked: { url: string; status: number }[] = [];
      let found: string | null = null;
      for (const url of urls) {
        const v = await verifyUrl(url);
        checked.push({ url, status: v.http_status });
        if (v.ok) {
          found = url;
          break;
        }
      }

      const status = found
        ? "EXISTS"
        : checked.some((c) => c.status === 404)
          ? "VERIFIED_404"
          : (indexHits?.length ?? 0) === 0
            ? "NOT_IN_INDEX"
            : "VERIFIED_404";

      const doc = found ? await extractPage(found) : null;
      return {
        output: { status, url: found, checked },
        context: { target: { status, url: found, checked, doc } },
      };
    }

    case "S4_compare": {
      const source = requireSource(ctx);
      if (!ctx.target?.doc) {
        return {
          output: { skipped: true, reason: "Kein bestehender Zielinhalt – Neuerstellung." },
          context: { compare: { new_page: true } },
        };
      }
      const tpl = await loadTemplate("compare");
      const t = ctx.target.doc;
      const res = await runPrompt(tpl, {
        de_structure: source.outline,
        de_word_count: source.wordCount,
        target_structure: t.outline,
        target_word_count: t.wordCount,
        target_excerpt: t.sections
          .map((s) => s.text)
          .join("\n")
          .slice(0, 4000),
      });
      return {
        output: res.data,
        context: { compare: res.data },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
      };
    }

    case "S5_style_profile": {
      const { data: cached } = await supabaseAdmin
        .from("style_profiles")
        .select("profile")
        .eq("market_id", market.id)
        .eq("content_type", "magazine")
        .maybeSingle();
      if (cached?.profile) {
        return { output: { cached: true, profile: cached.profile }, context: { styleProfile: cached.profile } };
      }
      const { data: refs } = await supabaseAdmin
        .from("url_index")
        .select("h1,title,meta_description,intro_text")
        .eq("market_id", market.id)
        .eq("path_type", "magazine")
        .limit(12);
      const referenceTexts = (refs ?? [])
        .map((r) => [r.h1, r.meta_description, r.intro_text].filter(Boolean).join("\n"))
        .join("\n---\n");
      if (!referenceTexts.trim()) {
        throw new Error("Keine Referenztexte im Index – bitte zuerst den URL-Index aufbauen.");
      }
      const tpl = await loadTemplate("style_profile");
      const res = await runPrompt(tpl, { reference_texts: referenceTexts.slice(0, 12000) });
      await supabaseAdmin
        .from("style_profiles")
        .insert({ market_id: market.id, content_type: "magazine", profile: res.data as never });
      return {
        output: res.data,
        context: { styleProfile: res.data },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
      };
    }

    case "S6_localization_plan": {
      const source = requireSource(ctx);
      const tpl = await loadTemplate("localization_plan");
      const res = await runPrompt<{ sections?: PlanSection[] }>(tpl, {
        de_outline: source.sections
          .map((s) => `${"#".repeat(s.level)} ${s.heading}\n${s.text.slice(0, 500)}`)
          .join("\n\n"),
        market_profile: {
          country: market.country,
          language: market.language,
          brand: market.brand,
          institutions: market.institutions,
          forbidden_claims: market.forbidden_claims,
          address_form: market.address_form,
        },
        country: market.country,
        language: market.language,
      });
      const sections = res.data.sections ?? [];
      return {
        output: res.data,
        context: { plan: { sections } },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
      };
    }

    case "S7_link_candidates": {
      const plan = ctx.plan?.sections ?? [];
      const anchors = plan.flatMap((s) => s.anchors ?? []);
      if (!anchors.length) return { output: { anchors: 0 }, context: { linkCandidates: {} } };
      const { data: rows } = await supabaseAdmin
        .from("url_index")
        .select("url,title,h1,breadcrumb,meta_description,intro_text,path_type")
        .eq("market_id", market.id)
        .limit(1000);
      const entries = (rows ?? []) as IndexEntry[];
      const candidates: Record<string, { url: string; title: string; path_type: string }[]> = {};
      for (const a of anchors) {
        const opts = a.path_type ? { pathType: a.path_type, limit: 8 } : { limit: 8 };
        candidates[a.anchor] = retrieve(`${a.anchor} ${a.intent ?? ""}`, entries, opts).map((c) => ({
          url: c.url,
          title: c.title,
          path_type: c.path_type,
        }));
      }
      return { output: candidates, context: { linkCandidates: candidates } };
    }

    case "S8_link_select": {
      const candidates = ctx.linkCandidates ?? {};
      const tpl = await loadTemplate("link_select");
      const selection: { anchor: string; url: string | null; confidence?: string }[] = [];
      let snapshot = "";
      for (const [anchor, list] of Object.entries(candidates)) {
        if (!list.length) {
          selection.push({ anchor, url: null });
          continue;
        }
        const res = await runPrompt<{ candidate_index?: number | null; confidence?: string }>(tpl, {
          anchor,
          context_sentence: anchor,
          candidates: list.map((c, i) => `${i + 1}. ${c.title} [${c.path_type}]`).join("\n"),
        });
        snapshot = res.promptSnapshot;
        const idx = res.data.candidate_index;
        const chosen = typeof idx === "number" && idx >= 1 && idx <= list.length ? list[idx - 1]! : null;
        selection.push({
          anchor,
          url: chosen?.url ?? null,
          ...(res.data.confidence ? { confidence: res.data.confidence } : {}),
        });
      }
      return { output: selection, context: { linkSelection: selection }, promptSnapshot: snapshot };
    }

    case "S9_link_verify": {
      const selection = ctx.linkSelection ?? [];
      const verified: JobContext["verifiedLinks"] = [];
      await supabaseAdmin.from("verified_links").delete().eq("job_id", job.id);
      for (const s of selection) {
        if (!s.url) continue;
        const v = await verifyUrl(s.url);
        if (!v.ok) continue;
        const row = {
          anchor: s.anchor,
          target_url: s.url,
          http_status: v.http_status,
          canonical_ok: v.canonical_ok,
          ...(s.confidence ? { confidence: s.confidence } : {}),
        };
        verified.push(row);
        await supabaseAdmin.from("verified_links").insert({ job_id: job.id, source: "index", ...row });
      }
      return { output: verified, context: { verifiedLinks: verified } };
    }

    case "S10_localize_tables": {
      const source = requireSource(ctx);
      if (!source.tables.length) return { output: [], context: { tables: [] } };
      const tpl = await loadTemplate("localize_table");
      const tables: { index: number; markdown: string }[] = [];
      for (const t of source.tables) {
        const res = await runPrompt<{ table_markdown?: string } | string>(tpl, {
          table_markdown: t.markdown,
          language: market.language,
          market_notes: `Land: ${market.country}. Institutionen: ${JSON.stringify(market.institutions)}`,
        });
        const md =
          typeof res.data === "string" ? res.data : (res.data.table_markdown ?? t.markdown);
        tables.push({ index: t.index, markdown: md });
      }
      return { output: tables, context: { tables } };
    }

    case "S11_generate_content": {
      const source = requireSource(ctx);
      const plan = ctx.plan?.sections ?? [];
      const tpl = await loadTemplate("generate_content");
      const written: string[] = [];
      const content: { heading: string; markdown: string }[] = [];
      const linksForPrompt = (ctx.verifiedLinks ?? [])
        .map((l) => `- [${l.anchor}](${l.target_url})`)
        .join("\n");
      const tableMd = (ctx.tables ?? []).map((t) => t.markdown).join("\n\n");

      const sections = plan.length
        ? plan
        : source.sections.map((s) => ({ heading: s.heading, action: "adapt" as const, notes: "" }));

      for (const section of sections) {
        if (section.action === "drop") continue;
        const de = source.sections.find((s) => s.heading === section.heading);
        const res = await runPrompt<string>(tpl, {
          language: market.language,
          language_variant: market.language_variant ?? "",
          brand: market.brand ?? "",
          address_form: market.address_form ?? "",
          style_profile: ctx.styleProfile ?? {},
          style_example: "",
          de_section: `## ${section.heading}\n${de?.text ?? ""}`,
          action: section.action,
          localization_notes: section.notes ?? "",
          written_headings: written.join(", "),
          verified_links: linksForPrompt,
          table_markdown: tableMd,
        });
        const md = typeof res.data === "string" ? res.data : String(res.data);
        written.push(section.heading);
        content.push({ heading: section.heading, markdown: md.trim() });
      }
      return { output: content, context: { content } };
    }

    case "S12_qa": {
      const full = (ctx.content ?? []).map((c) => c.markdown).join("\n\n");
      if (!full.trim()) throw new Error("Kein Content vorhanden – bitte S11 ausführen.");
      const tpl = await loadTemplate("qa");
      const res = await runPrompt(tpl, {
        full_text: full,
        brand: market.brand ?? "",
        forbidden_terms: market.forbidden_claims ?? [],
        language: market.language,
      });
      return {
        output: res.data,
        context: { qa: res.data },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
      };
    }

    case "S13_export": {
      const source = requireSource(ctx);
      const md = [
        `# ${ctx.slug?.term_translated ?? source.h1 ?? ""}`,
        "",
        `> Quelle: ${source.url}`,
        `> Zielstatus: ${ctx.target?.status ?? "-"}${ctx.target?.url ? ` (${ctx.target.url})` : ""}`,
        "",
        ...(ctx.content ?? []).map((c) => c.markdown),
        "",
        "## Verifizierte Links",
        ...(ctx.verifiedLinks ?? []).map(
          (l) => `- [${l.anchor}](${l.target_url}) — HTTP ${l.http_status}`,
        ),
        market.closing_note ? `\n${market.closing_note}` : "",
      ].join("\n");
      return { output: { length: md.length }, context: { exportMarkdown: md } };
    }

    default:
      throw new Error(`Unbekannter Schritt: ${stepKey}`);
  }
}

function requireSource(ctx: JobContext) {
  if (!ctx.source) throw new Error("Schritt S1 muss zuerst laufen.");
  return ctx.source;
}

/** Führt einen Schritt aus, persistiert Status/Kontext idempotent. */
export async function executeStep(jobId: string, stepKey: string) {
  const def = STEP_BY_KEY[stepKey];
  if (!def) throw new Error(`Unbekannter Schritt: ${stepKey}`);

  const { data: job, error } = await supabaseAdmin
    .from("jobs")
    .select("*, markets(*)")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error("Job nicht gefunden.");
  const market = (job as unknown as { markets: MarketRow }).markets;
  const context = ((job as { context?: JobContext }).context ?? {}) as JobContext;

  const started = Date.now();
  await upsertStep(jobId, def.key, def.order, {
    status: "running",
    error: null,
    input: describeStepInput(def.key, context, market, job.source_url) as never,
  });
  await supabaseAdmin.from("jobs").update({ current_step: def.key, status: "running" }).eq("id", jobId);

  try {
    const result = await runStep(stepKey, { id: jobId, source_url: job.source_url, context }, market);
    const nextContext = { ...context, ...result.context };
    await supabaseAdmin
      .from("jobs")
      .update({
        context: nextContext as never,
        current_step: def.key,
        status: def.order === PIPELINE.length ? "done" : "idle",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await upsertStep(jobId, def.key, def.order, {
      status: "done",
      output: (result.output ?? null) as never,
      error: null,
      duration_ms: Date.now() - started,
      ...(result.model ? { model: result.model } : {}),
      ...(result.promptSnapshot ? { prompt_snapshot: result.promptSnapshot } : {}),
    });
    return { ok: true as const, output: result.output };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    await upsertStep(jobId, def.key, def.order, {
      status: "error",
      error: message,
      duration_ms: Date.now() - started,
    });
    await supabaseAdmin.from("jobs").update({ status: "error" }).eq("id", jobId);
    return { ok: false as const, error: message };
  }
}

async function upsertStep(
  jobId: string,
  stepKey: string,
  order: number,
  patch: Record<string, unknown>,
) {
  const { data: existing } = await supabaseAdmin
    .from("job_steps")
    .select("id,run_count")
    .eq("job_id", jobId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("job_steps")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        run_count: patch["status"] === "running" ? (existing.run_count ?? 0) + 1 : existing.run_count,
      } as never)
      .eq("id", existing.id);
  } else {
    await supabaseAdmin
      .from("job_steps")
      .insert({ job_id: jobId, step_key: stepKey, step_order: order, ...patch } as never);
  }
}

/** Kompakter Snapshot dessen, was ein Schritt als Eingabe erhalten hat. */
function describeStepInput(
  stepKey: string,
  ctx: JobContext,
  market: MarketRow,
  sourceUrl: string,
): Record<string, unknown> {
  const marketInfo = {
    country: market.country,
    language: market.language,
    domain: market.domain,
    brand: market.brand,
    magazine_root: market.magazine_root,
  };
  const clip = (s: string | null | undefined, n = 1500) =>
    s ? (s.length > n ? `${s.slice(0, n)}… [gekürzt]` : s) : null;

  switch (stepKey) {
    case "S1_extract_source":
      return { source_url: sourceUrl, market: marketInfo };
    case "S2_resolve_slug":
      return {
        market: marketInfo,
        term: ctx.source?.h1 ?? ctx.source?.title ?? sourceUrl,
      };
    case "S3_target_status":
      return { market: marketInfo, slug: ctx.slug };
    case "S4_compare":
      return {
        de_outline: clip(ctx.source?.outline),
        de_word_count: ctx.source?.wordCount,
        target_status: ctx.target?.status,
        target_url: ctx.target?.url,
        target_outline: clip(ctx.target?.doc?.outline ?? null),
      };
    case "S5_style_profile":
      return { market: marketInfo, content_type: "magazine" };
    case "S6_localization_plan":
      return {
        market: marketInfo,
        institutions: market.institutions,
        forbidden_claims: market.forbidden_claims,
        de_sections: ctx.source?.sections.map((s) => s.heading),
      };
    case "S7_link_candidates":
      return {
        market: marketInfo,
        anchors: (ctx.plan?.sections ?? []).flatMap((s) => s.anchors ?? []),
      };
    case "S8_link_select":
      return { candidates: ctx.linkCandidates };
    case "S9_link_verify":
      return { selection: ctx.linkSelection };
    case "S10_localize_tables":
      return {
        market: marketInfo,
        tables: (ctx.source?.tables ?? []).map((t) => ({ index: t.index, preview: clip(t.markdown, 400) })),
      };
    case "S11_generate_content":
      return {
        market: marketInfo,
        plan_sections: (ctx.plan?.sections ?? []).map((s) => ({ heading: s.heading, action: s.action })),
        verified_links: ctx.verifiedLinks?.map((l) => l.target_url),
        localized_tables: ctx.tables?.length ?? 0,
        style_profile_present: Boolean(ctx.styleProfile),
      };
    case "S12_qa":
      return {
        market: marketInfo,
        forbidden_claims: market.forbidden_claims,
        content_sections: (ctx.content ?? []).map((c) => c.heading),
        word_count: (ctx.content ?? []).map((c) => c.markdown).join(" ").split(/\s+/).length,
      };
    case "S13_export":
      return {
        headings: (ctx.content ?? []).map((c) => c.heading),
        verified_links: ctx.verifiedLinks?.length ?? 0,
        target_status: ctx.target?.status,
      };
    default:
      return {};
  }
}
