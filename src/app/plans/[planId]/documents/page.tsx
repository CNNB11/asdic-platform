import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { planClosures, planItems } from "@/lib/data";
import { planProgress } from "@/lib/progress";
import type { DocModel } from "@/lib/export/model";
import { deleteDocuments, generateDocument, saveBrand } from "@/app/actions";
import { BrandForm } from "@/components/BrandForm";
import { isPaidUser } from "@/lib/billing/credits";
import { DEFAULT_NDA } from "@/lib/export/html";
import { Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";
import { itemTitle } from "@/method";
import { THEMES } from "@/lib/export/themes";

const FORMATS = [
  { f: "pdf", t: "PDF" },
  { f: "docx", t: "Word" },
  { f: "md", t: "Markdown" },
  { f: "web", t: "Веб-версия (HTML)" },
  { f: "html", t: "Открыть в браузере" },
];

/** Документ этапа собирается из записей плана без ИИ: что в плане, то и в документе */
export default async function DocumentsPage({ params, searchParams }: PageProps<"/plans/[planId]/documents">) {
  const { planId } = await params;
  const sp = await searchParams;
  const { user, plan, method } = await requirePlan(planId);
  const paid = isPaidUser(user);
  const prog = planProgress(method, await planItems(planId), await planClosures(planId));
  const visuals = await db
    .select({ v: schema.visuals, item: schema.items })
    .from(schema.visuals)
    .innerJoin(schema.items, eq(schema.items.id, schema.visuals.itemId))
    .where(and(eq(schema.visuals.planId, planId), ne(schema.visuals.verdict, "rejected")))
    .orderBy(desc(schema.visuals.createdAt));
  const visSection = method.stages.flatMap((s) => s.sections).find((s) => s.key === "visuals");
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.planId, planId)).orderBy(desc(schema.documents.version));
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1>Документы</h1>
        <p className="prose-w mt-2">
          Документы собираются из записей плана: подписанные решения, проверенные записи, цитаты и список источников. Непроверенное попадает в документ с пометкой. Каждая сборка сохраняется отдельной версией.
        </p>
      </div>
      <DocBlock
        planId={planId}
        stageKey="full"
        title="Полная стратегия"
        sub="Отчёт для руководства, инвестора или партнёра: обложка с вашим логотипом, содержание, стратегия на одной странице, цели в цифрах и графиках, дорожная карта, SWOT, все этапы и источники."
        list={docs.filter((d) => d.stageKey === "full")}
        ready={sp.ready}
        unlocked
        status={paid ? "Без водяного знака" : "Бесплатная версия: с водяным знаком"}
        primary
      />
      <details className="card p-5" open={!plan.brand}>
        <summary className="cursor-pointer text-head">Оформление документа</summary>
        <p className="cap mt-2">Тема, логотип, данные на обложке и цвет применяются ко всем документам при следующей сборке.</p>
        <BrandForm action={saveBrand.bind(null, planId)} brand={plan.brand ?? {}} paid={paid} hasBoard={visuals.some(({ v }) => (v.verdict === "accepted" || v.verdict === "base") && !!(v.meta?.palettes?.length || v.meta?.fonts?.length))} logoUrl={plan.brand?.logoKey ? `/api/plans/${planId}/logo?v=${plan.brand.logoKey}` : null} ndaDefault={DEFAULT_NDA} />
      </details>
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3>Фирменный стиль и визуалы</h3>
          <span className="cap">{visuals.length ? `Файлов: ${visuals.length}` : "Пока нет"}</span>
        </div>
        <p className="cap mt-2">
          Бренд-борды и макеты из уровня «Визуальные концепции». Борд скачивается в PNG (картинка для презентаций) и HTML (живой файл с анимацией и цветами в коде, его можно передать дизайнеру). Отклонённые варианты сюда не попадают.
        </p>
        {visuals.length === 0 ? (
          <p className="mt-3">Откройте уровень «Визуальные концепции», создайте концепцию и нажмите «Сверстать бренд-борд».</p>
        ) : (
          <ul className="mt-4 grid gap-2 border-t border-line pt-3">
            {visuals.map(({ v, item }) => {
              const code = v.mime === "text/html" || v.mime === "image/svg+xml";
              const url = `/api/plans/${planId}/visuals/${v.id}`;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link href={`/plans/${planId}/items/${item.id}#visuals`} className="link min-w-48 flex-1">
                    {visSection ? itemTitle(visSection, item.values) : "Концепция"}
                    <span className="cap">
                      {" · "}
                      {v.mime === "text/html" ? "бренд-борд" : "макет"}
                      {v.verdict === "accepted" ? " · принят" : v.verdict === "base" ? " · основа" : ""}
                      {v.parentId ? " · после правки" : ""}
                    </span>
                  </Link>
                  <span className="cap w-36">{fmtDate(v.createdAt)}</span>
                  <span className="flex flex-wrap gap-3">
                    {code && (
                      <a href={`${url}?format=png`} className="link">
                        PNG
                      </a>
                    )}
                    <a href={`${url}?download=1`} className="link">
                      {v.mime === "text/html" ? "HTML" : v.mime === "image/svg+xml" ? "SVG" : "Скачать"}
                    </a>
                    <a href={url} className="link" target="_blank" rel="noreferrer">
                      Открыть
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <h2 className="mt-4">Документы этапов</h2>
      {prog.stages.map((st) => (
        <DocBlock
          key={st.stage.key}
          planId={planId}
          stageKey={st.stage.key}
          title={`${st.stage.title} · ${st.stage.titleRu}`}
          list={docs.filter((d) => d.stageKey === st.stage.key)}
          ready={sp.ready}
          unlocked={st.unlocked}
          status={st.closure ? `Закрыт: ${st.closure.closedBy}` : st.complete ? "Готов к закрытию" : `Не закрыто уровней: ${st.remaining}`}
        />
      ))}
    </div>
  );
}

function DocBlock({
  planId,
  stageKey,
  title,
  sub,
  list,
  ready,
  unlocked,
  status,
  primary,
}: {
  planId: string;
  stageKey: string;
  title: string;
  sub?: string;
  list: (typeof schema.documents.$inferSelect)[];
  ready?: string | string[];
  unlocked: boolean;
  status: string;
  primary?: boolean;
}) {
  const fresh = list.find((d) => d.id === ready);
  return (
    <section className={`card p-5 ${unlocked ? "" : "opacity-60"} ${primary ? "border-head/40" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3>{title}</h3>
        <span className="cap">{status}</span>
      </div>
      {sub && <p className="cap mt-2">{sub}</p>}
      {unlocked ? (
        <form action={generateDocument.bind(null, planId, stageKey)} className="mt-4">
          <Submit className={primary ? "btn btn-primary" : "btn"} pending="Собираю…">
            {list.length ? "Собрать новую версию" : "Собрать документ"}
          </Submit>
        </form>
      ) : (
        <p className="cap mt-3">Этап ещё не открыт.</p>
      )}
      {fresh && (fresh.model as DocModel).outstanding.length > 0 && (
        <details className="mt-4 rounded-lg border border-amber/50 p-3 text-sm">
          <summary className="cursor-pointer text-head">В документе есть незакрытое: {(fresh.model as DocModel).outstanding.length}</summary>
          <ul className="mt-1 grid gap-0.5">
            {(fresh.model as DocModel).outstanding.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </details>
      )}
      {list.length > 0 && (
        <ul className="mt-4 grid gap-2 border-t border-line pt-3">
          {list.map((d) => (
            <li key={d.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${d.id === ready ? "text-head" : ""}`}>
              <span className="w-14">v{d.version}</span>
              <span className="cap w-36">{fmtDate(d.createdAt)}</span>
              <span className="flex flex-wrap gap-3">
                {FORMATS.map(({ f, t }) => (
                  <a key={f} href={`/api/plans/${planId}/documents/${d.id}/${f}`} className="link" target={f === "html" ? "_blank" : undefined} rel="noreferrer">
                    {t}
                  </a>
                ))}
              </span>
              <form action={deleteDocuments.bind(null, planId, [d.id])} className="ml-auto">
                <Submit className="cap hover:text-head" pending="…">
                  Удалить
                </Submit>
              </form>
            </li>
          ))}
          {stageKey === "full" && (
            <li className="cap flex flex-wrap gap-x-3 gap-y-1 pt-1">
              Посмотреть v{list[0].version} в другой теме:
              {THEMES.map((t) => (
                <a key={t.key} href={`/api/plans/${planId}/documents/${list[0].id}/html?theme=${t.key}`} target="_blank" rel="noreferrer" className="link">
                  {t.label}
                </a>
              ))}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
