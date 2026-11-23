import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { createPlan } from "@/app/actions";
import { TopBar } from "@/components/TopBar";
import { Submit } from "@/components/Submit";
import { fmtDate } from "@/components/ui";

export default async function PlansPage() {
  const user = await requireUser();
  const plans = await db.select().from(schema.plans).where(eq(schema.plans.ownerId, user.id)).orderBy(desc(schema.plans.updatedAt));
  return (
    <>
      <TopBar userName={user.name} />
      <main className="mx-auto grid max-w-5xl gap-10 px-4 py-10 md:px-6">
        <section>
          <h1>Планы</h1>
          <p className="cap mt-2">Каждый план ведёт один бизнес из точки A в точку B через пять этапов.</p>
          <div className="mt-6 grid gap-3">
            {plans.length === 0 && <p>Планов пока нет. Создайте первый ниже.</p>}
            {plans.map((p) => (
              <Link key={p.id} href={`/plans/${p.id}`} className="card flex items-center justify-between gap-4 p-4 hover:border-[#444]">
                <div>
                  <div className="text-head">{p.title}</div>
                  <div className="cap">{p.company || "Компания не указана"}</div>
                </div>
                <span className="cap">{fmtDate(p.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="card p-6">
          <h3>Новый план</h3>
          <form action={createPlan} className="mt-5 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-head">Название плана</span>
              <input name="title" className="field" placeholder="Например: Рост продаж ArtAutomation 2027" required />
            </label>
            <label className="grid gap-1.5">
              <span className="text-head">Компания</span>
              <span className="cap">Кто вы, что продаёте, где работаете. Две-три фразы.</span>
              <textarea name="company" className="field" rows={3} />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-head">Точка A</span>
                <span className="cap">Где бизнес сейчас: цифры, главные проблемы.</span>
                <textarea name="pointA" className="field" rows={4} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-head">Точка B</span>
                <span className="cap">Куда хотите прийти и к какому сроку.</span>
                <textarea name="pointB" className="field" rows={4} />
              </label>
            </div>
            <div>
              <Submit>Создать план</Submit>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
