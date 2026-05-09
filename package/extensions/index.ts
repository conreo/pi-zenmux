import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ZENMUX_BASE_URL = "https://zenmux.ai/api/v1";
const CACHE_DIR = join(process.env.HOME ?? "~", ".cache", "pi-zenmux");
const CACHE_FILE = join(CACHE_DIR, "models.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ========== Model caching (unchanged) ==========
interface ZenMuxPricingTier { value: number; unit: string; currency: string; }
interface ZenMuxModel {
  id: string; display_name: string; input_modalities: string[];
  capabilities: { reasoning: boolean }; context_length: number;
  pricings: { prompt?: ZenMuxPricingTier[]; completion?: ZenMuxPricingTier[]; input_cache_read?: ZenMuxPricingTier[]; };
}
function basePrice(tiers?: ZenMuxPricingTier[]): number { return tiers?.[0]?.value ?? 0; }
function readCacheSync(): ZenMuxModel[] | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    if (Date.now() - statSync(CACHE_FILE).mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")).models;
  } catch { return null; }
}
function readStaleCacheSync(): ZenMuxModel[] | null {
  try { if (!existsSync(CACHE_FILE)) return null; return JSON.parse(readFileSync(CACHE_FILE, "utf-8")).models; } catch { return null; }
}
function writeCacheSync(models: ZenMuxModel[]): void {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), models })); } catch {}
}
function toProviderModels(models: ZenMuxModel[]) {
  return models.map((m) => {
    const isDeepSeek = m.id.toLowerCase().includes("deepseek");
    const isDeepSeekReasoner = /deepseek[\/-](reasoner|r1)/i.test(m.id);
    const hasReasoning = m.capabilities?.reasoning ?? false;

    // DeepSeek non-reasoner models: enable reasoning + compat flags so Pi
    // natively manages reasoning_content (required for thinking mode + tool calls).
    // DeepSeek reasoner models: reasoning is always enabled (it's their core).
    // Non-deepseek models: use whatever the API reports.
    const model: any = {
      id: m.id,
      name: m.display_name,
      reasoning: isDeepSeek ? (hasReasoning || !isDeepSeekReasoner) : hasReasoning,
      input: (m.input_modalities.includes("image") ? ["text", "image"] : ["text"]) as ("text" | "image")[],
      cost: {
        input: basePrice(m.pricings?.prompt),
        output: basePrice(m.pricings?.completion),
        cacheRead: basePrice(m.pricings?.input_cache_read),
        cacheWrite: 0,
      },
      contextWindow: m.context_length,
      maxTokens: hasReasoning ? 65536 : 16384,
    };

    // Add DeepSeek compat so Pi's built-in reasoning_content management activates.
    // Pi auto-detects deepseek compat from URLs containing "deepseek.com", but
    // ZenMux uses zenmux.ai URLs, so we must set these flags explicitly.
    if (isDeepSeek && !isDeepSeekReasoner) {
      model.compat = {
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "deepseek",
      };
      model.thinkingLevelMap = {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: "max" as string | null,
      };
    }

    return model;
  });
}
// ========== Fetch interceptor: disable thinking + role sanitization ==========
function installZenMuxFix(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.toString();
    // Match any ZenMux chat completions endpoint (including /v1/chat/completions)
    if (!url.includes("zenmux.ai") || !(url.includes("/chat/completions") || url.includes("/v1/chat/completions"))) {
      return originalFetch(input, init);
    }

    let bodyObj: any = {};
    try {
      bodyObj = JSON.parse((init?.body as string) ?? "{}");
    } catch {
      return originalFetch(input, init);
    }

    // 1. Sanitize roles: rename "developer" -> "system" for ZenMux compat
    if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
      for (const msg of bodyObj.messages) {
        if (msg.role === "developer") {
          console.log("[zenmux] Renamed role 'developer' -> 'system'");
          msg.role = "system";
        }
      }
    }

    // Replace the request body
    init = { ...init, body: JSON.stringify(bodyObj) };
    return originalFetch(input, init);
  };
}

// ========== Extension entry ==========
export default function (pi: ExtensionAPI) {
  installZenMuxFix();

  const apiKey = process.env.ZENMUX_API_KEY;
  if (!apiKey) {
    console.error("[zenmux] ZENMUX_API_KEY not set");
    return;
  }

  const cached = readCacheSync();
  if (cached) {
    pi.registerProvider("zenmux", {
      baseUrl: ZENMUX_BASE_URL,
      apiKey: "ZENMUX_API_KEY",
      api: "openai-completions",
      models: toProviderModels(cached),
    });
    console.log(`[zenmux] ${cached.length} models from cache`);
  } else {
    pi.registerProvider("zenmux", { baseUrl: ZENMUX_BASE_URL, apiKey: "ZENMUX_API_KEY", api: "openai-completions", models: [] });
    (async () => {
      try {
        const res = await fetch(`${ZENMUX_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const models: ZenMuxModel[] = ((await res.json()) as { data: ZenMuxModel[] }).data;
        writeCacheSync(models);
        pi.registerProvider("zenmux", { baseUrl: ZENMUX_BASE_URL, apiKey: "ZENMUX_API_KEY", api: "openai-completions", models: toProviderModels(models) });
        console.log(`[zenmux] ${models.length} models fetched`);
      } catch (err) { console.error(`[zenmux] model fetch failed: ${err}`); }
    })();
  }

  pi.registerCommand("zenmux-refresh", {
    description: "Refresh ZenMux model list",
    handler: async (_args, ctx) => {
      try {
        const res = await fetch(`${ZENMUX_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const models: ZenMuxModel[] = ((await res.json()) as { data: ZenMuxModel[] }).data;
        writeCacheSync(models);
        pi.registerProvider("zenmux", { baseUrl: ZENMUX_BASE_URL, apiKey: "ZENMUX_API_KEY", api: "openai-completions", models: toProviderModels(models) });
        ctx.ui.notify(`Refreshed ${models.length} ZenMux models`, "success");
      } catch (err) { ctx.ui.notify(`Refresh failed: ${err}`, "error"); }
    },
  });
}
