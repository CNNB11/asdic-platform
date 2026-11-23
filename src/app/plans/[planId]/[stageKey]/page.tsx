import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { planClosures, planItems } from "@/lib/data";
import { planProgress } from "@/lib/progress";
import { displayValue, itemTitle } from "@/method";
import { ItemBadge, ModeChip, ModeDot, OP_LABEL, fmtDate } from "@/components/ui";
import { closeStage, reopenStage } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { capabilities } from "@/lib/ai/provider";


export default async function StagePage({ params, searchParams }: PageProps<"/plans/[planId]/[stageKey]">) {
  const { planId, stageKey } = await params;
  const sp = await searchParams;
  const { method } = await requirePlan(planId);
  const items = await planItems(planId);
  const prog = planProgress(method, items, await planClosures(planId));
  const st = prog.stages.find((s) => s.stage.key === stageKey);
  if (!st) notFound();
  const { stage } = st;
  const ops = await db
    .select()
    .from(schema.aiOps)
    .where(and(eq(schema.aiOps.planId, planId), eq(schema.aiOps.status, "ready")))
    .orderBy(desc(schema.aiOps.createdAt));
  const { webSearch } = await capabilities();
  const base = `/plans/${planId}`;
  const idx = method.stages.findIndex((s) => s.key === stageKey);

  return (
    <div className="grid max-w-4xl gap-8">
      {sp.added && (
        <p className="card border-green/50 px-4 py-3 text-head">
          Добавлено записей: {String(sp.added)}. Они сделаны ИИ, поэтому проверьте их, прежде чем идти дальше.
        </p>
      )}
      <section>
        <p className="cap">
          Этап {idx + 1} из {method.stages.length} · {stage.frame}
        </p>
        <h1 className="mt-1">
          {stage.title} <span className="text-muted">· {stage.titleRu}</span>
        </h1>
        <p className="mt-2 text-[22px] leading-[31px] text-head">{stage.question}</p>
        <p className="prose-w mt-3">{stage.description}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="card p-4">
            <div className="cap">ИИ</div>
            <p className="mt-1">{stage.aiRole}</p>
          </div>
          <div className="card border-red/50 p-4">
            <div className="cap text-red">Человек</div>
            <p className="mt-1">{stage.humanRole}</p>
          </div>
        </div>
        {stage.errorCost && <p className="cap mt-3">Цена ошибки: {stage.errorCost}</p>}
        {!st.unlocked && (
          <p className="card mt-5 border-amber/50 px-4 py-3">
            Этап откроется, когда будет закрыт предыдущий. Пока его можно только посмотреть.
          </p>
        )}
      </section>

      <section className="grid gap-4">
        <div className="flex items-baseline justify-between">
          <h2>Уровни этапа</h2>
          <span className="cap">
            Закрыто {st.sections.filter((s) => s.complete).length} из {st.sections.length}
          </span>
        </div>
        {st.sections.map((s) => {
          const sec = s.section;
          const pending = ops.filter((o) => o.sectionKey === sec.key && !o.itemId);
          const red = sec.mode === "red";
          return (
            <div key={sec.key} className={`card p-5 ${red ? "border-red/40" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ModeDot mode={sec.mode} />
                  <h3>{sec.title}</h3>
                </div>
                <span className={`chip ${s.complete ? "border-head text-head" : ""}`}>
                  {s.complete ? (sec.requirements.length === 0 && s.items.length === 0 ? "Необязательно" : "Закрыт") : s.needed > 0 ? `Нужно ещё: ${s.needed}` : s.unreviewed ? `Ждут проверки: ${s.unreviewed}` : "Нужно утвердить"}
                </span>
              </div>
              <p className="prose-w mt-2">{sec.description}</p>
              <div className="mt-2">
                <ModeChip mode={sec.mode} />
              </div>
              {s.reqs.length > 0 && (
                <ul className="mt-3 grid gap-1">
                  {s.reqs.map((r) => (
                    <li key={r.label} className="cap flex items-center gap-2">
                      <span className={r.ok ? "text-green" : ""}>{r.ok ? "✓" : "○"}</span> {r.label} ({r.have}/{r.min})
                    </li>
                  ))}
                </ul>
              )}
              {s.items.length > 0 && (
                <ul className="mt-4 grid gap-1.5 border-t border-line pt-3">
                  {s.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3">
                      <Link href={`${base}/items/${it.id}`} className="link truncate">
                        {itemTitle(sec, it.values)}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {sec.fields.some((f) => f.key === "need") && it.values.need ? (
                          <span className={`chip ${it.values.need === "skip" ? "line-through" : it.values.need === "need" ? "text-head" : ""}`}>{displayValue(sec, "need", it.values.need)}</span>
                        ) : null}
                        <ItemBadge red={red} status={it.reviewStatus} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {pending.length > 0 && (
                <div className="mt-3 grid gap-1.5">
                  {pending.map((o) => (
                    <Link key={o.id} href={`${base}/ops/${o.id}`} className="chip w-fit border-amber/60 text-head">
                      {OP_LABEL[o.kind]} ждёт решения
                    </Link>
                  ))}
                </div>
              )}
              {st.unlocked && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {red ? (
                    <>
                      <Link href={`${base}/s/${sec.key}/ai`} className="btn">
                        Варианты от ИИ
                      </Link>
                      {webSearch && (
                        <Link href={`${base}/s/${sec.key}/ai?web=1`} className="btn">
                          Варианты с поиском в интернете
                        </Link>
                      )}
                      <Link href={`${base}/s/${sec.key}/new`} className="btn btn-red">
                        Записать решение самому
                      </Link>
                    </>
                  ) : (
                    <>
                      {(sec.manualVariants ?? [{ label: "Заполнить вручную", preset: {} }]).map((v) => (
                        <Link key={v.label} href={`${base}/s/${sec.key}/new?${new URLSearchParams(v.preset)}`} className="btn">
                          {v.label}
                        </Link>
                      ))}
                      <Link href={`${base}/s/${sec.key}/ai`} className="btn">
                        {sec.ai?.cta ?? "Черновик из источников"}
                      </Link>
                      {webSearch && !sec.ai?.approvedOnly && (
                        <Link href={`${base}/s/${sec.key}/ai?web=1`} className="btn">
                          {sec.ai?.cta ? `${sec.ai.cta} с поиском в интернете` : "Черновик из интернета"}
                        </Link>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
      {st.unlocked && (
        <section className={`card p-6 ${st.closure ? "" : st.complete ? "border-red/60" : ""}`}>
          {st.closure ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                Этап закрыл(а) <span className="text-head">{st.closure.closedBy}</span>, {fmtDate(st.closure.createdAt)}.
              </p>
              <form action={reopenStage.bind(null, planId, stageKey)}>
                <button className="btn btn-ghost">Открыть этап снова</button>
              </form>
            </div>
          ) : st.complete ? (
            <form action={closeStage.bind(null, planId, stageKey)} className="grid gap-3">
              <h3>Закрыть этап {stage.title}</h3>
              <p className="prose-w">Все уровни выполнены. Переход к следующему этапу делает человек: закрывая этап, вы подтверждаете, что выводы проверены и на них можно опираться.</p>
              <textarea name="note" className="field" rows={2} placeholder="Комментарий к закрытию (необязательно)" />
              <div>
                <Submit className="btn btn-red">Закрыть этап и перейти дальше</Submit>
              </div>
            </form>
          ) : (
            <p className="cap">Этап можно будет закрыть, когда все уровни будут выполнены: требования закрыты, жёлтые записи проверены, красные решения подписаны.</p>
          )}
        </section>
      )}
    </div>
  );
}
