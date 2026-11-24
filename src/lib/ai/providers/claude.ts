import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { logCall, previewContent } from "../telemetry";
import { AIError, type AIProvider, type Part, type ResearchResult, type StructuredRequest, type Tier, type Usage, type WebFinding } from "../provider";

/** Единая точка вызова Claude: здесь журнал, сюда же позже можно подключить Langfuse */
async function call(step: "structured" | "research", params: Parameters<Anthropic["beta"]["messages"]["stream"]>[0]): Promise<BetaMessage> {
  const started = Date.now();
  const last = params.messages[params.messages.length - 1];
  const request = Array.isArray(last.content) ? previewContent(last.content as { type: string; text?: string }[]) : String(last.content);
  try {
    const msg = await client().beta.messages.stream(params).finalMessage();
    const response = msg.content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
    await logCall({ step, model: msg.model, started, usage: msg.usage, stopReason: msg.stop_reason, request, response });
    return msg;
  } catch (e) {
    await logCall({ step, model: params.model, started, error: (e as Error).message, request, response: "" });
    throw e;
  }
}

/**
 * Модели по ступеням. Меняются переменными окружения без правки кода.
 * Opus в 2 раза дороже Sonnet, поэтому он остаётся только там, где цена слабого ответа выше всего.
 */
const MODELS: Record<Tier, string> = {
  top: process.env.ASDIC_TOP_MODEL ?? "claude-opus-5-5",
  main: process.env.ASDIC_MODEL ?? "claude-sonnet-5-5",
  fast: process.env.ASDIC_FAST_MODEL ?? "claude-haiku-5-5",
};
/** Модель онлайн-исследования: читает выдачу поиска и пишет конспект с цитатами */
const RESEARCH_MODEL = process.env.ASDIC_RESEARCH_MODEL ?? MODELS.main;
/** Сколько поисковых запросов можно сделать за одну операцию с интернетом */
const MAX_SEARCHES = Number(process.env.ASDIC_MAX_SEARCHES ?? 4) || 4;

let _client: Anthropic | null = null;
function client() {
  // ASDIC_ANTHROPIC_API_KEY — своё имя, чтобы не пересекаться с ANTHROPIC_* в средах, где их задаёт инструмент (например, Claude Code)
  const apiKey = process.env.ASDIC_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AIError("Не задан ключ Claude API (переменная ASDIC_ANTHROPIC_API_KEY или ANTHROPIC_API_KEY). Добавьте его в настройки окружения.");
  }
  // Адрес API задаётся явно: чужой ANTHROPIC_BASE_URL из окружения не должен уводить запросы платформы
  _client ??= new Anthropic({
    apiKey,
    baseURL: process.env.ASDIC_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    timeout: 15 * 60 * 1000,
  });
  return _client;
}

/** Части промпта → блоки Claude; cache = точка кэширования префикса */
function toBlocks(parts: Part[]): BetaContentBlockParam[] {
  return parts.map((p) =>
    p.cache
      ? { type: "text", text: p.text, cache_control: p.cache === "long" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" } }
      : { type: "text", text: p.text },
  );
}

function usageOf(model: string, u: BetaMessage["usage"]): Usage {
  return {
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

/** Модели с серверными fallback при отказе (у Haiku его нет) */
function fallbackParams(model: string) {
  return model.startsWith("claude-haiku") ? {} : { fallbacks: "default" as const };
}

function betas(model: string) {
  return model.startsWith("claude-haiku") ? [] : ["server-side-fallback-2026-07-01"];
}

/** Один вызов со строгой JSON-схемой ответа */
async function structured<T>(opts: StructuredRequest): Promise<{ data: T; usage: Usage }> {
  const model = MODELS[opts.tier ?? "main"];
  const msg = await call("structured", {
    model,
    max_tokens: opts.maxTokens ?? 32000,
    betas: betas(model),
    ...fallbackParams(model),
    system: opts.system,
    messages: [{ role: "user", content: toBlocks(opts.parts) }],
    output_config: {
      effort: opts.effort ?? "medium",
      format: { type: "json_schema", schema: opts.schema },
    },
  });
  if (msg.stop_reason === "refusal") throw new AIError("Модель отказалась выполнять запрос. Попробуйте переформулировать указания.");
  if (msg.stop_reason === "max_tokens") throw new AIError("Ответ не поместился в лимит. Сократите число записей или указания.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new AIError("Модель вернула ответ в неверном формате. Повторите попытку.");
  }
  return { data, usage: usageOf(msg.model, msg.usage) };
}

/** Шаг исследования: Claude ищет в интернете и пишет конспект с цитатами найденных страниц */
async function webResearch(opts: { system: string; parts: Part[]; maxSearches?: number }): Promise<ResearchResult> {
  const model = RESEARCH_MODEL;
  const messages: BetaMessageParam[] = [{ role: "user", content: toBlocks(opts.parts) }];
  const queries: string[] = [];
  const byUrl = new Map<string, WebFinding>();
  const notes: string[] = [];
  const usage: Usage = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 };

  for (let turn = 0; turn < 5; turn++) {
    const msg = await call("research", {
        model,
        // Конспект короткий: длинный лимит здесь не нужен
        max_tokens: 12000,
        betas: betas(model),
        ...fallbackParams(model),
        system: opts.system,
        messages,
        // Базовый вариант поиска: у web_search_20260209 (динамическая фильтрация) модель читает страницы через
        // выполнение кода, и в итоговом тексте нет цитат — тогда источники остаются пустыми и проверить факты нечем
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: opts.maxSearches ?? MAX_SEARCHES }],
        output_config: { effort: "medium" },
      });
    const u = usageOf(model, msg.usage);
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cacheReadTokens! += u.cacheReadTokens ?? 0;
    usage.cacheWriteTokens! += u.cacheWriteTokens ?? 0;
    usage.cacheWrite1hTokens! += u.cacheWrite1hTokens ?? 0;

    for (const b of msg.content) {
      if (b.type === "server_tool_use" && b.name === "web_search") {
        const q = (b.input as { query?: string })?.query;
        if (q) queries.push(q);
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r.type === "web_search_result" && !byUrl.has(r.url)) byUrl.set(r.url, { url: r.url, title: r.title, quotes: [] });
        }
      }
      if (b.type === "text") {
        notes.push(b.text);
        for (const c of b.citations ?? []) {
          if (c.type === "web_search_result_location") {
            const f = byUrl.get(c.url) ?? { url: c.url, title: c.title ?? c.url, quotes: [] };
            if (c.cited_text && !f.quotes.includes(c.cited_text)) f.quotes.push(c.cited_text);
            byUrl.set(c.url, f);
          }
        }
      }
    }
    if (msg.stop_reason === "refusal") throw new AIError("Модель отказалась выполнять исследование.");
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }
  // Сохраняем только страницы, из которых есть цитаты: только их можно проверить
  const findings = [...byUrl.values()].filter((f) => f.quotes.length > 0);
  return { notes: notes.join(""), queries, findings, usage };
}

export function claudeProvider(): AIProvider {
  return { id: "claude", capabilities: { webSearch: true }, structured, webResearch };
}
