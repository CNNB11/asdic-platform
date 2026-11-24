import "server-only";

/**
 * Слой ИИ, не зависящий от провайдера. Операции платформы (ops.ts) знают только этот интерфейс.
 * Провайдер выбирается переменной AI_PROVIDER: claude (по умолчанию). Для России сюда добавляется
 * адаптер российского провайдера или собственной модели на серверах в РФ — без правки операций.
 */

/**
 * Кусок промпта. cache = провайдер может закэшировать этот префикс:
 * true — на 5 минут (серия вызовов подряд), "long" — на час (источники плана, к которым возвращаются в течение сессии).
 */
export interface Part {
  text: string;
  cache?: boolean | "long";
}

/**
 * top — самая сильная модель: красные решения (выбирает человек) и бренд-борды;
 * main — основная рабочая модель: черновики, улучшения, проверка, поиск, макеты;
 * fast — дешёвая для предобработки источников.
 */
export type Tier = "top" | "main" | "fast";

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Часть записи в кэш с TTL 1 час (стоит 2× вход вместо 1,25×) */
  cacheWrite1hTokens?: number;
}

export interface StructuredRequest {
  system: string;
  parts: Part[];
  /** JSON Schema ответа. Если провайдер не умеет строгий формат, адаптер сам проверяет ответ по схеме. */
  schema: Record<string, unknown>;
  tier?: Tier;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface WebFinding {
  url: string;
  title: string;
  /** Дословные фрагменты страницы: по ним потом проверяются цитаты */
  quotes: string[];
}

export interface ResearchResult {
  notes: string;
  queries: string[];
  findings: WebFinding[];
  usage: Usage;
}

export interface AIProvider {
  id: string;
  /** Что умеет провайдер: интерфейс прячет кнопки, которых нет */
  capabilities: { webSearch: boolean };
  structured<T>(req: StructuredRequest): Promise<{ data: T; usage: Usage }>;
  webResearch(req: { system: string; parts: Part[]; maxSearches?: number }): Promise<ResearchResult>;
}

/** Понятная пользователю ошибка ИИ */
export class AIError extends Error {}

let _provider: AIProvider | null = null;

export async function provider(): Promise<AIProvider> {
  if (_provider) return _provider;
  const id = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  switch (id) {
    case "claude": {
      const { claudeProvider } = await import("./providers/claude");
      _provider = claudeProvider();
      break;
    }
    default:
      throw new AIError(`Провайдер ИИ «${id}» не подключён`);
  }
  return _provider;
}

export async function structured<T>(req: StructuredRequest) {
  return (await provider()).structured<T>(req);
}

export async function webResearch(req: { system: string; parts: Part[]; maxSearches?: number }) {
  const p = await provider();
  if (!p.capabilities.webSearch) throw new AIError("Поиск в интернете недоступен у текущего провайдера ИИ");
  return p.webResearch(req);
}

export async function capabilities() {
  try {
    return (await provider()).capabilities;
  } catch {
    return { webSearch: false };
  }
}
