import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { chargeCall } from "@/lib/billing/credits";

/** Версия промптов: менять при каждой правке prompts.ts, чтобы сравнивать качество по журналу */
export const PROMPT_VERSION = "2026-11-23.1";

export interface CallCtx {
  planId?: string;
  opId?: string;
  userId?: string;
  kind: string;
}

const als = new AsyncLocalStorage<CallCtx>();
export const withCallCtx = <T>(ctx: CallCtx, fn: () => Promise<T>) => als.run(ctx, fn);
export const callCtx = () => als.getStore();

/** Цены Claude API, $ за 1M токенов (ноябрь 2026). Запись в кэш = 1,25 × вход. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
const WEB_SEARCH_USD = 10 / 1000;

export function costUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number }) {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const p = key ? PRICES[key] : PRICES["claude-opus-5-5"];
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.in * 1.25) / 1e6 + u.searches * WEB_SEARCH_USD;
}

export interface CallRecord {
  step: "structured" | "research";
  model: string;
  started: number;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; server_tool_use?: { web_search_requests?: number | null } | null } | null;
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
  // Списываем кредиты по реальной себестоимости, даже если вызов закончился ошибкой после оплаты токенов
  await chargeCall({ userId: ctx?.userId, costUsd: cost, ref: id, kind: ctx?.kind ?? "unknown" });
}

/** Убирает полный текст источников из превью запроса: в журнал идёт только список */
export function previewContent(blocks: { type: string; text?: string }[]) {
  return blocks
    .map((b) => (b.type === "text" ? (b.text ?? "").replace(/<source id="([^"]+)" title="([^"]*)">[\s\S]*?<\/source>/g, '<source id="$1" title="$2">…</source>') : `[${b.type}]`))
    .join("\n\n");
}
