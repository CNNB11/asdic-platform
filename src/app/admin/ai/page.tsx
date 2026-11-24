import { desc, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { TopBar } from "@/components/TopBar";
import { fmtDate } from "@/components/ui";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const STATUS: Record<string, string> = { applied: "принято", discarded: "отклонено", ready: "ждёт", failed: "ошибка", running: "идёт" };

export default async function AiLogPage({ searchParams }: PageProps<"/admin/ai">) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.days ?? 7) || 7));
  const since = new Date(Date.now() - days * 864e5);

  const byKind = await db
    .select({
      kind: schema.aiCalls.kind,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(${schema.aiCalls.error})::int`,
      input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)::int`,
      output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)::int`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiCalls.cacheReadTokens}),0)::int`,
      searches: sql<number>`coalesce(sum(${schema.aiCalls.webSearches}),0)::int`,
      cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}::numeric),0)::float`,
      avgMs: sql<number>`coalesce(avg(${schema.aiCalls.durationMs}),0)::int`,
    })
    .from(schema.aiCalls)
    .where(gte(schema.aiCalls.createdAt, since))
    .groupBy(schema.aiCalls.kind);

  const outcomes = await db
    .select({ kind: schema.aiOps.kind, status: schema.aiOps.status, n: sql<number>`count(*)::int` })
    .from(schema.aiOps)
    .where(gte(schema.aiOps.createdAt, since))
    .groupBy(schema.aiOps.kind, schema.aiOps.status);

  const calls = await db.select().from(schema.aiCalls).where(gte(schema.aiCalls.createdAt, since)).orderBy(desc(schema.aiCalls.createdAt)).limit(200);
  const total = byKind.reduce((a, k) => ({ calls: a.calls + k.calls, cost: a.cost + k.cost, errors: a.errors + k.errors }), { calls: 0, cost: 0, errors: 0 });

  return (
    <>
      <TopBar userName={user.name}>
        <span className="text-head">Журнал ИИ</span> <a href="/admin/billing" className="cap link ml-3">Оплата</a>
      </TopBar>
      <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1>Журнал вызовов ИИ</h1>
          <div className="flex gap-2">
            {[1, 7, 30, 90].map((d) => (
              <a key={d} href={`?days=${d}`} className={`chip ${d === days ? "border-head text-head" : ""}`}>
                {d} дн.
              </a>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Вызовов" value={String(total.calls)} />
          <Stat label="Стоимость" value={usd(total.cost)} />
          <Stat label="Ошибок" value={`${total.errors}${total.calls ? ` (${Math.round((total.errors / total.calls) * 100)}%)` : ""}`} />
        </div>

        <section>
          <h3>По операциям</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="cap text-left">
                <tr>
                  {["Операция", "Вызовов", "Ошибок", "Вход", "Выход", "Из кэша", "Поисков", "Стоимость", "Среднее время", "Итог для человека"].map((h) => (
                    <th key={h} className="border-b border-line py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byKind.map((k) => (
                  <tr key={k.kind} className="border-b border-line">
                    <td className="py-2 pr-3 text-head">{k.kind}</td>
                    <td className="pr-3">{k.calls}</td>
                    <td className="pr-3">{k.errors}</td>
                    <td className="pr-3">{k.input.toLocaleString("ru-RU")}</td>
                    <td className="pr-3">{k.output.toLocaleString("ru-RU")}</td>
                    <td className="pr-3">{k.cacheRead.toLocaleString("ru-RU")}</td>
                    <td className="pr-3">{k.searches}</td>
                    <td className="pr-3">{usd(k.cost)}</td>
                    <td className="pr-3">{(k.avgMs / 1000).toFixed(1)} с</td>
                    <td className="pr-3">
                      {outcomes
                        .filter((o) => o.kind === k.kind)
                        .map((o) => `${STATUS[o.status] ?? o.status}: ${o.n}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>Последние вызовы</h3>
          <div className="mt-3 grid gap-2">
            {calls.map((c) => (
              <details key={c.id} className="card p-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="cap w-36">{fmtDate(c.createdAt)}</span>
                  <span className="text-head">{c.kind}</span>
                  <span className="cap">{c.step}</span>
                  <span>{c.model}</span>
                  <span>
                    {c.inputTokens}/{c.outputTokens} ток.
                  </span>
                  <span>{usd(Number(c.costUsd))}</span>
                  <span>{(c.durationMs / 1000).toFixed(1)} с</span>
                  {c.error ? <span className="text-red">ошибка</span> : <span className="cap">{c.stopReason}</span>}
                  <span className="cap">промпт {c.promptVersion}</span>
                </summary>
                {c.error && <p className="mt-2 text-sm text-red">{c.error}</p>}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <pre className="max-h-80 overflow-auto rounded-lg bg-panel-2 p-3 text-xs whitespace-pre-wrap">{c.requestPreview}</pre>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-panel-2 p-3 text-xs whitespace-pre-wrap">{c.responsePreview}</pre>
                </div>
                <p className="cap mt-2">
                  План {c.planId ?? "—"} · операция {c.opId ?? "—"}
                </p>
              </details>
            ))}
            {calls.length === 0 && <p>За период вызовов нет.</p>}
          </div>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="cap">{label}</div>
      <div className="mt-1 text-[27px] leading-[34px] text-head">{value}</div>
    </div>
  );
}
