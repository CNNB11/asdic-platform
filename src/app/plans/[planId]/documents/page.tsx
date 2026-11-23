import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { planClosures, planItems } from "@/lib/data";
import { planProgress } from "@/lib/progress";
import type { DocModel } from "@/lib/export/model";
import { deleteDocuments, generateDocument } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";

const FORMATS = [
  { f: "pdf", t: "PDF" },
  { f: "docx", t: "Word" },
  { f: "md", t: "Markdown" },
  { f: "html", t: "Просмотр" },
];

/** Документ этапа собирается из записей плана без ИИ: что в плане, то и в документе */
export default async function DocumentsPage({ params, searchParams }: PageProps<"/plans/[planId]/documents">) {
  const { planId } = await params;
  const sp = await searchParams;
  const { method } = await requirePlan(planId);
  const prog = planProgress(method, await planItems(planId), await planClosures(planId));
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.planId, planId)).orderBy(desc(schema.documents.version));
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1>Документы</h1>
        <p className="prose-w mt-2">
          Документ этапа собирается из записей плана: подписанные решения, проверенные записи, цитаты и список источников. Непроверенное попадает в документ с пометкой. Каждая сборка сохраняется отдельной версией.
        </p>
      </div>
      {prog.stages.map((st) => {
        const list = docs.filter((d) => d.stageKey === st.stage.key);
        const fresh = list.find((d) => d.id === sp.ready);
        return (
          <section key={st.stage.key} className={`card p-5 ${st.unlocked ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3>
                {st.stage.title} <span className="text-muted">· {st.stage.titleRu}</span>
              </h3>
              <span className="cap">{st.closure ? `Закрыт: ${st.closure.closedBy}` : st.complete ? "Готов к закрытию" : `Не закрыто уровней: ${st.remaining}`}</span>
            </div>
            {st.unlocked ? (
              <form action={generateDocument.bind(null, planId, st.stage.key)} className="mt-4">
                <Submit className="btn" pending="Собираю…">
                  {list.length ? "Собрать новую версию" : "Собрать документ"}
                </Submit>
              </form>
            ) : (
              <p className="cap mt-3">Этап ещё не открыт.</p>
            )}
            {fresh && (fresh.model as DocModel).outstanding.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber/50 p-3 text-sm">
                <p className="text-head">В документе есть незакрытое:</p>
                <ul className="mt-1 grid gap-0.5">
                  {(fresh.model as DocModel).outstanding.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            {list.length > 0 && (
              <ul className="mt-4 grid gap-2 border-t border-line pt-3">
                {list.map((d) => (
                  <li key={d.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${d.id === sp.ready ? "text-head" : ""}`}>
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
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
