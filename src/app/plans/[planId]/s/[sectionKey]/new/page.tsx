import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan, sectionOr404 } from "@/lib/access";
import { saveItem } from "@/app/actions";
import type { OptionsResult } from "@/lib/ai/ops";
import { ItemForm } from "@/components/ItemForm";
import { ModeChip } from "@/components/ui";

/** Новая запись вручную. Для красного уровня с ?op=&opt= форма заполнена выбранным вариантом ИИ. */
export default async function NewItemPage({ params, searchParams }: PageProps<"/plans/[planId]/s/[sectionKey]/new">) {
  const { planId, sectionKey } = await params;
  const sp = await searchParams;
  const { user, method } = await requirePlan(planId);
  const { stage, section } = sectionOr404(method, sectionKey);
  const base = `/plans/${planId}`;

  let values: Record<string, unknown> = {};
  for (const f of section.fields) {
    const v = sp[f.key];
    if (typeof v === "string") values[f.key] = f.type === "bool" ? v === "true" : v;
  }
  const hidden: Record<string, string> = {};
  let chosen: OptionsResult["options"][number] | null = null;
  const opId = typeof sp.op === "string" ? sp.op : "";
  if (section.mode === "red" && opId) {
    const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
    if (op?.kind === "options" && op.status === "ready") {
      hidden.op = op.id;
      const i = typeof sp.opt === "string" ? Number(sp.opt) : NaN;
      const r = op.result as OptionsResult;
      if (Number.isInteger(i) && r.options[i]) {
        chosen = r.options[i];
        hidden.opt = String(i);
        values = { ...chosen.values };
      }
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href={`${base}/${stage.key}`} className="cap link">
          ← {stage.title} · {stage.titleRu}
        </Link>
        <h1 className="mt-2">{section.mode === "red" ? `Решение: ${section.title}` : `Новая запись: ${section.title}`}</h1>
        <div className="mt-2">
          <ModeChip mode={section.mode} />
        </div>
        <p className="prose-w mt-3">{section.description}</p>
        {chosen && (
          <p className="card mt-4 px-4 py-3">
            Форма заполнена вариантом ИИ «{chosen.title}». Перед подписью перепишите поля своими словами там, где вы видите иначе. Обоснование выбора остаётся за вами.
          </p>
        )}
        {hidden.op && !chosen && <p className="card mt-4 px-4 py-3">Вы записываете своё решение. Варианты ИИ сохранятся в записи как рассмотренные.</p>}
      </div>
      <ItemForm
        section={section}
        values={values}
        action={saveItem.bind(null, planId, section.key, null)}
        cancelHref={hidden.op ? `${base}/ops/${hidden.op}` : `${base}/${stage.key}`}
        hidden={hidden}
        signerName={user.name}
      />
    </div>
  );
}
