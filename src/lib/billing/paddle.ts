import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { grantExtra } from "./credits";
import { PACKS, TIERS, tierOf, type PriceKey, type TierKey } from "./tiers";

/**
 * Paddle Billing: продаёт от своего имени (merchant of record), сам считает и платит налоги.
 * Переменные окружения: PADDLE_ENV (sandbox | production), PADDLE_API_KEY, PADDLE_CLIENT_TOKEN.
 * Секрет вебхука создаётся кнопкой на /admin/billing и хранится в базе (или PADDLE_WEBHOOK_SECRET).
 */
export function paddleConfig() {
  const env = process.env.PADDLE_ENV === "production" ? "production" : "sandbox";
  return {
    env,
    apiKey: process.env.PADDLE_API_KEY ?? "",
    clientToken: process.env.PADDLE_CLIENT_TOKEN ?? "",
    api: process.env.PADDLE_API_URL || (env === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com"),
  } as const;
}
export const paddleReady = () => {
  const c = paddleConfig();
  return Boolean(c.apiKey && c.clientToken);
};

export class PaddleError extends Error {}

export async function paddleApi<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const c = paddleConfig();
  if (!c.apiKey) throw new PaddleError("Не задан PADDLE_API_KEY");
  const r = await fetch(c.api + path, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: { detail?: string; code?: string } };
  if (!r.ok) throw new PaddleError(`Paddle ${r.status}: ${j.error?.detail ?? j.error?.code ?? "ошибка"}`);
  return j.data as T;
}

// ---------- товары и цены ----------

interface PaddlePrice {
  id: string;
  product_id: string;
  status: string;
  custom_data?: { asdic?: string } | null;
  unit_price: { amount: string; currency_code: string };
}

let priceCache: { at: number; map: Map<PriceKey, string> } | null = null;

/** Соответствие «ключ тарифа → id цены в Paddle». Цены помечены custom_data.asdic. */
export async function priceIds(force = false): Promise<Map<PriceKey, string>> {
  if (!force && priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache.map;
  const list = await paddleApi<PaddlePrice[]>("/prices?status=active&per_page=200");
  const map = new Map<PriceKey, string>();
  for (const p of list) if (p.custom_data?.asdic) map.set(p.custom_data.asdic as PriceKey, p.id);
  priceCache = { at: Date.now(), map };
  return map;
}

/** Все цены, которые должны быть в Paddle, из src/lib/billing/tiers.ts */
export function wantedPrices() {
  const out: { key: PriceKey; product: string; name: string; cents: number; interval: "month" | "year" | null }[] = [];
  for (const t of TIERS) {
    if (t.key === "free") continue;
    out.push({ key: `${t.key}_month` as PriceKey, product: t.key, name: `${t.name}, в месяц`, cents: t.priceMonth * 100, interval: "month" });
    out.push({ key: `${t.key}_year` as PriceKey, product: t.key, name: `${t.name}, в год (2 месяца в подарок)`, cents: t.priceMonth * 1000, interval: "year" });
  }
  for (const p of PACKS) out.push({ key: p.key, product: "credits", name: `${p.credits} кредитов`, cents: p.price * 100, interval: null });
  return out;
}

/** Создаёт недостающие товары и цены в Paddle. Повторный запуск ничего не дублирует. */
export async function syncCatalog() {
  const products = await paddleApi<{ id: string; custom_data?: { asdic?: string } | null }[]>("/products?status=active&per_page=200");
  const productId = new Map<string, string>();
  for (const p of products) if (p.custom_data?.asdic) productId.set(p.custom_data.asdic, p.id);
  const existing = await priceIds(true);
  const created: string[] = [];
  for (const w of wantedPrices()) {
    if (existing.has(w.key)) continue;
    let pid = productId.get(w.product);
    if (!pid) {
      const tier = TIERS.find((t) => t.key === w.product);
      const p = await paddleApi<{ id: string }>("/products", {
        method: "POST",
        body: {
          name: tier ? `ASDIC ${tier.name}` : "ASDIC: пакет кредитов",
          description: tier ? tier.blurb : "Кредиты для ИИ-операций, не сгорают",
          tax_category: "standard",
          custom_data: { asdic: w.product },
        },
      });
      pid = p.id;
      productId.set(w.product, pid);
    }
    await paddleApi("/prices", {
      method: "POST",
      body: {
        product_id: pid,
        description: w.name,
        name: w.name,
        unit_price: { amount: String(w.cents), currency_code: "USD" },
        ...(w.interval ? { billing_cycle: { interval: w.interval, frequency: 1 } } : {}),
        quantity: { minimum: 1, maximum: w.interval ? 1 : 20 },
        custom_data: { asdic: w.key },
      },
    });
    created.push(w.name);
  }
  priceCache = null;
  return created;
}

// ---------- вебхук ----------

const WEBHOOK_EVENTS = ["transaction.completed", "subscription.created", "subscription.updated", "subscription.canceled", "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.activated"];

export async function getSetting(key: string) {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  return r?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

const secretKey = () => `paddle_webhook_secret_${paddleConfig().env}`;
export const webhookSecret = async () => process.env.PADDLE_WEBHOOK_SECRET || (await getSetting(secretKey()));

/** Подключает адрес вебхука в Paddle (если его ещё нет) и сохраняет секрет подписи в базе */
export async function ensureWebhook(baseUrl: string) {
  const destination = `${baseUrl.replace(/\/$/, "")}/api/paddle/webhook`;
  const list = await paddleApi<{ id: string; destination: string; active: boolean; endpoint_secret_key: string }[]>("/notification-settings");
  let s = list.find((x) => x.destination === destination);
  if (!s) {
    s = await paddleApi("/notification-settings", {
      method: "POST",
      body: { description: "ASDIC: оплата и кредиты", destination, type: "url", subscribed_events: WEBHOOK_EVENTS, api_version: 1, include_sensitive_fields: false },
    });
  } else if (!s.active) {
    s = await paddleApi(`/notification-settings/${s.id}`, { method: "PATCH", body: { active: true, subscribed_events: WEBHOOK_EVENTS } });
  }
  await setSetting(secretKey(), s!.endpoint_secret_key);
  return destination;
}

/** Проверка подписи Paddle-Signature: "ts=...;h1=..." , HMAC-SHA256 от "ts:тело" */
export function verifySignature(raw: string, header: string | null, secret: string, now = Date.now()) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=", 2) as [string, string]));
  const ts = Number(parts.ts);
  const h1 = header
    .split(";")
    .filter((p) => p.startsWith("h1="))
    .map((p) => p.slice(3));
  if (!ts || !h1.length || Math.abs(now / 1000 - ts) > 300) return false;
  const want = createHmac("sha256", secret).update(`${parts.ts}:${raw}`).digest();
  return h1.some((h) => {
    const got = Buffer.from(h, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

interface Item {
  quantity?: number;
  price?: { id: string; custom_data?: { asdic?: string } | null } | null;
  price_id?: string;
}
interface PaddleEvent {
  event_id: string;
  event_type: string;
  data: {
    id: string;
    status: string;
    customer_id?: string | null;
    subscription_id?: string | null;
    custom_data?: { userId?: string } | null;
    items?: Item[];
    billing_cycle?: { interval: string } | null;
  };
}

async function keyOf(it: Item): Promise<PriceKey | null> {
  const k = it.price?.custom_data?.asdic;
  if (k) return k as PriceKey;
  const id = it.price?.id ?? it.price_id;
  if (!id) return null;
  for (const [key, pid] of await priceIds()) if (pid === id) return key;
  return null;
}

async function findUser(d: PaddleEvent["data"]) {
  const byId = d.custom_data?.userId;
  if (byId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, byId));
    if (u) return u;
  }
  const subId = d.subscription_id ?? (d.id.startsWith("sub_") ? d.id : null);
  if (subId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.paddleSubscriptionId, subId));
    if (u) return u;
  }
  if (d.customer_id) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.paddleCustomerId, d.customer_id));
    if (u) return u;
  }
  return null;
}

/** Обработка события Paddle. Повтор того же события безопасен. */
export async function handleEvent(e: PaddleEvent): Promise<string> {
  const d = e.data;
  const user = await findUser(d);
  if (!user) return "user not found";
  const keys = await Promise.all((d.items ?? []).map(async (it) => ({ key: await keyOf(it), qty: it.quantity ?? 1 })));

  if (e.event_type === "transaction.completed") {
    let note = "";
    for (const { key, qty } of keys) {
      const pack = PACKS.find((p) => p.key === key);
      if (pack) {
        const ok = await grantExtra({ userId: user.id, credits: pack.credits * qty, reason: "pack", ref: `paddle:${d.id}:${key}`, note: `Пакет ${pack.credits} × ${qty}` });
        note += ok ? `pack ${pack.credits}x${qty}; ` : "pack dup; ";
      }
    }
    const sub = keys.find((k) => k.key && !k.key.startsWith("pack_"));
    if (sub?.key && d.subscription_id) {
      const [tierKey, interval] = sub.key.split("_") as [TierKey, "month" | "year"];
      const tier = tierOf(tierKey);
      // Оплата подписки (первая, продление, смена тарифа): кредиты тарифа выставляются на месяц вперёд
      const ins = await db
        .insert(schema.creditLedger)
        .values({ id: newId(), userId: user.id, delta: tier.credits, reason: "subscription", ref: `paddle:${d.id}`, note: `Оплата тарифа ${tier.name}` })
        .onConflictDoNothing()
        .returning({ id: schema.creditLedger.id });
      if (ins.length) {
        await db
          .update(schema.users)
          .set({
            tier: tier.key,
            billingInterval: interval,
            subscriptionStatus: "active",
            paddleSubscriptionId: d.subscription_id,
            paddleCustomerId: d.customer_id ?? user.paddleCustomerId,
            creditsPlan: tier.credits,
            creditsResetAt: sql`now() + interval '1 month'`,
          })
          .where(eq(schema.users.id, user.id));
        note += `subscription ${tier.key}`;
      } else note += "subscription dup";
    } else if (d.customer_id && !user.paddleCustomerId) {
      await db.update(schema.users).set({ paddleCustomerId: d.customer_id }).where(eq(schema.users.id, user.id));
    }
    return note || "no billable items";
  }

  if (e.event_type.startsWith("subscription.")) {
    // Событие о другой (старой) подписке не трогает текущую
    if (user.paddleSubscriptionId && user.paddleSubscriptionId !== d.id && e.event_type !== "subscription.created") return "other subscription";
    const sub = keys.find((k) => k.key && !k.key.startsWith("pack_"));
    const tierKey = sub?.key ? (sub.key.split("_")[0] as TierKey) : (user.tier as TierKey);
    if (d.status === "canceled") {
      await db
        .update(schema.users)
        .set({ tier: "free", subscriptionStatus: "canceled", creditsPlan: 0, creditsResetAt: null, paddleSubscriptionId: d.id })
        .where(eq(schema.users.id, user.id));
      return "canceled";
    }
    // Тариф и кредиты выставляет оплата (transaction.completed); здесь только статус и привязка
    await db
      .update(schema.users)
      .set({
        subscriptionStatus: d.status,
        paddleSubscriptionId: d.id,
        paddleCustomerId: d.customer_id ?? user.paddleCustomerId,
        ...(user.tier !== "free" && sub?.key ? { tier: tierKey } : {}),
      })
      .where(eq(schema.users.id, user.id));
    return `status ${d.status}`;
  }
  return "ignored";
}

/** Ссылка в личный кабинет Paddle: смена карты, тарифа, отмена, счета */
export async function portalUrl(customerId: string, subscriptionId?: string | null) {
  const r = await paddleApi<{ urls: { general: { overview: string } } }>(`/customers/${customerId}/portal-sessions`, {
    method: "POST",
    body: subscriptionId ? { subscription_ids: [subscriptionId] } : {},
  });
  return r.urls.general.overview;
}
