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

export const runStepFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid(), stepKey: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { executeStep } = await import("@/lib/pipeline/engine.server");
    return executeStep(data.jobId, data.stepKey);
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

export const rebuildIndex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ marketId: z.string().uuid(), limit: z.number().min(1).max(500).default(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase as never, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { collectUrls, indexPage } = await import("@/lib/pipeline/crawl.server");
    const { data: market, error } = await supabaseAdmin
      .from("markets")
      .select("*")
      .eq("id", data.marketId)
      .single();
    if (error || !market) throw new Error("Markt nicht gefunden.");

    const urls = await collectUrls(market as never, { limit: data.limit });
    let indexed = 0;
    for (const url of urls.slice(0, data.limit)) {
      const row = await indexPage(url, market as never);
      if (!row) continue;
      const { error: upErr } = await supabaseAdmin
        .from("url_index")
        .upsert({ ...row, last_seen: new Date().toISOString() }, { onConflict: "market_id,url" });
      if (!upErr) indexed++;
    }
    await supabaseAdmin
      .from("markets")
      .update({ index_last_run: new Date().toISOString() })
      .eq("id", data.marketId);
    return { discovered: urls.length, indexed };
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
    await supabaseAdmin.from("prompt_templates").update({
      system_prompt: data.system_prompt,
      user_prompt: data.user_prompt,
      model: data.model,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      version,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    }).eq("id", data.id);
    await supabaseAdmin.from("prompt_versions").insert({
      template_id: data.id,
      version,
      system_prompt: data.system_prompt,
      user_prompt: data.user_prompt,
      model: data.model,
      temperature: data.temperature,
      max_tokens: data.max_tokens,
      response_format: current.response_format,
      created_by: context.userId,
    });
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
