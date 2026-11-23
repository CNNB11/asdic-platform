import "server-only";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "./auth";
import { getMethod } from "@/method";

/** Возвращает план, только если он принадлежит текущему пользователю */
export async function requirePlan(planId: string) {
  const user = await requireUser();
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, planId), eq(schema.plans.ownerId, user.id)));
  if (!plan) notFound();
  return { user, plan, method: getMethod(plan.methodKey) };
}

/** Уровень метода по ключу из адреса или 404 */
export function sectionOr404(method: ReturnType<typeof getMethod>, sectionKey: string) {
  for (const stage of method.stages) {
    const section = stage.sections.find((s) => s.key === sectionKey);
    if (section) return { stage, section };
  }
  notFound();
}

/** Запись плана или 404 */
export async function itemOr404(planId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!item) notFound();
  return item;
}
