import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { wallet } from "@/lib/billing/credits";
import { paddleConfig, paddleReady, priceIds } from "@/lib/billing/paddle";
import { CREDIT_USD, PACKS, TIERS, estimate, fmtCredits, type PriceKey } from "@/lib/billing/tiers";
import { CheckoutButton } from "@/components/Checkout";
import { TopBar } from "@/components/TopBar";
import { fmtDate } from "@/components/ui";
import { changePlan, openPortal } from "./actions";

const REASON: Record<string, string> = { ai: "ИИ", subscription: "Оплата тарифа", pack: "Пакет кредитов", admin: "Вручную", refill: "Кредиты на месяц", signup: "Старт" };
const KIND: Record<string, string> = {
  draft_web: "Черновик уровня с поиском в интернете",
  draft_sources: "Черновик уровня по источникам",
  options_web: "Варианты решения с поиском",
  improve_web: "Улучшить запись с поиском",
  improve_sources: "Улучшить запись по источникам",
  critique: "Критика записи",
  image: "Бренд-борд или макет (один вариант)",
  image_trends: "Тренды визуала (раз в месяц на план)",
  image_edit: "Точечная правка макета",
  source_summary: "Описание загруженного файла",
};

const one = (s: string | string[] | undefined) => (Array.isArray(s) ? s[0] : s);

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const user = await requireUser();
  const sp = await searchParams;
  const yearly = sp.y === "1";
  const w = await wallet(user.id);
  const cfg = paddleConfig();
  let prices = new Map<PriceKey, string>();
  let payErr = "";
  if (paddleReady()) {
    try {
      prices = await priceIds();
    } catch (e) {
      payErr = (e as Error).message;
    }
  }
  const canPay = paddleReady() && prices.size > 0;
  const hasSub = Boolean(user.paddleSubscriptionId && ["active", "trialing", "past_due"].includes(user.subscriptionStatus ?? ""));
  const history = await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.userId, user.id)).orderBy(desc(schema.creditLedger.createdAt)).limit(30);

  return (
    <>
      <TopBar userName={user.name}>
        <span className="text-head">Тариф и кредиты</span>
      </TopBar>
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:px-6">
        {sp.need && (
          <p className="card border-red p-4 text-head">
            Для этой операции нужно около {fmtCredits(Number(one(sp.need)) || 0)}, а у вас {fmtCredits(Math.max(0, w.total))}. Докупите пакет или перейдите на тариф побольше.
          </p>
        )}
        {sp.limit === "plans" && (
          <p className="card border-red p-4 text-head">
            На тарифе {w.tier.name} можно вести планов: {w.tier.maxPlans}. Чтобы создать ещё, перейдите на тариф выше.
          </p>
        )}
        {sp.paid && (
          <p className="card p-4 text-head">
            Спасибо за оплату! Кредиты появятся в течение минуты.{" "}
            <Link href="/billing" className="link">
              Обновить
            </Link>
          </p>
        )}
        {sp.changed && <p className="card p-4 text-head">Тариф меняется. Новые кредиты появятся после списания разницы, обычно в течение минуты.</p>}
        {sp.err && <p className="card border-red p-4 text-red">{one(sp.err)}</p>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="card p-5">
            <div className="cap">Тариф</div>
            <div className="mt-1 text-2xl text-head">{w.tier.name}</div>
            {user.subscriptionStatus === "past_due" && <p className="cap mt-1 text-red">Платёж не прошёл. Обновите карту в кабинете оплаты.</p>}
            {hasSub && (
              <form action={openPortal} className="mt-3">
                <button className="btn">Карта, счета, отмена</button>
              </form>
            )}
          </div>
          <div className="card p-5">
            <div className="cap">Кредиты</div>
            <div className="mt-1 text-2xl text-head">{w.unlimited ? "∞ (админ)" : Math.max(0, w.total).toLocaleString("ru-RU")}</div>
            <p className="cap mt-1">
              {w.plan > 0 && `Тарифные: ${w.plan}${w.resetAt ? `, обновятся ${fmtDate(w.resetAt)}` : ""}. `}
              Купленные: {Math.max(0, w.extra)}, не сгорают.
            </p>
          </div>
          <div className="card p-5">
            <div className="cap">Как считается</div>
            <p className="mt-1 text-sm">
              1 кредит = ${CREDIT_USD.toFixed(2)}. Каждая ИИ-операция списывает кредиты по своей реальной стоимости. Цену вы видите перед запуском. Когда кредиты кончаются, ИИ останавливается, а всё сделанное остаётся.
            </p>
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2>Тарифы</h2>
            <div className="flex gap-2">
              <Link href="/billing" className={`chip ${!yearly ? "border-head text-head" : ""}`}>
                Помесячно
              </Link>
              <Link href="/billing?y=1" className={`chip ${yearly ? "border-head text-head" : ""}`}>
                За год: 2 месяца в подарок
              </Link>
            </div>
          </div>
          {!canPay && <p className="cap mt-2">Оплата скоро заработает.{payErr ? ` (${payErr})` : ""}</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t) => {
              const key = `${t.key}_${yearly ? "year" : "month"}` as PriceKey;
              const priceId = prices.get(key);
              const current = w.tier.key === t.key;
              return (
                <div key={t.key} className={`card grid content-start gap-3 p-5 ${current ? "border-head" : ""}`}>
                  <div>
                    <div className="text-head">{t.name}</div>
                    <div className="cap">{t.blurb}</div>
                  </div>
                  <div className="text-2xl text-head">
                    {t.priceMonth === 0 ? "$0" : `$${yearly ? t.priceMonth * 10 : t.priceMonth}`}
                    <span className="cap"> {t.priceMonth === 0 ? "" : yearly ? "/ год" : "/ мес"}</span>
                  </div>
                  <ul className="grid gap-1 text-sm">
                    {t.features.map((f) => (
                      <li key={f}>· {f}</li>
                    ))}
                  </ul>
                  <div className="mt-auto">
                    {current ? (
                      <span className="chip border-head text-head">Ваш тариф</span>
                    ) : t.key === "free" ? null : hasSub && priceId ? (
                      <form action={changePlan.bind(null, key)}>
                        <button className="btn btn-primary">Перейти на тариф {t.name}</button>
                      </form>
                    ) : canPay && priceId ? (
                      <CheckoutButton priceId={priceId} token={cfg.clientToken} env={cfg.env} email={user.email} userId={user.id}>
                        Оформить тариф {t.name}
                      </CheckoutButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2>Докупить кредиты</h2>
          <p className="cap mt-2">Купленные кредиты не сгорают и тратятся после тарифных.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PACKS.map((p) => {
              const priceId = prices.get(p.key);
              return (
                <div key={p.key} className="card grid gap-3 p-5">
                  <div className="text-head">{fmtCredits(p.credits)}</div>
                  <div className="text-2xl text-head">${p.price}</div>
                  {canPay && priceId && (
                    <CheckoutButton priceId={priceId} token={cfg.clientToken} env={cfg.env} email={user.email} userId={user.id} className="btn">
                      Купить
                    </CheckoutButton>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3>Сколько стоят операции</h3>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {Object.entries(KIND).map(([k, label]) => (
                  <tr key={k} className="border-b border-line">
                    <td className="py-1.5 pr-3">{label}</td>
                    <td className="py-1.5 text-right text-head">≈ {estimate(k)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cap mt-2">Это средние цены. Точная сумма зависит от объёма материалов и считается по факту.</p>
          </div>
          <div>
            <h3>История</h3>
            {history.length === 0 ? (
              <p className="cap mt-3">Пока пусто.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-line">
                      <td className="cap whitespace-nowrap py-1.5 pr-3">{fmtDate(h.createdAt)}</td>
                      <td className="py-1.5 pr-3">{h.reason === "ai" ? (KIND[h.note] ?? `ИИ: ${h.note}`) : h.note || REASON[h.reason] || h.reason}</td>
                      <td className={`py-1.5 text-right ${h.delta > 0 ? "text-green" : "text-head"}`}>
                        {h.delta > 0 ? "+" : ""}
                        {h.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
