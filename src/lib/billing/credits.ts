import "server-only";
import { and, count, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { chargeFor, estimate, fmtCredits, tierOf } from "./tiers";

type User = typeof schema.users.$inferSelect;

/** Админы (ADMIN_EMAILS) работают без списаний, чтобы проверять платформу */
export function isAdminEmail(email: string) {
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

const ACTIVE = ["active", "trialing"];
const MONTH = sql`interval '1 month'`;

export interface Wallet {
  tier: ReturnType<typeof tierOf>;
  plan: number;
  extra: number;
  total: number;
  unlimited: boolean;
  resetAt: Date | null;
  status: string | null;
}

/** Остаток кредитов. Заодно раз в месяц пополняет кредиты тарифа (без отдельного планировщика). */
export async function wallet(userId: string): Promise<Wallet> {
  for (let i = 0; i < 3; i++) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u) throw new Error("Пользователь не найден");
    const tier = tierOf(u.tier);
    const due = i < 2 && tier.key !== "free" && ACTIVE.includes(u.subscriptionStatus ?? "") && u.creditsResetAt && u.creditsResetAt.getTime() <= Date.now();
    if (!due) {
      return { tier, plan: u.creditsPlan, extra: u.creditsExtra, total: u.creditsPlan + u.creditsExtra, unlimited: isAdminEmail(u.email), resetAt: u.creditsResetAt, status: u.subscriptionStatus };
    }
    // Условие «дата уже наступила» делает пополнение однократным даже при параллельных запросах.
    // Если пропущено несколько месяцев, дата сдвигается сразу на ближайшую будущую.
    const done = await db
      .update(schema.users)
      .set({
        creditsPlan: tier.credits,
        creditsResetAt: sql`${schema.users.creditsResetAt} + ${MONTH} * (1 + floor(extract(epoch from now() - ${schema.users.creditsResetAt}) / 2629800))::int`,
      })
      .where(and(eq(schema.users.id, userId), isNotNull(schema.users.creditsResetAt), lte(schema.users.creditsResetAt, sql`now()`)))
      .returning({ id: schema.users.id });
    if (done.length) {
      await db.insert(schema.creditLedger).values({ id: newId(), userId, delta: tier.credits, reason: "refill", note: `Кредиты тарифа ${tier.name} на месяц` });
    }
  }
  throw new Error("Не удалось прочитать кредиты");
}

export class CreditsError extends Error {
  constructor(
    public need: number,
    public have: number,
  ) {
    super(`Не хватает кредитов: операция стоит около ${fmtCredits(need)}, у вас ${fmtCredits(Math.max(0, have))}. Пополните баланс на странице «Тариф и кредиты».`);
  }
}

/** Проверка перед запуском ИИ. need = оценка в кредитах. */
export async function ensureCredits(user: Pick<User, "id" | "email">, need: number) {
  if (isAdminEmail(user.email)) return;
  const w = await wallet(user.id);
  if (w.total < need) throw new CreditsError(need, w.total);
}

export const ensureFor = (user: Pick<User, "id" | "email">, kind: string, times = 1) => ensureCredits(user, estimate(kind) * times);

/**
 * Списание за успешную ИИ-операцию по фиксированной цене (см. tiers.ts). Сначала тратятся кредиты тарифа, потом купленные.
 * ref уникален для операции: повтор не спишет дважды. Ошибки не ломают основную операцию.
 */
export async function chargeOp(a: { userId: string | null | undefined; kind: string; ref: string; costUsd: number }) {
  if (!a.userId) return;
  const n = chargeFor(a.kind, a.costUsd);
  try {
    const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, a.userId));
    if (!u || isAdminEmail(u.email)) return;
    await db.transaction(async (tx) => {
      const ins = await tx
        .insert(schema.creditLedger)
        .values({ id: newId(), userId: a.userId!, delta: -n, reason: "ai", ref: `op:${a.ref}`, note: a.kind, costUsd: a.costUsd.toFixed(5) })
        .onConflictDoNothing()
        .returning({ id: schema.creditLedger.id });
      if (!ins.length) return;
      await tx
        .update(schema.users)
        .set({
          creditsPlan: sql`greatest(${schema.users.creditsPlan} - ${n}, 0)`,
          creditsExtra: sql`${schema.users.creditsExtra} - greatest(${n} - ${schema.users.creditsPlan}, 0)`,
        })
        .where(eq(schema.users.id, a.userId!));
    });
  } catch (e) {
    console.error("credit charge failed", e);
  }
}

/** Начисление купленных кредитов (пакет, ручное от админа). ref уникален: повтор не начислит дважды. Возвращает, было ли начисление. */
export async function grantExtra(a: { userId: string; credits: number; reason: string; ref?: string; note?: string }) {
  return db.transaction(async (tx) => {
    const ins = await tx
      .insert(schema.creditLedger)
      .values({ id: newId(), userId: a.userId, delta: a.credits, reason: a.reason, ref: a.ref ?? null, note: a.note ?? "" })
      .onConflictDoNothing()
      .returning({ id: schema.creditLedger.id });
    if (!ins.length) return false;
    await tx
      .update(schema.users)
      .set({ creditsExtra: sql`${schema.users.creditsExtra} + ${a.credits}` })
      .where(eq(schema.users.id, a.userId));
    return true;
  });
}

/** Можно ли создать ещё один план на текущем тарифе */
export async function canCreatePlan(user: Pick<User, "id" | "email" | "tier">) {
  if (isAdminEmail(user.email)) return true;
  const tier = tierOf(user.tier);
  if (tier.maxPlans == null) return true;
  const [{ n }] = await db.select({ n: count() }).from(schema.plans).where(eq(schema.plans.ownerId, user.id));
  return n < tier.maxPlans;
}
