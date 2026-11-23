import Link from "next/link";
import { requirePlan, sectionOr404 } from "@/lib/access";
import { planSources } from "@/lib/data";
import { startDraft } from "@/app/actions";
import { capabilities } from "@/lib/ai/provider";
import { PendingNote, Submit } from "@/components/Submit";
import { ModeChip, ScopePicker } from "@/components/ui";
import { Cost } from "@/components/Cost";
import { draftKind } from "@/lib/billing/tiers";

/** Запуск ИИ для уровня: черновики (жёлтый/зелёный) или три варианта решения (красный) */
export default async function SectionAiPage({ params, searchParams }: PageProps<"/plans/[planId]/s/[sectionKey]/ai">) {
  const { planId, sectionKey } = await params;
  const sp = await searchParams;
  const { method } = await requirePlan(planId);
  const { stage, section } = sectionOr404(method, sectionKey);
  const { webSearch } = await capabilities();
  const web = sp.web === "1" && webSearch && !section.ai?.approvedOnly;
  const sources = await planSources(planId);
  const red = section.mode === "red";
  const base = `/plans/${planId}`;

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href={`${base}/${stage.key}`} className="cap link">
          ← {stage.title} · {stage.titleRu}
        </Link>
        <h1 className="mt-2">
          {red ? "Варианты решения" : (section.ai?.cta ?? "Черновик")}
          {section.ai?.cta ? "" : `: ${section.title}`}
        </h1>
        <div className="mt-2">
          <ModeChip mode={section.mode} />
        </div>
        <p className="prose-w mt-3">
          {red
            ? "ИИ предложит три разных варианта. У каждого сначала слабые места, потом сильные и риски. Выбирать и подписывать будете вы; можно записать и свой вариант."
            : section.ai?.intro
              ? `${section.ai.intro} Вы выберете, какие записи сохранить; сохранённые нужно будет проверить.`
              : `ИИ предложит до ${section.draftLimit} записей. Вы выберете, какие сохранить; сохранённые записи нужно будет проверить.`}
        </p>
        <p className="cap mt-3">
          {web
            ? "ИИ сначала поищет в интернете. Найденные страницы с цитатами сохранятся в источники плана."
            : sources.length
              ? `ИИ опирается на источники плана: ${sources.length}. Факты без цитаты из источника он должен помечать осторожно; непроверяемые цитаты отбрасываются.`
              : "В плане пока нет источников. ИИ будет опираться только на записи плана. Лучше загрузить материалы или выбрать поиск в интернете."}
        </p>
      </div>
      <form action={startDraft.bind(null, planId, section.key, web)} className="card grid gap-5 p-5">
        <label className="grid gap-1.5">
          <span className="text-head">Указания для ИИ, необязательно</span>
          <span className="cap">Что учесть, на чём сделать акцент, чего избегать</span>
          <textarea name="guidance" rows={4} className="field" maxLength={4000} placeholder="Например: рынок Швейцарии, B2B, без рекламы в соцсетях" />
        </label>
        <ScopePicker />
        <Cost kind={draftKind(red, web)} />
        <div>
          <div className="flex flex-wrap gap-3">
            <Submit pending="ИИ работает…">{red ? "Получить варианты" : (section.ai?.cta ?? "Получить черновик")}</Submit>
            <Link href={`${base}/${stage.key}`} className="btn btn-ghost">
              Отмена
            </Link>
          </div>
          <PendingNote text={web ? "Поиск и анализ занимают 1–3 минуты. Не закрывайте страницу." : "Обычно это занимает до минуты. Не закрывайте страницу."} />
        </div>
      </form>
    </div>
  );
}
