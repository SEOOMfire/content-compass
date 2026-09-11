/**
 * S7b · SERP-Lückenanalyse über DataForSEO.
 *
 * Die KI formuliert bis zu 5 Suchanfragen, die hier jeweils auf die Domain des
 * Zielmarkts eingeschränkt (site:…) und gegen die Google-Organic-SERP (nur
 * erste Seite) abgefragt werden. Gesamtbudget: 5 Minuten – Anfragen, die bis
 * dahin nicht geantwortet haben, werden übersprungen.
 */

const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

export const SERP_MAX_QUERIES = 5;
/** S7c · zusätzliche Abfragen für Linkchancen. */
export const SERP_MAX_OPPORTUNITY_QUERIES = 10;
export const SERP_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
/** Nur die erste Ergebnisseite. */
export const SERP_DEPTH = 10;

export interface SerpMarket {
  domain: string;
  locale: string | null;
  language: string;
  country: string;
  /** Sprachverzeichnis des Markts, z. B. "/fr" – fließt in site: ein. */
  path_prefix?: string | null;
}


export interface SerpItem {
  url: string;
  title: string | null;
  description: string | null;
  rank: number | null;
}

export interface SerpQueryResult {
  query: string;
  keyword: string;
  status: "ok" | "skipped" | "error";
  items: SerpItem[];
  error?: string;
}

/** DataForSEO-Standortcodes der aktiven Märkte. */
const LOCATION_CODES: Record<string, number> = {
  "de-AT": 2040,
  "de-CH": 2756,
  "fr-CH": 2756,
  "fr-FR": 2250,
  "fr-BE": 2056,
  "nl-BE": 2056,
  "pl-PL": 2616,
  "en-IE": 2372,
};

const LANGUAGE_BY_NAME: Record<string, string> = {
  Deutsch: "de",
  Französisch: "fr",
  Niederländisch: "nl",
  Polnisch: "pl",
  Englisch: "en",
};

export function credentialsPresent(): boolean {
  return Boolean(process.env["DATAFORSEO_LOGIN"] && process.env["DATAFORSEO_PASSWORD"]);
}

function authHeader(): string {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) {
    throw new Error(
      "DataForSEO-Zugangsdaten fehlen (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).",
    );
  }
  return `Basic ${btoa(`${login}:${password}`)}`;
}

/** Reine Host-Angabe des Zielmarkts, z. B. „maxizoo.pl". */
export function marketHost(market: SerpMarket): string {
  const d = market.domain.trim().replace(/\/+$/, "");
  try {
    return new URL(/^https?:\/\//i.test(d) ? d : `https://${d}`).hostname.replace(/^www\./, "");
  } catch {
    return d.replace(/^www\./, "");
  }
}

/** Sprachverzeichnis normalisiert, z. B. "fr" → "/fr"; ohne Präfix leer. */
export function marketPathPrefix(market: SerpMarket): string {
  const raw = (market.path_prefix ?? "").trim();
  const segs = raw.split("/").filter(Boolean);
  return segs.length ? `/${segs.join("/")}` : "";
}

/** site:-Operand inkl. Sprachverzeichnis, z. B. "fressnapf.ch/fr". */
export function siteOperand(market: SerpMarket): string {
  return `${marketHost(market)}${marketPathPrefix(market)}`;
}

export function serpTarget(market: SerpMarket): {
  location_code: number;
  language_code: string;
  host: string;
  site: string;
  path_prefix: string;
} {
  const locale = market.locale ?? "";
  const location = LOCATION_CODES[locale];
  const language = locale.split("-")[0] || LANGUAGE_BY_NAME[market.language] || "en";
  if (!location) {
    throw new Error(
      `Für den Markt „${market.country} / ${market.language}" ist kein SERP-Standort hinterlegt (locale: ${locale || "leer"}).`,
    );
  }
  return {
    location_code: location,
    language_code: language,
    host: marketHost(market),
    site: siteOperand(market),
    path_prefix: marketPathPrefix(market),
  };
}

/** Suchanfrage immer auf die Zieldomain (inkl. Sprachverzeichnis) einschränken. */
export function buildKeyword(query: string, site: string): string {
  const cleaned = query.replace(/site:\S+/gi, "").trim();
  return `site:${site} ${cleaned}`.trim();
}


interface DfsResponse {
  status_code?: number;
  status_message?: string;
  tasks?: {
    status_code?: number;
    status_message?: string;
    result?: {
      items?: {
        type?: string;
        rank_absolute?: number;
        url?: string;
        title?: string;
        description?: string;
      }[];
    }[];
  }[];
}

type SerpTarget = ReturnType<typeof serpTarget>;

async function runOne(
  query: string,
  target: SerpTarget,
  signal: AbortSignal,
): Promise<SerpQueryResult> {
  const keyword = buildKeyword(query, target.site);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: authHeader() },
    body: JSON.stringify([
      {
        keyword,
        location_code: target.location_code,
        language_code: target.language_code,
        depth: SERP_DEPTH,
        device: "desktop",
      },
    ]),
  });
  if (!res.ok) {
    return { query, keyword, status: "error", items: [], error: `HTTP ${res.status}` };
  }
  const json = (await res.json()) as DfsResponse;
  const task = json.tasks?.[0];
  if ((json.status_code ?? 0) !== 20000 || !task) {
    return {
      query,
      keyword,
      status: "error",
      items: [],
      error: json.status_message ?? "Unerwartete Antwort von DataForSEO.",
    };
  }
  if ((task.status_code ?? 0) !== 20000) {
    return {
      query,
      keyword,
      status: "error",
      items: [],
      error: task.status_message ?? "Task-Fehler",
    };
  }
  const items: SerpItem[] = (task.result?.[0]?.items ?? [])
    .filter((i) => i.type === "organic" && typeof i.url === "string")
    .map((i) => ({
      url: i.url as string,
      title: i.title ?? null,
      description: i.description ?? null,
      rank: i.rank_absolute ?? null,
    }))
    .filter((i) => {
      try {
        const u = new URL(i.url);
        if (u.hostname.replace(/^www\./, "") !== target.host) return false;
        if (target.path_prefix && !u.pathname.startsWith(`${target.path_prefix}/`)) return false;
        return true;
      } catch {
        return false;
      }
    });
  return { query, keyword, status: "ok", items };
}

/**
 * Abfragen parallel, hartes Gesamtbudget. Nicht rechtzeitig beantwortete
 * Abfragen werden als „skipped" zurückgegeben.
 */
export async function runSerpQueries(
  queries: string[],
  market: SerpMarket,
  opts: { timeoutMs?: number; maxQueries?: number } = {},
): Promise<{
  results: SerpQueryResult[];
  location_code: number;
  language_code: string;
  host: string;
  site: string;
  path_prefix: string;
}> {
  const target = serpTarget(market);
  const list = queries
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, opts.maxQueries ?? SERP_MAX_QUERIES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SERP_TOTAL_TIMEOUT_MS);
  try {
    const settled = await Promise.allSettled(
      list.map((q) => runOne(q, target, controller.signal)),
    );
    const results = settled.map((s, i) => {
      const query = list[i] as string;
      if (s.status === "fulfilled") return s.value;
      const err = s.reason as { name?: string; message?: string };
      const aborted = err?.name === "AbortError" || controller.signal.aborted;
      return {
        query,
        keyword: buildKeyword(query, target.site),
        status: aborted ? ("skipped" as const) : ("error" as const),
        items: [],
        error: aborted ? "Zeitbudget von 5 Minuten überschritten." : (err?.message ?? "Fehler"),
      };
    });
    return { results, ...target };
  } finally {
    clearTimeout(timer);

  }
}
