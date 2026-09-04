import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PIPELINE,
  STEP_BY_KEY,
  type JobContext,
  type PlanSection,
  type TargetStatus,
} from "./types";
import { extractPage, verifyUrl } from "./extract.server";
import { runPrompt, type PromptTemplateRow } from "./ai.server";
import {
  buildGapReport,
  matchHubEntry,
  retrieveFromPool,
  MIN_POOL_SCORE,
  type PoolEntry,
  type SearchLogEntry,
} from "./pool";
import {
  buildLinkPool,
  fetchHubEntries,
  siteSearch,
  SEARCH_BUDGET,
  POOL_TTL_MS,
  type HubMarket,
} from "./hub.server";
import {
  S2OutputSchema,
  S6OutputSchema,
  S8OutputSchema,
  S10OutputSchema,
  validateStepData,
} from "./schemas";
import {
  buildTargetUrls,
  hreflangHint,
  lastPathSegment,
  matchHreflang,
  PathMapError,
} from "./paths";
import { harvestHreflangEquivalents } from "./hreflang.server";
import { checkLocalizedTable } from "./tables";
import { buildSectionInputs } from "./plan";
import { dependencyBlocker } from "./deps";

export { dependencyBlocker };

type MarketRow = Record<string, unknown> & {
  id: string;
  country: string;
  language: string;
  locale: string | null;
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
  tokensIn?: number;
  tokensOut?: number;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
}

function hubMarket(market: MarketRow): HubMarket {
  return {
    id: market.id,
    domain: market.domain,
    locale: market.locale,
    language: market.language,
    path_map: market.path_map,
    magazine_root: market.magazine_root,
    category_root: market.category_root,
    crawl_delay_ms: (market["crawl_delay_ms"] as number | null) ?? null,
    search_url_pattern: (market["search_url_pattern"] as string | null) ?? null,
  };
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
      return {
        output: {
          ...doc,
          sections: doc.sections.length,
          hreflang_count: doc.hreflang.length,
          content_links: doc.contentLinks?.length ?? 0,
        },
        context: { source: doc },
      };
    }

    case "S2_resolve_slug": {
      const source = requireSource(ctx);
      // Stufe 1: hreflang (P1-4)
      const alt = matchHreflang(source.hreflang, market.locale);
      if (alt) {
        const seg = lastPathSegment(alt.href) || slugify(source.h1 ?? "");
        return {
          output: {
            resolution_method: "hreflang",
            hreflang: alt,
            term_translated: seg,
            slug_candidates: [seg],
            skipped_llm: true,
          },
          context: {
            slug: { term_translated: seg, slug_candidates: [seg] },
            hreflangTargetUrl: alt.href,
          },
        };
      }

      // Stufe 2: Slug-Kandidaten über das URL-Segment (P1-2)
      const term = lastPathSegment(job.source_url) || source.h1 || job.source_url;
      const tpl = await loadTemplate("resolve_target_slug");
      const res = await runPrompt<unknown>(tpl, {
        term,
        h1: source.h1 ?? "",
        title: source.title ?? "",
        language: market.language,
        country: market.country,
      });
      const parsed = validateStepData("S2_resolve_slug", S2OutputSchema, res.data);
      const candidates = [...new Set(parsed.slug_candidates.map(slugify).filter(Boolean))];
      if (!candidates.length) throw new Error("S2 lieferte keine verwertbaren Slug-Kandidaten.");
      return {
        output: { ...parsed, slug_candidates: candidates, resolution_method: "slug", term },
        context: {
          slug: { term_translated: parsed.term_translated, slug_candidates: candidates },
          hreflangTargetUrl: null,
        },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "S3_target_status": {
      const source = requireSource(ctx);
      const slug = ctx.slug;
      if (!slug) throw new Error("Schritt S2 muss zuerst laufen.");
      const hint = hreflangHint(source.hreflang, market.locale);
      const evidence: { step: string; detail: string }[] = [];
      const checked: { url: string; status: number }[] = [];
      let found: string | null = null;
      let method: "hreflang" | "hub" | "slug" = "slug";

      // Stufe 1 · hreflang-Alternate
      if (ctx.hreflangTargetUrl) {
        method = "hreflang";
        evidence.push({ step: "hreflang", detail: `Alternate der Quellseite: ${ctx.hreflangTargetUrl}` });
        const v = await verifyUrl(ctx.hreflangTargetUrl);
        checked.push({ url: ctx.hreflangTargetUrl, status: v.http_status });
        if (v.ok) found = ctx.hreflangTargetUrl;
      } else if (hint) {
        evidence.push({ step: "hreflang", detail: hint });
      }

      // Stufe 2 · Treffer in der Hub-Liste des Zielmarkts (ersetzt den Gesamtindex)
      let hubEntries: PoolEntry[] = ctx.linkPool?.entries ?? [];
      let hubUrl = ctx.linkPool?.hub_url ?? null;
      if (!found && !hubEntries.length) {
        const hub = await fetchHubEntries(
          hubMarket(market),
          job.source_url,
          ctx.derivedPathMap ?? {},
        );
        hubEntries = hub.entries;
        hubUrl = hub.hub_url;
        evidence.push({
          step: "hub",
          detail: hub.hub_url
            ? `Hub-Seite ${hub.hub_url} geladen (${hub.entries.length} Links).`
            : "Keine Hub-Seite erreichbar.",
        });
      }
      if (!found && hubEntries.length) {
        const match = matchHubEntry(hubEntries, slug.term_translated, slug.slug_candidates);
        if (match) {
          evidence.push({
            step: "hub",
            detail: `Hub-Treffer „${match.entry.anchor_text ?? match.entry.url}" (Ähnlichkeit ${match.score.toFixed(2)}).`,
          });
          const v = await verifyUrl(match.entry.url);
          checked.push({ url: match.entry.url, status: v.http_status });
          if (v.ok) {
            found = match.entry.url;
            method = "hub";
          }
        } else if (hubUrl) {
          evidence.push({
            step: "hub",
            detail: `Kein passender Eintrag in der Hub-Liste (${hubEntries.length} Links geprüft).`,
          });
        }
      }

      // Stufe 2b · hreflang-Ernte über die Content-Links der Quellseite.
      // Liefert belegte Ziel-URLs und eine abgeleitete Pfadübersetzung, wenn
      // market.path_map Lücken hat (z. B. „gesundheit" → „health").
      let harvest = ctx.hreflangHarvest ?? null;
      let derivedMap = { ...(ctx.derivedPathMap ?? {}) };
      if (!found) {
        if (!harvest) {
          const res = await harvestHreflangEquivalents(source.contentLinks ?? [], hubMarket(market));
          harvest = {
            checked: res.checked,
            entries: res.entries,
            derived_path_map: res.derivedPathMap,
            harvested_at: new Date().toISOString(),
          };
        }
        derivedMap = { ...harvest.derived_path_map, ...derivedMap };
        evidence.push({
          step: "hreflang_pool",
          detail:
            `${harvest.checked.length} im Content verlinkte Quellartikel geprüft, ` +
            `${harvest.entries.length} hreflang-Äquivalente im Zielmarkt gefunden` +
            (Object.keys(harvest.derived_path_map).length
              ? `; abgeleitete Pfade: ${Object.entries(harvest.derived_path_map)
                  .map(([k, v]) => `${k}→${v}`)
                  .join(", ")}`
              : "; keine Pfadübersetzung ableitbar"),
        });
        const poolMatch = matchHubEntry(
          harvest.entries.map((e) => ({ ...e, origin: "hub" as const })),
          slug.term_translated,
          slug.slug_candidates,
        );
        if (poolMatch) {
          const v = await verifyUrl(poolMatch.entry.url);
          checked.push({ url: poolMatch.entry.url, status: v.http_status });
          evidence.push({
            step: "hreflang_pool",
            detail: `Kandidat aus hreflang-Ernte: ${poolMatch.entry.url} → HTTP ${v.http_status}`,
          });
          if (v.ok) {
            found = poolMatch.entry.url;
            method = "hub";
          }
        }
      }

      // Stufe 3 · Slug-Kandidaten über path_map (+ abgeleitete Pfade), live geprüft
      if (!found) {
        try {
          const urls = buildTargetUrls(job.source_url, market, slug.slug_candidates, derivedMap);
          for (const url of urls) {
            const v = await verifyUrl(url);
            checked.push({ url, status: v.http_status });
            evidence.push({ step: "slug", detail: `${url} → HTTP ${v.http_status}` });
            if (v.ok) {
              found = url;
              method = "slug";
              break;
            }
          }
        } catch (e) {
          if (!(e instanceof PathMapError)) throw e;
          evidence.push({ step: "slug", detail: e.message });
          if (!checked.length) throw e;
        }
      }

      const status: TargetStatus = found
        ? "EXISTS"
        : checked.some((c) => c.status === 404)
          ? "VERIFIED_404"
          : "NOT_IN_INDEX";

      const doc = found ? await extractPage(found) : null;
      const target = {
        status,
        url: found,
        checked,
        doc,
        resolution_method: method,
        hreflang_hint: hint,
        evidence,
      };
      return {
        output: {
          status,
          url: found,
          checked,
          resolution_method: method,
          hreflang_hint: hint,
          evidence,
          derived_path_map: derivedMap,
          hreflang_pool: harvest?.entries.length ?? 0,
        },
        context: {
          target,
          ...(harvest ? { hreflangHarvest: harvest, derivedPathMap: derivedMap } : {}),
        },
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
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "S7a_link_pool": {
      const source = requireSource(ctx);
      const hm = hubMarket(market);
      // Stufe 0 · hreflang-Äquivalente der im Content verlinkten Quellartikel.
      let harvest = ctx.hreflangHarvest ?? null;
      if (!harvest) {
        const res = await harvestHreflangEquivalents(source.contentLinks ?? [], hm);
        harvest = {
          checked: res.checked,
          entries: res.entries,
          derived_path_map: res.derivedPathMap,
          harvested_at: new Date().toISOString(),
        };
      }
      const derivedMap = { ...harvest.derived_path_map, ...(ctx.derivedPathMap ?? {}) };
      const pool = await buildLinkPool(hm, job.source_url, derivedMap);
      const known = new Set(pool.entries.map((e) => e.url));
      for (const e of harvest.entries) {
        if (!known.has(e.url)) {
          known.add(e.url);
          pool.entries.unshift(e);
        }
      }
      if (!pool.entries.length) {
        throw new Error(
          `Kein Link-Pool aufbaubar: keine der ${pool.fetches.length} abgerufenen Seiten lieferte interne Links. ` +
            `Bitte path_map, magazine_root und Domain des Markts prüfen.`,
        );
      }
      // Persistenz mit TTL: alte Einträge dieses Markts/Typs verfallen nach 7 Tagen.
      const cutoff = new Date(Date.now() - POOL_TTL_MS).toISOString();
      await supabaseAdmin
        .from("link_pool")
        .delete()
        .eq("market_id", market.id)
        .lt("fetched_at", cutoff);
      for (const chunk of chunked(pool.entries, 200)) {
        await supabaseAdmin.from("link_pool").upsert(
          chunk.map((e) => ({
            market_id: market.id,
            content_type: "magazine",
            source_page: e.source_page,
            url: e.url,
            anchor_text: e.anchor_text,
            path_type: e.path_type,
            origin: e.origin,
            http_status: 200,
            fetched_at: new Date().toISOString(),
          })) as never,
          { onConflict: "market_id,content_type,url" },
        );
      }
      return {
        output: {
          hub_url: pool.hub_url,
          fetches: pool.fetches,
          hreflang_pool: harvest.entries.length,
          hreflang_checked: harvest.checked.length,
          derived_path_map: derivedMap,
          entries: pool.entries.length,
          siblings: pool.siblings.map((s) => ({ url: s.url, title: s.title })),
          by_origin: countBy(pool.entries.map((e) => e.origin)),
        },
        context: {
          hreflangHarvest: harvest,
          derivedPathMap: derivedMap,
          linkPool: {
            hub_url: pool.hub_url,
            built_at: new Date().toISOString(),
            fetches: pool.fetches,
            entries: pool.entries,
            siblings: pool.siblings,
          },
        },
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
        return {
          output: { cached: true, profile: cached.profile },
          context: { styleProfile: cached.profile },
        };
      }
      const siblings = ctx.linkPool?.siblings ?? [];
      const referenceTexts = siblings
        .map((s) => [s.title, s.text].filter(Boolean).join("\n"))
        .join("\n---\n");
      if (!referenceTexts.trim()) {
        throw new Error(
          "Keine Referenztexte vorhanden – bitte zuerst S7a (Link-Pool) ausführen; " +
            "das Stilprofil entsteht aus den geladenen Geschwisterartikeln.",
        );
      }
      const tpl = await loadTemplate("style_profile");
      const res = await runPrompt(tpl, { reference_texts: referenceTexts.slice(0, 12000) });
      await supabaseAdmin
        .from("style_profiles")
        .insert({ market_id: market.id, content_type: "magazine", profile: res.data as never });
      return {
        output: { sources: siblings.map((s) => s.url), profile: res.data },
        context: { styleProfile: res.data },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "S6_localization_plan": {
      const source = requireSource(ctx);
      const tpl = await loadTemplate("localization_plan");
      const res = await runPrompt<unknown>(tpl, {
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
      const parsed = validateStepData("S6_localization_plan", S6OutputSchema, res.data);
      const sections = parsed.sections as PlanSection[];
      return {
        output: {
          sections,
          anchor_count: sections.reduce((n, s) => n + (s.anchors?.length ?? 0), 0),
        },
        context: { plan: { sections } },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "S7_link_candidates": {
      const plan = ctx.plan?.sections ?? [];
      const anchors = plan.flatMap((s) => s.anchors ?? []);
      if (!anchors.length) throw new Error("S6 hat keine Anker geliefert – S7 kann nichts suchen.");
      const hm = hubMarket(market);
      const poolEntries: PoolEntry[] = [...(ctx.linkPool?.entries ?? [])];
      if (!poolEntries.length) throw new Error("Kein Link-Pool vorhanden – bitte S7a ausführen.");

      const candidates: Record<string, { url: string; title: string; path_type: string }[]> = {};
      const log: SearchLogEntry[] = [];
      let searchBudget = SEARCH_BUDGET;

      for (const a of anchors) {
        const query = [a.anchor, ...(a.search_terms ?? []), a.intent ?? ""].filter(Boolean).join(" ");
        // Stufe 1 · Retrieval im Link-Pool
        let hits = retrieveFromPool(query, poolEntries, { pathType: a.path_type, limit: 8 });
        if (!hits.length && a.path_type) hits = retrieveFromPool(query, poolEntries, { limit: 8 });

        // Stufe 2 · gezielte Site-Suche, wenn der Pool zu schwach ist
        let stage2 = false;
        let stage2Source: "internal" | "web" | "none" | undefined;
        if ((!hits.length || (hits[0]?.score ?? 0) < MIN_POOL_SCORE) && searchBudget > 0) {
          stage2 = true;
          searchBudget--;
          const terms = (a.search_terms?.length ? a.search_terms : [a.anchor]).join(" ");
          const found = await siteSearch(hm, terms);
          stage2Source = found.source;
          if (found.entries.length) {
            found.entries.forEach((e) => {
              if (!poolEntries.some((p) => p.url === e.url)) poolEntries.push(e);
            });
            hits = retrieveFromPool(query, poolEntries, { limit: 8 });
          }
        }

        candidates[a.anchor] = hits.map((c) => ({
          url: c.url,
          title: c.title,
          path_type: c.path_type,
        }));
        log.push({
          anchor: a.anchor,
          search_terms: a.search_terms ?? [],
          stage2,
          ...(stage2Source ? { stage2_source: stage2Source } : {}),
          hits: hits.length,
        });
      }

      return {
        output: { anchors: anchors.length, candidates, search_log: log },
        context: { linkCandidates: candidates, linkSearchLog: log },
      };
    }

    case "S8_link_select": {
      const candidates = ctx.linkCandidates ?? {};
      const tpl = await loadTemplate("link_select");
      const selection: { anchor: string; url: string | null; confidence?: string }[] = [];
      const snapshots: string[] = [];
      let tokensIn = 0;
      let tokensOut = 0;
      for (const [anchor, list] of Object.entries(candidates)) {
        if (!list.length) {
          selection.push({ anchor, url: null });
          continue;
        }
        const res = await runPrompt<unknown>(tpl, {
          anchor,
          context_sentence: anchor,
          candidates: list.map((c, i) => `${i + 1}. ${c.title} [${c.path_type}]`).join("\n"),
        });
        const parsed = validateStepData("S8_link_select", S8OutputSchema, res.data);
        snapshots.push(res.promptSnapshot);
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        const idx = parsed.choice ?? parsed.candidate_index ?? null;
        const chosen = typeof idx === "number" && idx >= 1 && idx <= list.length ? list[idx - 1]! : null;
        selection.push({
          anchor,
          url: chosen?.url ?? null,
          ...(parsed.confidence ? { confidence: parsed.confidence } : {}),
        });
      }
      return {
        output: selection,
        context: { linkSelection: selection },
        promptSnapshot: snapshots.join("\n\n=====\n\n"),
        model: tpl.model,
        tokensIn,
        tokensOut,
      };
    }

    case "S9_link_verify": {
      const selection = ctx.linkSelection ?? [];
      const verified: JobContext["verifiedLinks"] = [];
      const broken: NonNullable<JobContext["brokenLinks"]> = [];
      await supabaseAdmin.from("verified_links").delete().eq("job_id", job.id);
      for (const s of selection) {
        if (!s.url) continue;
        const v = await verifyUrl(s.url);
        if (!v.ok || v.http_status !== 200 || !v.canonical_ok) {
          broken.push({
            anchor: s.anchor,
            url: s.url,
            http_status: v.http_status,
            reason: v.http_status !== 200 ? `HTTP ${v.http_status}` : "Canonical/Soft-404",
          });
          // Toter Poolkandidat: aus dem Pool entfernen, damit er nicht erneut gewählt wird.
          await supabaseAdmin
            .from("link_pool")
            .delete()
            .eq("market_id", market.id)
            .eq("url", s.url);
          continue;
        }
        const row = {
          anchor: s.anchor,
          target_url: s.url,
          http_status: v.http_status,
          canonical_ok: v.canonical_ok,
          ...(s.confidence ? { confidence: s.confidence } : {}),
        };
        verified.push(row);
        await supabaseAdmin.from("verified_links").insert({ job_id: job.id, source: "pool", ...row });
      }
      return {
        output: { verified, broken },
        context: { verifiedLinks: verified, brokenLinks: broken },
      };
    }

    case "S10_localize_tables": {
      const source = requireSource(ctx);
      if (!source.tables.length) return { output: [], context: { tables: [] } };
      const tpl = await loadTemplate("localize_table");
      const tables: { index: number; markdown: string }[] = [];
      const snapshots: string[] = [];
      let tokensIn = 0;
      let tokensOut = 0;

      for (const t of source.tables) {
        let accepted: string | null = null;
        let lastReason = "";
        for (let attempt = 0; attempt < 3 && accepted === null; attempt++) {
          const res = await runPrompt<unknown>(tpl, {
            table_markdown: t.markdown,
            language: market.language,
            market_notes: `Land: ${market.country}. Institutionen: ${JSON.stringify(market.institutions)}`,
          });
          snapshots.push(res.promptSnapshot);
          tokensIn += res.tokensIn;
          tokensOut += res.tokensOut;
          const md =
            typeof res.data === "string"
              ? res.data
              : validateStepData("S10_localize_tables", S10OutputSchema, res.data).table_markdown;
          const check = checkLocalizedTable(t.markdown, md, market.language);
          if (check.ok) accepted = md;
          else lastReason = check.reason ?? "unbekannt";
        }
        if (accepted === null) {
          throw new Error(`Tabelle ${t.index + 1} konnte nicht lokalisiert werden: ${lastReason}`);
        }
        tables.push({ index: t.index, markdown: accepted });
      }
      return {
        output: tables,
        context: { tables },
        model: tpl.model,
        promptSnapshot: snapshots.join("\n\n=====\n\n"),
        tokensIn,
        tokensOut,
      };
    }

    case "S11_generate_content": {
      const source = requireSource(ctx);
      const plan = ctx.plan?.sections ?? [];
      if (!plan.length) throw new Error("Kein Lokalisierungsplan vorhanden – bitte S6 ausführen.");
      const tpl = await loadTemplate("generate_content");

      const inputs = buildSectionInputs({
        plan,
        sourceSections: source.sections,
        tables: ctx.tables ?? [],
        verifiedLinks: ctx.verifiedLinks ?? [],
        styleProfile: ctx.styleProfile ?? {},
        market: {
          country: market.country,
          language: market.language,
          language_variant: market.language_variant,
          brand: market.brand,
          address_form: market.address_form,
          institutions: market.institutions,
          forbidden_claims: market.forbidden_claims,
        },
      });

      const written: string[] = [];
      const content: { heading: string; markdown: string }[] = [];
      const snapshots: string[] = [];
      let tokensIn = 0;
      let tokensOut = 0;
      const linksForPrompt = (ctx.verifiedLinks ?? [])
        .map((l) => `- [${l.anchor}](${l.target_url})`)
        .join("\n");

      for (const input of inputs) {
        if (input.action === "streichen") continue;
        // Vollständiges Objekt an das Modell – ungekürzt (P0-1).
        const res = await runPrompt<string>(tpl, {
          language: market.language,
          language_variant: market.language_variant ?? "",
          country: market.country ?? "",
          institutions: market.institutions ?? {},
          forbidden_claims: market.forbidden_claims ?? [],
          brand: market.brand ?? "",
          address_form: market.address_form ?? "",
          style_profile: input.style_profile,
          style_example: "",
          de_section: `## ${input.de_heading}\n${input.de_body}`,
          target_heading: input.target_heading,
          action: input.action,
          localization_notes: input.notes.join("\n- "),
          written_headings: written.join(", "),
          verified_links: linksForPrompt,
          table_markdown: input.table_markdown ?? "",
        });
        snapshots.push(res.promptSnapshot);
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        const md = typeof res.data === "string" ? res.data : String(res.data);
        written.push(input.target_heading);
        content.push({ heading: input.target_heading, markdown: md.trim() });
      }
      if (!content.length) throw new Error("S11 hat keinen Abschnitt erzeugt.");
      return {
        output: content,
        context: { content },
        model: tpl.model,
        promptSnapshot: snapshots.join("\n\n=====\n\n"),
        tokensIn,
        tokensOut,
      };
    }

    case "S12_qa": {
      const full = (ctx.content ?? []).map((c) => c.markdown).join("\n\n");
      if (!full.trim()) throw new Error("Kein Content vorhanden – bitte S11 ausführen.");
      const tpl = await loadTemplate("qa");
      const res = await runPrompt(tpl, {
        full_text: full,
        brand: market.brand ?? "",
        forbidden_terms: market.forbidden_claims ?? [],
        institutions: market.institutions ?? {},
        country: market.country ?? "",
        language: market.language,
      });
      return {
        output: res.data,
        context: { qa: res.data },
        model: res.model,
        promptSnapshot: res.promptSnapshot,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
      };
    }

    case "S13_export": {
      const source = requireSource(ctx);
      const anchors = (ctx.plan?.sections ?? []).flatMap((s) => s.anchors ?? []);
      const gaps = buildGapReport(anchors, ctx.verifiedLinks ?? [], ctx.linkSearchLog ?? []);
      const broken = ctx.brokenLinks ?? [];
      const md = [
        `# ${ctx.slug?.term_translated ?? source.h1 ?? ""}`,
        "",
        `> Quelle: ${source.url}`,
        `> Zielstatus: ${ctx.target?.status ?? "-"}${ctx.target?.url ? ` (${ctx.target.url})` : ""}`,
        ctx.target?.resolution_method ? `> Zielermittlung: ${ctx.target.resolution_method}` : "",
        ctx.target?.hreflang_hint ? `> hreflang-Hinweis: ${ctx.target.hreflang_hint}` : "",
        ctx.linkPool
          ? `> Link-Pool: ${ctx.linkPool.entries.length} Links aus ${ctx.linkPool.fetches.length} Abrufen` +
            (ctx.linkPool.hub_url ? ` (Hub: ${ctx.linkPool.hub_url})` : "")
          : "",
        "",
        ...(ctx.content ?? []).map((c) => c.markdown),
        "",
        "## Verifizierte Links",
        ...(ctx.verifiedLinks ?? []).map(
          (l) => `- [${l.anchor}](${l.target_url}) — HTTP ${l.http_status}`,
        ),
        "",
        "## Gap-Report",
        gaps.length
          ? gaps
              .map(
                (g) =>
                  `- **${g.anchor}** — ${g.reason}. Suchbegriffe: ${g.search_terms.join(", ") || "–"}. ` +
                  `Site-Suche: ${g.stage2_run ? "ausgeführt" : "nicht ausgeführt"}.`,
              )
              .join("\n")
          : "- Keine offenen Anker: jeder geplante Anker hat einen verifizierten Link.",
        broken.length
          ? `\n### Verworfene Poolkandidaten\n${broken
              .map((b) => `- ${b.anchor}: ${b.url} — ${b.reason}`)
              .join("\n")}`
          : "",
        market.closing_note ? `\n${market.closing_note}` : "",
      ]
        .filter((l) => l !== "")
        .join("\n");
      return {
        output: { length: md.length, gaps: gaps.length, broken: broken.length },
        context: { exportMarkdown: md, gapReport: gaps },
      };
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

  // P2-1: Voraussetzungen prüfen, bevor irgendetwas läuft.
  const blocker = dependencyBlocker(def.key, context);
  if (blocker) {
    await upsertStep(jobId, def.key, def.order, {
      status: "blocked",
      error: blocker,
      output: null,
    });
    await syncJobStatus(jobId);
    return { ok: false as const, error: blocker, blocked: true as const };
  }

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
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await upsertStep(jobId, def.key, def.order, {
      status: "done",
      output: (result.output ?? null) as never,
      error: null,
      duration_ms: Date.now() - started,
      tokens_in: result.tokensIn ?? 0,
      tokens_out: result.tokensOut ?? 0,
      ...(result.model ? { model: result.model } : {}),
      ...(result.promptSnapshot ? { prompt_snapshot: result.promptSnapshot } : {}),
    });
    await syncJobStatus(jobId);
    return { ok: true as const, output: result.output };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    await upsertStep(jobId, def.key, def.order, {
      status: "error",
      error: message,
      duration_ms: Date.now() - started,
    });
    await syncJobStatus(jobId);
    return { ok: false as const, error: message };
  }
}

/** Job gilt nur ohne Fehler und ohne blockierte Schritte als „done" (P2-1). */
async function syncJobStatus(jobId: string) {
  const { data: steps } = await supabaseAdmin
    .from("job_steps")
    .select("step_key,status")
    .eq("job_id", jobId);
  const rows = (steps ?? []) as Array<{ step_key: string; status: string }>;
  const problems = rows.filter((s) => s.status === "error" || s.status === "blocked").length;
  const finished = rows.find((s) => s.step_key === "S13_export")?.status === "done";
  const status = finished ? (problems ? "done_with_errors" : "done") : problems ? "error" : "idle";
  await supabaseAdmin
    .from("jobs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", jobId);
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
  const counts = patch["status"] === "running";
  if (existing) {
    await supabaseAdmin
      .from("job_steps")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
        run_count: counts ? (existing.run_count ?? 0) + 1 : existing.run_count,
      } as never)
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("job_steps").insert({
      job_id: jobId,
      step_key: stepKey,
      step_order: order,
      run_count: counts ? 1 : 0,
      ...patch,
    } as never);
  }
}

/**
 * Kompakter Snapshot dessen, was ein Schritt als Eingabe erhalten hat.
 * NUR für die Anzeige – der an das Modell gesendete Payload wird in runStep
 * separat und ungekürzt gebaut (P0-1).
 */
function describeStepInput(
  stepKey: string,
  ctx: JobContext,
  market: MarketRow,
  sourceUrl: string,
): Record<string, unknown> {
  const marketInfo = {
    country: market.country,
    language: market.language,
    locale: market.locale,
    domain: market.domain,
    brand: market.brand,
    magazine_root: market.magazine_root,
    path_map: market.path_map,
  };
  const clip = (s: string | null | undefined, n = 1500) =>
    s ? (s.length > n ? `${s.slice(0, n)}… [gekürzt]` : s) : null;

  switch (stepKey) {
    case "S1_extract_source":
      return { source_url: sourceUrl, market: marketInfo };
    case "S2_resolve_slug":
      return {
        market: marketInfo,
        term: lastPathSegment(sourceUrl),
        h1: ctx.source?.h1 ?? null,
        hreflang: ctx.source?.hreflang ?? [],
      };
    case "S3_target_status":
      return {
        market: marketInfo,
        slug: ctx.slug,
        hreflang_target_url: ctx.hreflangTargetUrl ?? null,
      };
    case "S4_compare":
      return {
        de_outline: clip(ctx.source?.outline),
        de_word_count: ctx.source?.wordCount,
        target_status: ctx.target?.status,
        target_url: ctx.target?.url,
        target_outline: clip(ctx.target?.doc?.outline ?? null),
      };
    case "S7a_link_pool":
      return {
        market: marketInfo,
        source_url: ctx.source?.url ?? null,
        hub_candidates: ctx.linkPool?.hub_url ?? null,
      };
    case "S5_style_profile":
      return {
        market: marketInfo,
        content_type: "magazine",
        sibling_urls: (ctx.linkPool?.siblings ?? []).map((s) => s.url),
      };
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
        pool_size: ctx.linkPool?.entries.length ?? 0,
        search_runs: ctx.linkSearchLog?.length ?? 0,
      };
    case "S8_link_select":
      return { candidates: ctx.linkCandidates };
    case "S9_link_verify":
      return { selection: ctx.linkSelection };
    case "S10_localize_tables":
      return {
        market: marketInfo,
        tables: (ctx.source?.tables ?? []).map((t) => ({
          index: t.index,
          preview: clip(t.markdown, 400),
        })),
      };
    case "S11_generate_content":
      return {
        market: marketInfo,
        plan_sections: (ctx.plan?.sections ?? []).map((s) => ({
          de_heading: s.de_heading,
          target_heading: s.target_heading,
          action: s.action,
          notes: s.notes,
          has_table: s.has_table,
          de_body_chars: (ctx.source?.sections.find((x) => x.heading === s.de_heading)?.text ?? "")
            .length,
        })),
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
