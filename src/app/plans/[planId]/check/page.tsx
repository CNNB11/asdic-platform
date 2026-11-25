import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { fixConflict, keepConflict, markConflictFixed, startConsistency } from "@/app/actions";
import type { Conflict, ConsistencyResult } from "@/lib/ai/ops";
import { Submit, PendingNote } from "@/components/Submit";
import { fmtDate } from "@/components/ui";
import { findSection, hasSection, itemTitle, type Method } from "@/method";
import { estimate, fmtCredits } from "@/lib/billing/tiers";

const SEV = { high: "Серьёзно", medium: "Заметно", low: "Мелочь" };
const SEV_CLS = { high: "text-red border-red/60", medium: "text-amber border-amber/60", low: "text-muted border-line" };

/** Противоречия в плане: каждое открывается окном, где видно обе записи и можно исправить */
export default async function CheckPage({ params, searchParams }: PageProps<"/plans/[planId]/check">) {
  const { planId } = await params;
  const sp = await searchParams;
  const { plan, method } = await requirePlan(planId);
  const ops = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.planId, planId), eq(schema.aiOps.kind, "consistency"))).orderBy(desc(schema.aiOps.createdAt)).limit(5);
  const op = ops.find((o) => o.id === sp.op) ?? ops[0];
  const items = await db.select().from(schema.items).where(eq(schema.items.planId, planId));
  const r = op?.status === "ready" ? (op.result as ConsistencyResult) : null;
  const open = r?.conflicts.filter((c) => c.status === "open") ?? [];
  const done = r?.conflicts.filter((c) => c.status !== "open") ?? [];
  const ref = (x: Conflict["a"]) => describe(method, plan, items, x);
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1>Противоречия в плане</h1>
        <p className="prose-w mt-2">
          ИИ сверяет записи всех этапов между собой: цифры расчёта и целей, сроки и горизонт, бюджет, сегменты. Нажмите на противоречие, чтобы увидеть обе записи и исправить его автоматически, вручную или оставить с пояснением.
        </p>
      </div>
      <form action={startConsistency.bind(null, planId)} className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <span>
          <span className="text-head">{op ? "Проверить ещё раз" : "Проверить план"}</span>
          <span className="cap block">
            {fmtCredits(estimate("critique"))}
            {op ? ` · последняя проверка ${fmtDate(op.createdAt)}` : ""}
          </span>
        </span>
        <span>
          <Submit pending="Проверяю…">Найти противоречия</Submit>
          <PendingNote text="ИИ читает весь план, это около минуты" />
        </span>
      </form>
      {op?.status === "failed" && <p className="card border-red/50 px-4 py-3">{op.error}</p>}
      {r && (
        <>
          <p className="text-head">{r.summary}</p>
          {open.length === 0 && <p className="card px-4 py-3">Открытых противоречий нет.</p>}
          <ul className="grid gap-3">
            {open.map((c) => {
              const a = ref(c.a);
              const b = ref(c.b);
              const fx = c.fix ? ref({ ...c.fix, value: "" }) : null;
              const pid = `c_${c.id}`;
              return (
                <li key={c.id}>
                  <button type="button" popoverTarget={pid} className={`card grid w-full gap-1.5 border p-4 text-left hover:bg-panel-2 ${SEV_CLS[c.severity]}`}>
                    <span className="flex items-start gap-3">
                      <span className="chip shrink-0">{SEV[c.severity]}</span>
                      <span className="text-head">{c.title}</span>
                    </span>
                    <span className="cap">
                      {a.where} ↔ {b.where} · нажмите, чтобы исправить →
                    </span>
                  </button>
                  <div id={pid} popover="auto" className="m-auto max-h-[90vh] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-panel p-6 text-text shadow-2xl backdrop:bg-black/60">
                    <div className="flex items-start justify-between gap-4">
                      <h3>{c.title}</h3>
                      <button type="button" popoverTarget={pid} popoverTargetAction="hide" className="cap hover:text-head">
                        Закрыть
                      </button>
                    </div>
                    <p className="mt-2">{c.why}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Side x={a} />
                      <Side x={b} />
                    </div>
                    <div className="mt-5 grid gap-4">
                      {c.fix && fx && (
                        <form action={fixConflict.bind(null, planId, op!.id, c.id)} className="grid gap-2 rounded-lg border border-green/40 p-4">
                          <span className="text-head">Исправить автоматически</span>
                          <span className="cap">
                            {fx.where}: {fx.label}. {c.fix.rationale}
                          </span>
                          <textarea name="value" defaultValue={c.fix.proposed} className="field" rows={2} />
                          <span className="cap">Можно поправить значение перед сохранением. Зависимые расчёты пересчитаются.{fx.red ? " Это подписанное решение: сохраняя, вы подписываете его заново." : ""}</span>
                          <div>
                            <Submit className="btn btn-primary">Исправить</Submit>
                          </div>
                        </form>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        {[a, b]
                          .filter((x) => x.editHref)
                          .map((x) => (
                            <Link key={x.editHref} href={x.editHref!} className="btn">
                              Исправить вручную: {x.where}
                            </Link>
                          ))}
                        <form action={markConflictFixed.bind(null, planId, op!.id, c.id)}>
                          <Submit className="btn btn-ghost" pending="…">
                            Уже исправил
                          </Submit>
                        </form>
                      </div>
                      <form action={keepConflict.bind(null, planId, op!.id, c.id)} className="grid gap-2">
                        <span className="cap">Оставить как есть, если это не ошибка. Причина сохранится в плане.</span>
                        <div className="flex flex-wrap gap-2">
                          <input name="reason" className="field min-w-56 flex-1" placeholder="Почему так и задумано" />
                          <Submit className="btn btn-ghost" pending="…">
                            Оставить
                          </Submit>
                        </div>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {done.length > 0 && (
            <details>
              <summary className="cap cursor-pointer">Решено: {done.length}</summary>
              <ul className="mt-2 grid gap-1 text-sm">
                {done.map((c) => (
                  <li key={c.id}>
                    <span className="text-head">{c.title}</span> <span className="cap">· {c.status === "fixed" ? "исправлено" : "оставлено"} · {c.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Side({ x }: { x: ReturnType<typeof describe> }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="cap">
        {x.where} · {x.label}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-head">{x.value || "—"}</div>
      {x.href && (
        <Link href={x.href} className="link cap">
          Открыть запись
        </Link>
      )}
    </div>
  );
}

function describe(method: Method, plan: { id: string; pointA: string; pointB: string }, items: (typeof schema.items.$inferSelect)[], x: { itemId: string; field: string; value: string }) {
  if (x.itemId === "plan") return { where: x.field === "pointA" ? "Точка A" : "Точка B", label: "описание плана", value: x.field === "pointA" ? plan.pointA : plan.pointB, href: `/plans/${plan.id}`, editHref: `/plans/${plan.id}`, red: false };
  const it = items.find((i) => i.id === x.itemId);
  if (!it || !hasSection(method, it.sectionKey)) return { where: it ? "Запись глубокой стратегии" : "Запись удалена", label: x.field, value: x.value, href: undefined, editHref: undefined, red: false };
  const { section } = findSection(method, it.sectionKey);
  const f = section.fields.find((ff) => ff.key === x.field);
  return {
    where: `${section.title}: ${itemTitle(section, it.values).slice(0, 50)}`,
    label: f?.label ?? x.field,
    value: String(it.values[x.field] ?? ""),
    href: `/plans/${it.planId}/items/${it.id}`,
    editHref: `/plans/${it.planId}/items/${it.id}/edit#f_${x.field}`,
    red: section.mode === "red",
  };
}
