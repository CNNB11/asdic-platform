import Link from "next/link";
import { requirePlan } from "@/lib/access";
import { planItems } from "@/lib/data";
import { itemTitle } from "@/method";
import { ItemBadge, ModeDot, ORIGIN_LABEL, fmtDate } from "@/components/ui";

export default async function AllItemsPage({ params }: PageProps<"/plans/[planId]/items">) {
  const { planId } = await params;
  const { method } = await requirePlan(planId);
  const items = await planItems(planId);
  const base = `/plans/${planId}`;
  return (
    <div className="grid max-w-5xl gap-8">
      <div>
        <h1>Все записи</h1>
        <p className="cap mt-2">Всего: {items.length}</p>
      </div>
      {method.stages.map((stage) => {
        const secs = stage.sections.filter((s) => items.some((i) => i.sectionKey === s.key));
        if (!secs.length) return null;
        return (
          <section key={stage.key}>
            <h2>
              {stage.title} <span className="text-muted">· {stage.titleRu}</span>
            </h2>
            <div className="mt-3 grid gap-4">
              {secs.map((sec) => (
                <div key={sec.key} className="card p-4">
                  <div className="flex items-center gap-2.5">
                    <ModeDot mode={sec.mode} />
                    <h3>{sec.title}</h3>
                  </div>
                  <ul className="mt-3 grid gap-1.5">
                    {items
                      .filter((i) => i.sectionKey === sec.key)
                      .map((it) => (
                        <li key={it.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <Link href={`${base}/items/${it.id}`} className="link min-w-0 truncate">
                            {itemTitle(sec, it.values)}
                          </Link>
                          <span className="flex items-center gap-3">
                            <span className="cap hidden sm:inline">{ORIGIN_LABEL[it.origin] ?? it.origin}</span>
                            <span className="cap hidden md:inline">{fmtDate(it.updatedAt)}</span>
                            <ItemBadge red={sec.mode === "red"} status={it.reviewStatus} />
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {items.length === 0 && <p>Записей пока нет. Начните с первого этапа.</p>}
    </div>
  );
}
