"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";
import { grantExtra } from "@/lib/billing/credits";
import { ensureWebhook, paddleApi, portalUrl, priceIds, syncCatalog } from "@/lib/billing/paddle";
import type { PriceKey } from "@/lib/billing/tiers";
import { newId } from "@/lib/ids";

const msg = (path: string, key: string, text: string) => redirect(`${path}?${key}=${encodeURIComponent(text.slice(0, 400))}`);

/** Личный кабинет Paddle: карта, счета, отмена подписки */
export async function openPortal() {
  const user = await requireUser();
  if (!user.paddleCustomerId) msg("/billing", "err", "Подписки ещё нет");
  let url = "";
  try {
    url = await portalUrl(user.paddleCustomerId!, user.paddleSubscriptionId);
  } catch (e) {
    msg("/billing", "err", (e as Error).message);
  }
  redirect(url);
}

/** Смена тарифа у действующей подписки: разница пересчитывается и списывается сразу */
export async function changePlan(key: string) {
  const user = await requireUser();
  if (!user.paddleSubscriptionId || !["active", "trialing"].includes(user.subscriptionStatus ?? "")) msg("/billing", "err", "Нет действующей подписки");
  let ok = false;
  try {
    const priceId = (await priceIds()).get(key as PriceKey);
    if (!priceId || key.startsWith("pack_")) throw new Error("Тариф не найден");
    await paddleApi(`/subscriptions/${user.paddleSubscriptionId}`, {
      method: "PATCH",
      body: { items: [{ price_id: priceId, quantity: 1 }], proration_billing_mode: "prorated_immediately" },
    });
    ok = true;
  } catch (e) {
    msg("/billing", "err", (e as Error).message);
  }
  if (ok) redirect("/billing?changed=1");
}

// ---------- админ ----------

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return process.env.APP_URL || `${proto}://${host}`;
}

/** Одна кнопка: создать тарифы и пакеты в Paddle и подключить вебхук */
export async function adminSetupPaddle() {
  await requireAdmin();
  let text = "";
  try {
    const created = await syncCatalog();
    const hook = await ensureWebhook(await baseUrl());
    text = `${created.length ? `Созданы цены: ${created.join(", ")}.` : "Все цены уже были в Paddle."} Вебхук: ${hook}`;
  } catch (e) {
    msg("/admin/billing", "err", (e as Error).message);
  }
  msg("/admin/billing", "ok", text);
}

/** Ручное начисление (подарок, компенсация) или списание кредитов */
export async function adminGrant(fd: FormData) {
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const credits = Math.trunc(Number(fd.get("credits") ?? 0));
  const note = String(fd.get("note") ?? "").trim();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) msg("/admin/billing", "err", `Нет пользователя ${email}`);
  if (!credits || Math.abs(credits) > 100_000) msg("/admin/billing", "err", "Укажите число кредитов");
  await grantExtra({ userId: u!.id, credits, reason: "admin", ref: `admin:${newId()}`, note: `${note || "Вручную"} (${admin.email})` });
  revalidatePath("/admin/billing");
  msg("/admin/billing", "ok", `${email}: ${credits > 0 ? "+" : ""}${credits} кредитов`);
}

/** Тариф вручную (например, бесплатный Pro партнёру). Кредиты тарифа выдаются сразу и пополняются раз в месяц. */
export async function adminSetTier(fd: FormData) {
  await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const tier = String(fd.get("tier") ?? "free");
  const { tierOf } = await import("@/lib/billing/tiers");
  const t = tierOf(tier);
  const res = await db
    .update(schema.users)
    .set(
      t.key === "free"
        ? { tier: "free", subscriptionStatus: null, creditsPlan: 0, creditsResetAt: null }
        : { tier: t.key, subscriptionStatus: "active", creditsPlan: t.credits, creditsResetAt: sql`now() + interval '1 month'` },
    )
    .where(eq(schema.users.email, email))
    .returning({ id: schema.users.id });
  if (!res.length) msg("/admin/billing", "err", `Нет пользователя ${email}`);
  revalidatePath("/admin/billing");
  msg("/admin/billing", "ok", `${email}: тариф ${t.name}`);
}
