import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { itemOr404, requirePlan, sectionOr404 } from "@/lib/access";
import { approveItem, deleteItem, startCritique } from "@/app/actions";
import { capabilities } from "@/lib/ai/provider";
import { locateQuote } from "@/lib/sources";
import { hasSection, itemTitle } from "@/method";
import { calcGoal } from "@/lib/goalMath";
import { parseNum } from "@/lib/num";
import { PendingNote, Submit } from "@/components/Submit";
import { Visuals } from "@/components/Visuals";
import { Cost } from "@/components/Cost";
import { ItemBadge, ModeChip, ORIGIN_LABEL, OP_LABEL, ValuesView, fmtDate } from "@/components/ui";

export default async function ItemPage({ params, searchParams }: PageProps<"/plans/[planId]/items/[itemId]">) {
  const { planId, itemId } = await params;
  const sp = await searchParams;
  const { method } = await requirePlan(planId);
  const item = await itemOr404(planId, itemId);
  const { stage, section } = sectionOr404(method, item.sectionKey);
  const { webSearch } = await capabilities();
  const base = `/plans/${planId}`;
  const red = section.mode === "red";

  const [cits, revisions, ops] = await Promise.all([
    db
      .select({ c: schema.citations, title: schema.sources.title, text: schema.sources.text })
      .from(schema.citations)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.citations.sourceId))
      .where(eq(schema.citations.itemId, item.id)),
    db.select().from(schema.itemRevisions).where(eq(schema.itemRevisions.itemId, item.id)).orderBy(desc(schema.itemRevisions.createdAt)),
    db
      .select()
      .from(schema.aiOps)
      .where(and(eq(schema.aiOps.itemId, item.id), eq(schema.aiOps.planId, planId)))
      .orderBy(desc(schema.aiOps.createdAt)),
  ]);
  const evidence = cits.map(({ c, title, text }) => ({ field: c.fieldKey, sourceTitle: title, quote: c.quote, page: locateQuote(text, c.quote).page }));
  const pending = ops.filter((o) => o.status === "ready");
  const d = item.decision;
  const gm = item.sectionKey === "goal_math" && hasSection(method, "goals") ? calcGoal(item.values) : null;
  const goalLinks = gm
    ? (() => {
        const v = item.values as Record<string, unknown>;
        const cur = String(v.currency ?? "").trim();
        const q = (o: Record<string, string>) => `${base}/s/goals/new?${new URLSearchParams(o).toString()}`;
        const deadline = String(v.period_end ?? "");
        const now = parseNum(v.revenue_now);
        const conv = parseNum(v.lead_conv) || 1;
        return [
          { label: "Цель по выручке", href: q({ goal: "Выйти на целевую выручку", metric: "Выручка за период", unit: cur || "₽", current: now ? String(now) : "0", target: String(parseNum(v.revenue_target) ?? ""), deadline }) },
          {
            label: "Цель по заявкам в месяц",
            href: q({ goal: "Получать нужный поток заявок", metric: "Заявки в месяц", unit: "заявок в месяц", current: now ? String(Math.round((now / (parseNum(v.avg_check) || 1) / gm.months / (conv / 100)) || 0)) : "0", target: String(Math.ceil(gm.leadsMonth)), deadline }),
          },
          { label: "Цель по продажам в месяц", href: q({ goal: "Выйти на нужное число продаж", metric: "Продажи в месяц", unit: "продаж в месяц", current: "0", target: String(Math.ceil(gm.salesMonth)), deadline }) },
        ];
      })()
    : null;

  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <Link href={`${base}/${stage.key}`} className="cap link">
          ← {stage.title} · {section.title}
        </Link>
        <h1 className="mt-2">{itemTitle(section, item.values)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ModeChip mode={section.mode} />
          <ItemBadge red={red} status={item.reviewStatus} />
          <span className="cap">Создано: {ORIGIN_LABEL[item.origin] ?? item.origin}</span>
        </div>
      </div>

      {sp.applied && <p className="card border-green/50 px-4 py-3">Применено изменений: {String(sp.applied)}. Запись снова требует {red ? "подписи" : "проверки"}.</p>}

      {item.reviewStatus === "unreviewed" && (
        <div className={`card grid gap-3 p-5 ${red ? "border-red/60" : "border-amber/60"}`}>
          {red ? (
            <>
              <p className="text-head">Решение не подписано и не засчитывается в этап.</p>
              <p>Проверьте поля, при необходимости поправьте и подпишите. Обоснование выбора обязательно.</p>
              <Link href={`${base}/items/${item.id}/edit`} className="btn btn-red w-fit">
                Проверить и подписать
              </Link>
            </>
          ) : (
            <>
              <p className="text-head">Запись сделана ИИ и ещё не проверена.</p>
              <p>Сверьте утверждения с цитатами. Если всё верно, утвердите; если нет, исправьте.</p>
              <form action={approveItem.bind(null, planId, item.id)} className="flex flex-wrap gap-3">
                <Submit>Утвердить</Submit>
                <Link href={`${base}/items/${item.id}/edit`} className="btn">
                  Исправить
                </Link>
              </form>
            </>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pending.map((o) => (
            <Link key={o.id} href={`${base}/ops/${o.id}`} className="chip border-amber/60 text-head">
              {OP_LABEL[o.kind]} ждёт решения
            </Link>
          ))}
        </div>
      )}

      <section className="card p-5">
        <ValuesView section={section} values={item.values} evidence={evidence} />
        {evidence.length === 0 && section.fields.some((f) => f.evidence === "recommended") && <p className="cap mt-4">У записи нет цитат из источников.</p>}
      </section>

      {goalLinks && (
        <section className="card p-5">
          <h2>Создать цель из расчёта</h2>
          <p className="prose-w mt-1">Цифры перенесутся в форму цели. Контроль будет сверять факт именно с ними.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {goalLinks.map((g) => (
              <Link key={g.label} href={g.href} className="btn">
                {g.label}
              </Link>
            ))}
          </div>
        </section>
      )}

      {section.visuals && (
        <Visuals
          planId={planId}
          item={item}
          made={sp.made ? String(sp.made) : undefined}
          failed={sp.failed ? String(sp.failed) : undefined}
          edited={sp.edited === "1"}
          error={sp.verr ? String(sp.verr) : undefined}
        />
      )}

      {red && d && (item.reviewStatus === "signed" || d.options.length > 0) && (
        <section className="card border-red/40 p-5">
          <h3>Решение</h3>
          {item.reviewStatus === "signed" && (
            <p className="mt-2">
              Подписал: <span className="text-head">{item.reviewedBy}</span>, {fmtDate(item.reviewedAt)}
              {d.confirmedBy ? `. Подтвердил: ${d.confirmedBy}` : ""}. Версия метода {d.methodVersion}.
            </p>
          )}
          {d.options.length > 0 && (
            <div className="mt-3">
              <div className="cap">Рассмотренные варианты ИИ</div>
              <ul className="mt-1 grid gap-1">
                {d.options.map((o, i) => (
                  <li key={i} className={i === d.chosenIndex ? "text-head" : ""}>
                    {i + 1}. {o.title}
                    {i === d.chosenIndex ? " (выбран)" : ""}
                  </li>
                ))}
                {d.chosenIndex == null && <li className="text-head">Записан собственный вариант</li>}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3">
        <h3>Действия</h3>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/items/${item.id}/edit`} className={red ? "btn btn-red" : "btn"}>
            {red ? "Изменить и подписать заново" : "Редактировать"}
          </Link>
          <Link href={`${base}/items/${item.id}/ai?kind=improve_sources`} className="btn">
            Улучшить по источникам
          </Link>
          {webSearch && (
            <Link href={`${base}/items/${item.id}/ai?kind=improve_web`} className="btn">
              Улучшить с поиском
            </Link>
          )}
          <form action={startCritique.bind(null, planId, item.id)}>
            <Submit className="btn" pending="ИИ проверяет…">
              Критика ИИ
            </Submit>
            <PendingNote text="Обычно до минуты." />
          </form>
          <div className="basis-full">
            <Cost kind="critique" note="Критика стоит" />
          </div>
        </div>
      </section>

      <section>
        <h3>История</h3>
        <ul className="mt-3 grid gap-1.5">
          {revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3 text-sm">
              <span className="cap w-36">{fmtDate(r.createdAt)}</span>
              <span className="text-head">{r.note}</span>
              <span className="cap">{r.actor === "ai" ? `ИИ, сохранил ${r.savedBy}` : r.savedBy}</span>
            </li>
          ))}
          {ops
            .filter((o) => o.status !== "ready")
            .map((o) => (
              <li key={o.id} className="flex flex-wrap gap-x-3 text-sm">
                <span className="cap w-36">{fmtDate(o.createdAt)}</span>
                <Link href={`${base}/ops/${o.id}`} className="link">
                  {OP_LABEL[o.kind]}
                </Link>
                <span className="cap">{o.outcome ?? o.error ?? o.status}</span>
              </li>
            ))}
        </ul>
      </section>

      <form action={deleteItem.bind(null, planId, item.id)} className="border-t border-line pt-5">
        <Submit className="btn btn-ghost" pending="Удаляю…">
          Удалить запись
        </Submit>
      </form>
    </div>
  );
}
