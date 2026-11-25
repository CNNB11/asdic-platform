import Link from "next/link";
import { requirePlan } from "@/lib/access";
import { planItems } from "@/lib/data";
import { saveTeam } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { ROLES } from "@/method/asdic";

const COVER = [
  { v: "", t: "Как закрыть?" },
  { v: "hire", t: "Нанять в штат" },
  { v: "freelance", t: "Фрилансер" },
  { v: "agency", t: "Подрядчик или агентство" },
  { v: "train", t: "Обучить сотрудника" },
  { v: "owner", t: "Пока делает собственник" },
];

/** Роли, а не имена: видно, кто есть, а кого нет, и на какие действия плана это влияет */
export default async function TeamPage({ params }: PageProps<"/plans/[planId]/team">) {
  const { planId } = await params;
  const { plan } = await requirePlan(planId);
  const actions = (await planItems(planId)).filter((i) => i.sectionKey === "action_plan");
  const team = plan.team ?? [];
  const custom = team.filter((r) => r.key.startsWith("custom_"));
  const rows = [...ROLES.map((r) => ({ key: r.value, label: r.label })), ...custom.map((r) => ({ key: r.key, label: r.label }))];
  const used = (key: string) => actions.filter((a) => a.values.owner === key);
  const gaps = rows.filter((r) => used(r.key).length > 0 && team.find((t) => t.key === r.key)?.status !== "have");
  const save = saveTeam.bind(null, planId);
  return (
    <div className="grid max-w-5xl gap-6">
      <div>
        <h1>Команда</h1>
        <p className="prose-w mt-2">
          Отметьте, какие роли у вас есть, а каких нет. Действия плана назначаются на роль, поэтому сразу видно, где дыры. Имена необязательны. ИИ учитывает команду, когда предлагает план действий.
        </p>
      </div>

      {gaps.length > 0 && (
        <section className="card border-amber/60 p-5">
          <h3>Роли, которых не хватает для плана</h3>
          <ul className="mt-3 grid gap-2">
            {gaps.map((r) => {
              const t = team.find((x) => x.key === r.key);
              return (
                <li key={r.key}>
                  <span className="text-head">{r.label}</span>
                  <span className="cap">
                    {" "}
                    · {t?.status === "partial" ? "есть частично" : t ? "нет в команде" : "не отмечено"} · действий: {used(r.key).length}
                    {t?.cover ? ` · закрываем: ${COVER.find((c) => c.v === t.cover)?.t.toLowerCase()}` : " · способ закрыть не выбран"}
                  </span>
                  <ul className="cap mt-0.5 pl-3">
                    {used(r.key).map((a) => (
                      <li key={a.id}>
                        <Link href={`/plans/${planId}/items/${a.id}`} className="link">
                          {String(a.values.what ?? "")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form action={save} className="card grid gap-1 p-5">
        <div className="cap hidden grid-cols-[1.4fr_1.6fr_1fr_1fr] gap-3 px-1 pb-2 md:grid">
          <span>Роль</span>
          <span>Есть в команде?</span>
          <span>Кто</span>
          <span>Если нет</span>
        </div>
        {rows.map((r) => {
          const t = team.find((x) => x.key === r.key);
          const n = used(r.key).length;
          return (
            <div key={r.key} className="grid items-center gap-2 border-t border-line py-2 md:grid-cols-[1.4fr_1.6fr_1fr_1fr] md:gap-3">
              <span className="text-head">
                {r.label}
                {n > 0 && <span className="cap block">в плане действий: {n}</span>}
              </span>
              <span className="flex flex-wrap gap-3 text-sm">
                {[
                  ["have", "Есть"],
                  ["partial", "Частично"],
                  ["missing", "Нет"],
                ].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="radio" name={`s_${r.key}`} value={v} defaultChecked={t?.status === v} className="accent-white" /> {l}
                  </label>
                ))}
              </span>
              <input name={`n_${r.key}`} defaultValue={t?.name ?? ""} className="field" placeholder="Имя, необязательно" />
              <select name={`c_${r.key}`} defaultValue={t?.cover ?? ""} className="field">
                {COVER.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.t}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <label className="mt-4 grid gap-1.5">
          <span className="text-head">Свои роли</span>
          <span className="cap">По одной в строке, например «Технолог производства». После сохранения появятся в списке выше.</span>
          <textarea name="custom" defaultValue={custom.map((c) => c.label).join("\n")} className="field" rows={2} />
        </label>
        <div className="mt-3">
          <Submit>Сохранить команду</Submit>
        </div>
      </form>
    </div>
  );
}
