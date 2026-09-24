import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertRole(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> },
  userId: string,
  role: "admin" | "editor",
) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: role });
  if (data !== true && role === "editor") {
    const { data: admin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (admin === true) return;
  }
  if (data !== true) throw new Error("Keine Berechtigung für diese Aktion.");
}

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ source_url: z.string().url(), market_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .insert({
        source_url: data.source_url,
        market_id: data.market_id,
        created_by: context.userId,
        status: "idle",
        context: {},
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: job.id };
  });

export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("jobs").delete().eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), stepKey: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { executeStep } = await import("@/lib/pipeline/engine.server");
    const res = await executeStep(data.jobId, data.stepKey);
    return {
      ok: res.ok,
      error: res.ok ? null : res.error,
      output: res.ok ? JSON.stringify(res.output ?? null) : null,
    };
  });

export const exportJobReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { buildJobReport } = await import("@/lib/pipeline/report.server");
    return await buildJobReport(data.jobId);
  });

export const exportPromptVars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { buildPromptVarsReport } = await import("@/lib/pipeline/prompt-vars.server");
    return await buildPromptVarsReport(data.jobId);
  });

export const exportFullJobDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { buildFullJobDocumentation } = await import("@/lib/pipeline/full-export.server");
    return await buildFullJobDocumentation(data.jobId);
  });

export const exportAllPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { buildAllPromptsMarkdown } = await import("@/lib/pipeline/prompts-export.server");
    return await buildAllPromptsMarkdown();
  });

export const runFromStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), fromStep: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { executeStep } = await import("@/lib/pipeline/engine.server");
    const { PIPELINE } = await import("@/lib/pipeline/types");
    const startIdx = data.fromStep ? PIPELINE.findIndex((s) => s.key === data.fromStep) : 0;
    const results: { step: string; ok: boolean; error?: string }[] = [];
    for (const step of PIPELINE.slice(Math.max(startIdx, 0))) {
      const res = await executeStep(data.jobId, step.key);
      results.push({ step: step.key, ok: res.ok, ...(res.ok ? {} : { error: res.error }) });
      if (!res.ok) break;
    }
    return results;
  });

/**
 * Admin-Diagnose: Link-Pool für Markt + Beispiel-URL aufbauen (max. 8 Abrufe).
 * Ersetzt den früheren Gesamtindex-Lauf.
 */
export const previewLinkPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ marketId: z.string().uuid(), sourceUrl: z.string().url() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildLinkPool } = await import("@/lib/pipeline/hub.server");
    const { data: market, error } = await supabaseAdmin
      .from("markets")
      .select("*")
      .eq("id", data.marketId)
      .single();
    if (error || !market) throw new Error("Markt nicht gefunden.");

    const pool = await buildLinkPool(market as never, data.sourceUrl);
    for (const e of pool.entries) {
      await supabaseAdmin.from("link_pool").upsert(
        {
          market_id: data.marketId,
          content_type: "magazine",
          source_page: e.source_page,
          url: e.url,
          anchor_text: e.anchor_text,
          path_type: e.path_type,
          origin: e.origin,
          http_status: 200,
          fetched_at: new Date().toISOString(),
        } as never,
        { onConflict: "market_id,content_type,url" },
      );
    }
    await supabaseAdmin
      .from("markets")
      .update({ index_last_run: new Date().toISOString() })
      .eq("id", data.marketId);
    return {
      hub_url: pool.hub_url,
      fetches: pool.fetches,
      entries: pool.entries.length,
      siblings: pool.siblings.map((s) => s.url),
    };
  });

export const savePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        system_prompt: z.string(),
        user_prompt: z.string(),
        model: z.string(),
        temperature: z.number(),
        max_tokens: z.number(),
        reasoning_effort: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current, error } = await supabaseAdmin
      .from("prompt_templates")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !current) throw new Error("Prompt nicht gefunden.");
    const version = (current.version ?? 1) + 1;
    const { error: updateError } = await supabaseAdmin
      .from("prompt_templates")
      .update({
        system_prompt: data.system_prompt,
        user_prompt: data.user_prompt,
        model: data.model,
        temperature: data.temperature,
        max_tokens: data.max_tokens,
        reasoning_effort: data.reasoning_effort ?? null,
        version,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);

    const { error: insertError } = await supabaseAdmin.from("prompt_versions").insert({
      template_id: data.id,
      version,
      system_prompt: data.system_prompt,
      user_prompt: data.user_prompt,
      model: data.model,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      reasoning_effort: data.reasoning_effort ?? null,
      response_format: current.response_format,
      created_by: context.userId,
    });
    if (insertError) throw new Error(insertError.message);

    return { version };
  });

export const testPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ stepKey: z.string(), vars: z.record(z.string(), z.string()) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runPrompt } = await import("@/lib/pipeline/ai.server");
    const { data: tpl, error } = await supabaseAdmin
      .from("prompt_templates")
      .select("*")
      .eq("step_key", data.stepKey)
      .single();
    if (error || !tpl) throw new Error("Prompt nicht gefunden.");
    const res = await runPrompt(tpl as never, data.vars);
    return { raw: res.raw, model: res.model };
  });

export const assignRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "editor", "viewer"]),
        action: z.enum(["add", "remove"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "add") {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
    }
    return { ok: true };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        role: z.enum(["admin", "editor", "viewer"]).default("admin"),
        redirectTo: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    let userId: string | null = null;
    let link: string | null = null;
    let emailSent = false;

    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: data.redirectTo,
    });
    if (invited.data?.user) {
      userId = invited.data.user.id;
      emailSent = true;
    }

    if (!userId) {
      const gen = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: data.redirectTo },
      });
      if (gen.error || !gen.data?.user) {
        throw new Error(gen.error?.message ?? invited.error?.message ?? "Einladung fehlgeschlagen.");
      }
      userId = gen.data.user.id;
      link = gen.data.properties?.action_link ?? null;
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });

    return { userId, email, emailSent, link };
  });

/** Pfadverzeichnis eines Markts aus den Sitemaps (DE ↔ Zielland) aufbauen. */
export const importMarketPaths = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ marketId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: market, error } = await supabaseAdmin
      .from("markets")
      .select("id,domain,locale")
      .eq("id", data.marketId)
      .single();
    if (error || !market) throw new Error("Markt nicht gefunden.");
    const { importPathsFromSitemaps } = await import("@/lib/pipeline/market-paths.server");
    const res = await importPathsFromSitemaps(market);
    return {
      saved: res.saved,
      pairs: Object.keys(res.pairs).length,
      sitemaps: res.sitemaps.length,
      log: res.sitemaps.map((s) => `${s.url} → HTTP ${s.status}, ${s.urls} Einträge, ${s.pairs} Paare`),
    };
  });
