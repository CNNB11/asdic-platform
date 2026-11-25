import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan, sectionOr404 } from "@/lib/access";
import { ackCritique, applyDraft, applyImprove, discardOp } from "@/app/actions";
import type { CritiqueResult, DraftResult, ImproveResult, OptionsResult } from "@/lib/ai/ops";
import { displayValue, itemTitle } from "@/method";
import { Submit } from "@/components/Submit";
import { EvidenceList, FieldInput, ModeChip, OP_LABEL, ValuesView, fmtDate } from "@/components/ui";

const SEVERITY: Record<string, string> = { high: "серьёзно", medium: "заметно", low: "мелочь" };

/** Результат операции ИИ: человек выбирает, что принять */
export default async function OpPage({ params }: PageProps<"/plans/[planId]/ops/[opId]">) {
  const { planId, opId } = await params;
  const { user, method } = await requirePlan(planId);
  const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
  if (!op) notFound();
  const { stage, section } = sectionOr404(method, op.sectionKey);
  const base = `/plans/${planId}`;
  const [item] = op.itemId ? await db.select().from(schema.items).where(eq(schema.items.id, op.itemId)) : [];
  const back = item ? `${base}/items/${item.id}` : `${base}/${stage.key}`;
  const discard = discardOp.bind(null, planId, op.id);

  const header = (
    <div>
      <Link href={back} className="cap link">
        ← {item ? itemTitle(section, item.values) : `${stage.title} · ${stage.titleRu}`}
      </Link>
      <h1 className="mt-2">
        {OP_LABEL[op.kind]}: {section.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <ModeChip mode={section.mode} />
        <span className="cap">
          {fmtDate(op.createdAt)}
          {op.model ? ` · ${op.model}` : ""}
        </span>
      </div>
      {op.guidance && <p className="cap mt-3">Указания: {op.guidance}</p>}
    </div>
  );

  if (op.status === "failed" || op.status === "running") {
    return (
      <div className="grid max-w-4xl gap-6">
        {header}
        <div className="card border-red/50 p-5">
          <p className="text-head">{op.status === "running" ? "Операция ещё идёт или была прервана." : "Операция не выполнена."}</p>
          {op.error && <p className="mt-2">{op.error}</p>}
          <Link href={back} className="btn mt-4">
            Вернуться
          </Link>
        </div>
      </div>
    );
  }
  if (op.status !== "ready") {
    return (
      <div className="grid max-w-4xl gap-6">
        {header}
        <div className="card p-5">
          <p className="text-head">{op.status === "applied" ? "Результат уже принят." : "Результат отклонён."}</p>
          {op.outcome && <p className="mt-1">{op.outcome}</p>}
          <Link href={back} className="btn mt-4">
            Вернуться
          </Link>
        </div>
      </div>
    );
  }

  const research = (op.result as { research?: DraftResult["research"] }).research;
  const dropped = (op.result as { dropped?: number }).dropped ?? 0;
  const meta = (
    <>
      {dropped > 0 && <p className="cap">Отброшено цитат, которых нет в источниках: {dropped}. Соответствующие утверждения проверьте особенно внимательно.</p>}
      {research && (
        <details className="card p-4">
          <summary className="cursor-pointer text-head">
            Поиск в интернете: {research.queries.length} запросов, {research.urls.length} страниц с цитатами
          </summary>
          <ul className="mt-3 grid gap-1 text-sm">
            {research.queries.map((q) => (
              <li key={q} className="cap">
                «{q}»
              </li>
            ))}
            {research.urls.map((u) => (
              <li key={u.url}>
                <a href={u.url} target="_blank" rel="noreferrer" className="link">
                  {u.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  if (op.kind === "options") {
    const r = op.result as OptionsResult;
    return (
      <div className="grid max-w-5xl gap-6">
        {header}
        <p className="prose-w">
          Это решение красного уровня. ИИ не выбирает за вас: сравните варианты, начиная со слабых мест. Выбранный вариант откроется в форме, где его можно переписать и подписать. Подписывает {user.name}.
        </p>
        {r.notes && <Notes text={r.notes} planId={planId} />}
        {meta}
        <div className="grid gap-4 lg:grid-cols-3">
          {r.options.map((o, i) => (
            <div key={i} className="card grid content-start gap-4 p-5">
              <div>
                <span className="cap">Вариант {i + 1}</span>
                <h3 className="mt-1">{o.title}</h3>
              </div>
              <Block label="Слабые места" text={o.cons} />
              <Block label="Сильные стороны" text={o.pros} />
              <Block label="Риски" text={o.risks} />
              <details>
                <summary className="cap cursor-pointer">Поля решения и цитаты</summary>
                <div className="mt-3">
                  <ValuesView section={section} values={o.values} evidence={o.evidence} compact />
                </div>
              </details>
              <Link href={`${base}/s/${section.key}/new?op=${op.id}&opt=${i}`} className="btn btn-red mt-auto">
                Выбрать и перейти к подписи
              </Link>
            </div>
          ))}
        </div>
        <form action={discard} className="flex flex-wrap gap-3">
          <Link href={`${base}/s/${section.key}/new?op=${op.id}`} className="btn">
            Записать свой вариант
          </Link>
          <Link href={back} className="btn btn-ghost">
            Решить позже
          </Link>
          <Submit className="btn btn-ghost" pending="…">
            Отклонить все варианты
          </Submit>
        </form>
      </div>
    );
  }

  if (op.kind === "draft_sources" || op.kind === "draft_web") {
    const r = op.result as DraftResult;
    return (
      <div className="grid max-w-4xl gap-6">
        {header}
        {r.notes && <Notes text={r.notes} planId={planId} />}
        {meta}
        {r.items.length === 0 ? (
          <div className="card p-5">
            <p>ИИ не нашёл, что предложить по этим материалам.</p>
            <form action={discard} className="mt-4">
              <Submit className="btn">Закрыть</Submit>
            </form>
          </div>
        ) : (
          <form action={applyDraft.bind(null, planId, op.id)} className="grid gap-4">
            <p className="cap">Отметьте записи, которые стоит сохранить, и поправьте текст прямо здесь: сохранится то, что в полях. Сохранённые записи появятся в плане со статусом «требует проверки».</p>
            {r.items.map((it, i) => (
              <div key={i} className="card grid gap-4 p-5 has-[[name=pick]:checked]:border-head/60">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" name="pick" value={i} defaultChecked className="mt-1.5 size-4 shrink-0 accent-white" />
                  <h3>{itemTitle(section, it.values)}</h3>
                </label>
                <div className="grid gap-4">
                  <input type="hidden" name={`d${i}__edit`} value="1" />
                  {section.fields.map((f) => {
                    const ev = it.evidence.filter((e) => e.field === f.key);
                    return (
                      <label key={f.key} className="grid gap-1.5">
                        <span className="cap">{f.label}</span>
                        <FieldInput f={f} value={it.values[f.key]} name={`d${i}_${f.key}`} />
                        {ev.length > 0 && <EvidenceList ev={ev} />}
                      </label>
                    );
                  })}
                </div>
                {it.evidence.length === 0 && <p className="cap text-amber">Без цитат из источников: проверьте факты сами.</p>}
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <Submit>Сохранить выбранные</Submit>
              <Link href={back} className="btn btn-ghost">
                Решить позже
              </Link>
              <button formAction={discard} className="btn btn-ghost">
                Отклонить всё
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (op.kind === "improve_sources" || op.kind === "improve_web") {
    const r = op.result as ImproveResult;
    const label = (k: string) => section.fields.find((f) => f.key === k)?.label ?? k;
    return (
      <div className="grid max-w-5xl gap-6">
        {header}
        {r.summary && <p className="card px-4 py-3">{r.summary}</p>}
        {meta}
        {section.mode === "red" && r.changes.length > 0 && (
          <p className="card border-red/50 px-4 py-3">Это подписанное решение. После изменений оно снова потребует подписи.</p>
        )}
        {r.changes.length === 0 ? (
          <div className="card p-5">
            <p>ИИ не нашёл, что улучшить по этим материалам.</p>
            <form action={discard} className="mt-4">
              <Submit className="btn">Закрыть</Submit>
            </form>
          </div>
        ) : (
          <form action={applyImprove.bind(null, planId, op.id)} className="grid gap-4">
            <p className="cap">Предложенный текст можно поправить прямо здесь: применится то, что в поле.</p>
            {r.changes.map((c) => {
              const f = section.fields.find((x) => x.key === c.field);
              return (
                <div key={c.field} className="card grid gap-3 p-5 has-[[name=pick]:checked]:border-head/60">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" name="pick" value={c.field} defaultChecked className="mt-1.5 size-4 shrink-0 accent-white" />
                    <h3>{label(c.field)}</h3>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="cap">Сейчас</div>
                      <p className="mt-1 whitespace-pre-wrap">{displayValue(section, c.field, c.current) || "пусто"}</p>
                    </div>
                    <label className="grid content-start gap-1">
                      <span className="cap">Предлагается</span>
                      {f && <input type="hidden" name={`p__${c.field}`} value="1" />}
                      {f ? <FieldInput f={f.type === "text" ? { ...f, type: "longtext" } : f} value={c.proposed} name={`p_${c.field}`} /> : <p className="mt-1 whitespace-pre-wrap text-head">{String(c.proposed)}</p>}
                    </label>
                  </div>
                  <p className="cap">Почему: {c.rationale}</p>
                  {c.evidence.length > 0 && <EvidenceList ev={c.evidence} />}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3">
              <Submit>Применить выбранное</Submit>
              <Link href={back} className="btn btn-ghost">
                Решить позже
              </Link>
              <button formAction={discard} className="btn btn-ghost">
                Отклонить всё
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const r = op.result as CritiqueResult;
  return (
    <div className="grid max-w-4xl gap-6">
      {header}
      <p className="card px-4 py-3">{r.overall}</p>
      <div className="grid gap-3">
        {r.findings.map((f, i) => (
          <div key={i} className={`card p-5 ${f.severity === "high" ? "border-amber/60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3>{f.criterion}</h3>
              <span className="cap">{SEVERITY[f.severity]}</span>
            </div>
            <p className="mt-2 text-head">{f.issue}</p>
            <p className="mt-2">Что сделать: {f.suggestion}</p>
          </div>
        ))}
        {r.findings.length === 0 && <p>Замечаний нет.</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        {item && (
          <Link href={`${base}/items/${item.id}/edit`} className="btn">
            Исправить запись
          </Link>
        )}
        <form action={ackCritique.bind(null, planId, op.id)}>
          <Submit className="btn btn-ghost">Прочитано</Submit>
        </form>
      </div>
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <div className="cap">{label}</div>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </div>
  );
}

/** Заметки ИИ. Если в них есть противоречие, даём перейти к проверке плана, где его можно исправить */
function Notes({ text, planId }: { text: string; planId: string }) {
  const conflict = /противореч|не сход|расход|не совпада|несоответств/i.test(text);
  return (
    <div className={`card px-4 py-3 ${conflict ? "border-amber/60" : ""}`}>
      <p>{text}</p>
      {conflict && (
        <Link href={`/plans/${planId}/check`} className="link mt-2 inline-block text-head">
          Похоже на противоречие в цифрах. Открыть и исправить →
        </Link>
      )}
    </div>
  );
}
