import Link from "next/link";
import { itemOr404, requirePlan, sectionOr404 } from "@/lib/access";
import { startImprove } from "@/app/actions";
import { capabilities } from "@/lib/ai/provider";
import { itemTitle } from "@/method";
import { PendingNote, Submit } from "@/components/Submit";
import { ScopePicker } from "@/components/ui";
import { Cost } from "@/components/Cost";

/** Улучшение записи: по источникам или с поиском в интернете */
export default async function ItemAiPage({ params, searchParams }: PageProps<"/plans/[planId]/items/[itemId]/ai">) {
  const { planId, itemId } = await params;
  const sp = await searchParams;
  const { method } = await requirePlan(planId);
  const item = await itemOr404(planId, itemId);
  const { section } = sectionOr404(method, item.sectionKey);
  const { webSearch } = await capabilities();
  const web = sp.kind === "improve_web" && webSearch;
  const href = `/plans/${planId}/items/${item.id}`;
  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href={href} className="cap link">
          ← {itemTitle(section, item.values)}
        </Link>
        <h1 className="mt-2">{web ? "Улучшить с поиском в интернете" : "Улучшить по источникам"}</h1>
        <p className="prose-w mt-3">
          ИИ предложит точечные правки полей с обоснованием и цитатами. Вы выберете, какие применить. После правок запись снова потребует {section.mode === "red" ? "подписи" : "проверки"}.
        </p>
      </div>
      <form action={startImprove.bind(null, planId, item.id, web)} className="card grid gap-5 p-5">
        <label className="grid gap-1.5">
          <span className="text-head">Что улучшить, необязательно</span>
          <textarea name="guidance" rows={4} className="field" maxLength={4000} placeholder="Например: добавить цифры по рынку, уточнить сегмент" />
        </label>
        <ScopePicker />
        <Cost kind={web ? "improve_web" : "improve_sources"} />
        <div>
          <div className="flex flex-wrap gap-3">
            <Submit pending="ИИ работает…">Предложить улучшения</Submit>
            <Link href={href} className="btn btn-ghost">
              Отмена
            </Link>
          </div>
          <PendingNote text={web ? "Поиск и анализ занимают 1–3 минуты." : "Обычно это занимает до минуты."} />
        </div>
      </form>
    </div>
  );
}
