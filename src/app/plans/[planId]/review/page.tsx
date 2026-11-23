import Link from "next/link";
import { requirePlan } from "@/lib/access";
import { planItems } from "@/lib/data";
import { approveItem } from "@/app/actions";
import { itemTitle } from "@/method";
import { Submit } from "@/components/Submit";
import { ModeDot, ORIGIN_LABEL, ValuesView } from "@/components/ui";

/** Очередь записей, которые сделал ИИ и ещё не проверил человек */
export default async function ReviewPage({ params }: PageProps<"/plans/[planId]/review">) {
  const { planId } = await params;
  const { method } = await requirePlan(planId);
  const items = (await planItems(planId)).filter((i) => i.reviewStatus === "unreviewed");
  const base = `/plans/${planId}`;
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1>Требует проверки</h1>
        <p className="prose-w mt-2">Записи ИИ не засчитываются в жёлтые уровни, пока их не утвердит человек. Красные решения засчитываются только после подписи.</p>
      </div>
      {items.length === 0 && <p className="card px-4 py-3">Всё проверено.</p>}
      {method.stages.map((stage) => {
        const list = items.filter((i) => stage.sections.some((s) => s.key === i.sectionKey));
        if (!list.length) return null;
        return (
          <section key={stage.key} className="grid gap-3">
            <h2>
              {stage.title} <span className="text-muted">· {stage.titleRu}</span>
            </h2>
            {list.map((it) => {
              const section = stage.sections.find((s) => s.key === it.sectionKey)!;
              const red = section.mode === "red";
              return (
                <div key={it.id} className={`card p-5 ${red ? "border-red/50" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <ModeDot mode={section.mode} />
                    <span className="cap">{section.title}</span>
                    <span className="cap">· {ORIGIN_LABEL[it.origin] ?? it.origin}</span>
                  </div>
                  <Link href={`${base}/items/${it.id}`} className="link mt-1 block text-[19px]">
                    {itemTitle(section, it.values)}
                  </Link>
                  <details className="mt-2">
                    <summary className="cap cursor-pointer">Показать поля</summary>
                    <div className="mt-3">
                      <ValuesView section={section} values={it.values} compact />
                    </div>
                  </details>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {red ? (
                      <Link href={`${base}/items/${it.id}/edit`} className="btn btn-red">
                        Проверить и подписать
                      </Link>
                    ) : (
                      <form action={approveItem.bind(null, planId, it.id)}>
                        <Submit pending="…">Утвердить</Submit>
                      </form>
                    )}
                    <Link href={`${base}/items/${it.id}`} className="btn">
                      Открыть с цитатами
                    </Link>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
