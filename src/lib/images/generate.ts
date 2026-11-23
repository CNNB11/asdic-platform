import "server-only";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { storeFile } from "@/lib/sources";
import { PROMPT_VERSION } from "@/lib/ai/telemetry";
import { ASPECTS, ImageError, composePrompt, imageProvider, type Aspect } from "./provider";

type Item = typeof schema.items.$inferSelect;

/** Генерирует count вариантов по записи-концепции, сохраняет файлы и пишет каждый вызов в журнал ИИ */
export async function generateVisuals(a: { planId: string; item: Item; userId: string; count: number; aspect?: string; prompt?: string }) {
  const p = await imageProvider();
  const v = a.item.values;
  const prompt = String(a.prompt ?? v.prompt ?? "").trim();
  if (!prompt) throw new ImageError("Заполните промпт концепции");
  const aspect: Aspect = (ASPECTS as string[]).includes(String(a.aspect ?? v.aspect)) ? (String(a.aspect ?? v.aspect) as Aspect) : "1:1";
  const req = { prompt, avoid: String(v.avoid ?? ""), aspect };
  const sent = composePrompt(req, p.maxPrompt);
  const count = Math.min(4, Math.max(1, a.count));
  const results = await Promise.allSettled(
    Array.from({ length: count }, async () => {
      const started = Date.now();
      try {
        const r = await p.generate({ ...req, seed: Math.floor(Math.random() * 1e9) });
        const key = await storeFile(r.bytes, r.ext);
        await db.insert(schema.visuals).values({
          id: newId(),
          planId: a.planId,
          itemId: a.item.id,
          storageKey: key,
          mime: r.mime,
          prompt: sent,
          aspect,
          provider: p.id,
          model: r.model,
          costUsd: r.costUsd.toFixed(4),
          createdBy: a.userId,
        });
        await log(a, p.id, r.model, r.costUsd, started, sent, `${r.mime}, ${r.bytes.length} байт`);
      } catch (e) {
        await log(a, p.id, p.id, 0, started, sent, "", (e as Error).message);
        throw e;
      }
    }),
  );
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length === count) {
    const e = failed[0].reason;
    throw e instanceof ImageError ? e : new ImageError(`Не удалось сгенерировать изображение: ${(e as Error).message}`);
  }
  return { made: count - failed.length, failed: failed.length };
}

async function log(a: { planId: string; userId: string }, provider: string, model: string, cost: number, started: number, request: string, response: string, error?: string) {
  try {
    await db.insert(schema.aiCalls).values({
      id: newId(),
      planId: a.planId,
      userId: a.userId,
      kind: "image",
      step: "image",
      promptVersion: PROMPT_VERSION,
      model: `${provider}: ${model}`,
      costUsd: cost.toFixed(5),
      durationMs: Date.now() - started,
      error: error ?? null,
      requestPreview: request,
      responsePreview: response,
    });
  } catch (e) {
    console.error("ai_calls log failed", e);
  }
}
