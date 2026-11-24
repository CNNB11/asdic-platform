import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { chargeOp } from "@/lib/billing/credits";

/** Версия промптов: менять при каждой правке prompts.ts, чтобы сравнивать качество по журналу */
export const PROMPT_VERSION = "2026-11-24.1";

export interface CallCtx {
  planId?: string;
  opId?: string;
  userId?: string;
  kind: string;
  /** Себестоимость всех вызовов внутри операции, $; копится по мере вызовов */
  spentUsd?: number;
}

const als = new AsyncLocalStorage<CallCtx>();
export const withCallCtx = <T>(ctx: CallCtx, fn: () => Promise<T>) => als.run(ctx, fn);
export const callCtx = () => als.getStore();

/** Добавляет себестоимость к текущей операции (для провайдеров, которые пишут журнал сами) */
export function addSpent(usd: number) {
  const c = als.getStore();
  if (c) c.spentUsd = (c.spentUsd ?? 0) + usd;
}

/**
 * Платная ИИ-операция: выполняет fn и после успеха списывает фиксированную цену price (ключ из tiers.ts).
 * Неудачная операция бесплатна. chargeIf: дополнительное условие списания (например, тренды из кэша бесплатны).
 */
export async function metered<T>(ctx: CallCtx, price: string, fn: () => Promise<T>, o?: { ref?: string; chargeIf?: (result: T, spentUsd: number) => boolean }): Promise<T> {
  const c: CallCtx = { ...ctx, spentUsd: 0 };
  const result = await als.run(c, fn);
  if (!o?.chargeIf || o.chargeIf(result, c.spentUsd ?? 0)) {
    await chargeOp({ userId: c.userId, kind: price, ref: o?.ref ?? c.opId ?? newId(), costUsd: c.spentUsd ?? 0 });
  }
  return result;
}

/** Цены Claude API, $ за 1M токенов (ноябрь 2026). Запись в кэш = 1,25 × вход на 5 минут, 2 × вход на час. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
const WEB_SEARCH_USD = 10 / 1000;

/** cacheWrite — вся запись в кэш; cacheWrite1h — её часть с TTL 1 час */
export function costUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; searches: number }) {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const p = key ? PRICES[key] : PRICES["claude-opus-5-5"];
  const w1h = Math.min(u.cacheWrite1h ?? 0, u.cacheWrite);
  const w5m = u.cacheWrite - w1h;
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + w5m * p.in * 1.25 + w1h * p.in * 2) / 1e6 + u.searches * WEB_SEARCH_USD;
}

/** Стоимость по Usage из слоя ИИ (для визуалов, которые сохраняют цену отдельно) */
export function usageCostUsd(u: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; cacheWrite1hTokens?: number }) {
  return costUsd(u.model, { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens ?? 0, cacheWrite: u.cacheWriteTokens ?? 0, cacheWrite1h: u.cacheWrite1hTokens ?? 0, searches: 0 });
}

export interface CallRecord {
  step: "structured" | "research";
  model: string;
  started: number;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null; server_tool_use?: { web_search_requests?: number | null } | null } | null;
  stopReason?: string | null;
  error?: string;
  request: string;
  response: string;
}

/** Пишет один вызов в журнал. Ошибки журнала не ломают основную операцию. */
export async function logCall(r: CallRecord) {
  const ctx = callCtx();
  const u = {
    input: r.usage?.input_tokens ?? 0,
    output: r.usage?.output_tokens ?? 0,
    cacheRead: r.usage?.cache_read_input_tokens ?? 0,
    cacheWrite: r.usage?.cache_creation_input_tokens ?? 0,
    cacheWrite1h: r.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    searches: r.usage?.server_tool_use?.web_search_requests ?? 0,
  };
  const id = newId();
  const cost = costUsd(r.model, u);
  try {
    await db.insert(schema.aiCalls).values({
      id,
      planId: ctx?.planId ?? null,
      opId: ctx?.opId ?? null,
      userId: ctx?.userId ?? null,
      kind: ctx?.kind ?? "unknown",
      step: r.step,
      promptVersion: PROMPT_VERSION,
      model: r.model,
      inputTokens: u.input,
      outputTokens: u.output,
      cacheReadTokens: u.cacheRead,
      cacheWriteTokens: u.cacheWrite,
      webSearches: u.searches,
      costUsd: cost.toFixed(5),
      durationMs: Date.now() - r.started,
      stopReason: r.stopReason ?? null,
      error: r.error ?? null,
      requestPreview: r.request.slice(0, 6000),
      responsePreview: r.response.slice(0, 6000),
    });
  } catch (e) {
    console.error("ai_calls log failed", e);
  }
  if (ctx) ctx.spentUsd = (ctx.spentUsd ?? 0) + cost;
}

/** Убирает полный текст источников из превью запроса: в журнал идёт только список */
export function previewContent(blocks: { type: string; text?: string }[]) {
  return blocks
    .map((b) => (b.type === "text" ? (b.text ?? "").replace(/<source id="([^"]+)" title="([^"]*)">[\s\S]*?<\/source>/g, '<source id="$1" title="$2">…</source>') : `[${b.type}]`))
    .join("\n\n");
}
