import Link from "next/link";
import { requirePlan } from "@/lib/access";
import { planClosures, planItems, planSources } from "@/lib/data";
import { planProgress } from "@/lib/progress";
import { setDepth, updatePlan } from "@/app/actions";
import { DEPTHS, DepthChoice } from "@/components/DepthChoice";
import { Submit } from "@/components/Submit";
import { ModeDot } from "@/components/ui";

export default async function Overview({ params }: PageProps<"/plans/[planId]">) {
  const { planId } = await params;
  const { plan, method } = await requirePlan(planId);
  const [items, sources] = await Promise.all([planItems(planId), planSources(planId)]);
  const prog = planProgress(method, items, await planClosures(planId));
  const cur = prog.current;
  const save = updatePlan.bind(null, planId);
  return (
    <div className="grid max-w-4xl gap-10">
      <section>
        <p className="cap">Обзор</p>
        <h1 className="mt-1">{plan.title}</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="card p-5">
            <div className="cap">Точка A · где бизнес сейчас</div>
            <p className="mt-2 whitespace-pre-wrap text-head">{plan.pointA || "Не описана"}</p>
          </div>
          <div className="card border-red/60 p-5">
            <div className="cap">Точка B · куда хотим прийти</div>
            <p className="mt-2 whitespace-pre-wrap text-head">{plan.pointB || "Не описана"}</p>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <div className="cap">Следующий шаг</div>
        <h3 className="mt-1">
          {cur.closure ? "Все этапы закрыты" : cur.complete ? `${cur.stage.title} выполнен: закройте этап` : `Продолжить ${cur.stage.title}`}
        </h3>
        <p className="mt-1">
          {cur.closure
            ? "Можно собрать документы этапов или начать новый круг."
            : cur.complete
            ? "Требования выполнены. Переход к следующему этапу подтверждает человек."
            : `Осталось закрыть уровней: ${cur.remaining}${cur.unreviewed ? `, ждут проверки: ${cur.unreviewed}` : ""}.`}
        </p>
        <Link href={`/plans/${planId}/${cur.stage.key}`} className="btn btn-primary mt-4">
          Открыть этап
        </Link>
      </section>

      <section>
        <h2>Путь A → B</h2>
        <div className="mt-4 grid gap-3">
          {prog.stages.map((s) => (
            <Link key={s.stage.key} href={`/plans/${planId}/${s.stage.key}`} className={`card flex flex-wrap items-center gap-4 p-4 hover:border-[#444] ${s.unlocked ? "" : "opacity-60"}`}>
              <span className="cap w-6">{s.stage.num}</span>
              <div className="min-w-40 flex-1">
                <div className="text-head">
                  {s.stage.title} <span className="cap">· {s.stage.titleRu}</span>
                </div>
                <div className="cap">{s.stage.frame}</div>
              </div>
              <div className="flex gap-1.5">
                {s.sections.map((x) => (
                  <span key={x.section.key} className={x.complete ? "opacity-100" : "opacity-35"}>
                    <ModeDot mode={x.section.mode} title={`${x.section.title}: ${x.complete ? "закрыт" : "не закрыт"}`} />
                  </span>
                ))}
              </div>
              <span className="cap w-36 text-right">
                {s.closure ? `Закрыт · ${s.closure.closedBy}` : !s.unlocked ? "Откроется позже" : s.complete ? "Выполнен, ждёт закрытия" : `Осталось ${s.remaining} из ${s.sections.length}`}
              </span>
            </Link>
          ))}
        </div>
        <p className="cap mt-3">
          <ModeDot mode="red" /> решает человек · <ModeDot mode="yellow" /> ИИ делает, человек проверяет · <ModeDot mode="green" /> выборочная проверка. Яркая точка: уровень закрыт. Источников в плане: {sources.length}.
        </p>
      </section>

      <details className="card p-6">
        <summary className="cursor-pointer text-head">
          Глубина стратегии: {DEPTHS.find((d) => d.v === plan.depth)?.t ?? "Стандарт"} <span className="cap">· изменить</span>
        </summary>
        <form action={setDepth.bind(null, planId)} className="mt-5 grid gap-4">
          <DepthChoice value={plan.depth} />
          <p className="cap">Глубокие уровни появятся в этапах и в документах. При возврате на Стандарт они скрываются, но записи в них сохраняются.</p>
          <div>
            <Submit>Сохранить</Submit>
          </div>
        </form>
      </details>

      <details className="card p-6">
        <summary className="cursor-pointer text-head">Изменить описание плана</summary>
        <form action={save} className="mt-5 grid gap-4">
          <input name="title" defaultValue={plan.title} className="field" required />
          <label className="grid gap-1.5">
            <span className="cap">Компания</span>
            <textarea name="company" defaultValue={plan.company} className="field" rows={3} />
          </label>
          <label className="grid gap-1.5">
            <span className="cap">Точка A</span>
            <textarea name="pointA" defaultValue={plan.pointA} className="field" rows={3} />
          </label>
          <label className="grid gap-1.5">
            <span className="cap">Точка B</span>
            <textarea name="pointB" defaultValue={plan.pointB} className="field" rows={3} />
          </label>
          <div>
            <Submit>Сохранить</Submit>
          </div>
        </form>
      </details>
    </div>
  );
}
