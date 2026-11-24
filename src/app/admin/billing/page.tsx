import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { paddleConfig, paddleReady, priceIds, webhookSecret, wantedPrices } from "@/lib/billing/paddle";
import { TIERS, tierOf } from "@/lib/billing/tiers";
import { TopBar } from "@/components/TopBar";
import { fmtDate } from "@/components/ui";
import { adminGrant, adminSetTier, adminSetupPaddle } from "@/app/billing/actions";

const one = (s: string | string[] | undefined) => (Array.isArray(s) ? s[0] : s);

/** Админка оплаты: подключение Paddle одной кнопкой, клиенты, ручные кредиты и тарифы */
export default async function AdminBillingPage({ searchParams }: PageProps<"/admin/billing">) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const cfg = paddleConfig();
  const ready = paddleReady();
  let have = 0;
  let priceErr = "";
  if (ready) {
    try {
      have = (await priceIds(true)).size;
    } catch (e) {
      priceErr = (e as Error).message;
    }
  }
  const hook = Boolean(await webhookSecret());
  const users = await db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(200);
  const [rev] = await db
    .select({
      spent: sql<number>`coalesce(sum(case when ${schema.creditLedger.reason} = 'ai' then -${schema.creditLedger.delta} else 0 end),0)::int`,
      cost: sql<number>`coalesce(sum(${schema.creditLedger.costUsd}::numeric),0)::float`,
    })
    .from(schema.creditLedger)
    .where(sql`${schema.creditLedger.createdAt} > now() - interval '30 days'`);
  const paying = users.filter((u) => u.tier !== "free" && ["active", "trialing", "past_due"].includes(u.subscriptionStatus ?? ""));
  const mrr = paying.reduce((n, u) => n + tierOf(u.tier).priceMonth, 0);

  return (
    <>
      <TopBar userName={admin.name}>
        <span className="text-head">Оплата</span>
      </TopBar>
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:px-6">
        {sp.ok && <p className="card p-4 text-head">{one(sp.ok)}</p>}
        {sp.err && <p className="card border-red p-4 text-red">{one(sp.err)}</p>}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <div className="cap">Платящих клиентов</div>
            <div className="text-2xl text-head">{paying.length}</div>
          </div>
          <div className="card p-4">
            <div className="cap">Выручка в месяц (по тарифам)</div>
            <div className="text-2xl text-head">${mrr}</div>
          </div>
          <div className="card p-4">
            <div className="cap">За 30 дней: списано кредитов / себестоимость ИИ</div>
            <div className="text-2xl text-head">
              {rev.spent} / ${rev.cost.toFixed(2)}
            </div>
          </div>
        </section>

        <section className="card grid gap-3 p-5">
          <h3>Paddle ({cfg.env === "production" ? "боевой режим" : "тестовый режим"})</h3>
          <ul className="grid gap-1 text-sm">
            <li>{ready ? "✓" : "✗"} Ключи PADDLE_API_KEY и PADDLE_CLIENT_TOKEN</li>
            <li>
              {have >= wantedPrices().length ? "✓" : "✗"} Тарифы и пакеты в Paddle: {have} из {wantedPrices().length}
              {priceErr ? ` (${priceErr})` : ""}
            </li>
            <li>{hook ? "✓" : "✗"} Вебхук (Paddle сообщает об оплатах)</li>
          </ul>
          {ready ? (
            <form action={adminSetupPaddle}>
              <button className="btn btn-primary">Создать тарифы в Paddle и подключить вебхук</button>
              <p className="cap mt-2">Безопасно нажимать повторно: существующее не дублируется. После смены цен в коде нажмите снова, добавятся новые цены.</p>
            </form>
          ) : (
            <p className="cap">Сначала добавьте ключи Paddle в настройки Render (Environment).</p>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <form action={adminGrant} className="card grid gap-3 p-5">
            <h3>Начислить кредиты</h3>
            <input name="email" type="email" required placeholder="почта клиента" className="field" />
            <input name="credits" type="number" required placeholder="сколько (минус = списать)" className="field" />
            <input name="note" placeholder="за что, необязательно" className="field" />
            <div>
              <button className="btn">Начислить</button>
            </div>
          </form>
          <form action={adminSetTier} className="card grid gap-3 p-5">
            <h3>Выдать тариф вручную</h3>
            <input name="email" type="email" required placeholder="почта клиента" className="field" />
            <select name="tier" className="field">
              {TIERS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="cap">Без оплаты, например партнёру. Кредиты тарифа будут пополняться каждый месяц, пока не вернёте Free.</p>
            <div>
              <button className="btn">Сохранить</button>
            </div>
          </form>
        </section>

        <section>
          <h3>Клиенты</h3>
          <table className="mt-3 w-full text-sm">
            <thead className="cap text-left">
              <tr>
                <th className="py-1.5">Почта</th>
                <th>Тариф</th>
                <th>Подписка</th>
                <th className="text-right">Кредиты</th>
                <th className="text-right">С нами с</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line">
                  <td className="py-1.5 pr-3">{u.email}</td>
                  <td className="pr-3">
                    {tierOf(u.tier).name}
                    {u.billingInterval === "year" ? ", год" : ""}
                  </td>
                  <td className="pr-3">{u.subscriptionStatus ?? "—"}</td>
                  <td className="pr-3 text-right">{u.creditsPlan + u.creditsExtra}</td>
                  <td className="cap text-right">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
