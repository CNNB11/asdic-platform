import Link from "next/link";
import { requirePlan } from "@/lib/access";
import { planClosures, planItems } from "@/lib/data";
import { planProgress } from "@/lib/progress";
import { TopBar } from "@/components/TopBar";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { overdue } from "@/lib/control";
import { hasSection } from "@/method";

export default async function PlanLayout({ children, params }: LayoutProps<"/plans/[planId]">) {
  const { planId } = await params;
  const { user, plan, method } = await requirePlan(planId);
  const items = await planItems(planId);
  const prog = planProgress(method, items, await planClosures(planId));
  const toReview = items.filter((i) => i.reviewStatus === "unreviewed" && hasSection(method, i.sectionKey)).length;
  const goals = items.filter((i) => i.sectionKey === "goals" && i.reviewStatus === "signed").map((i) => i.id);
  const late = plan.control ? overdue(plan.control, goals, await db.select({ itemId: schema.goalCheckins.itemId, periodDate: schema.goalCheckins.periodDate }).from(schema.goalCheckins).where(eq(schema.goalCheckins.planId, planId))) : null;
  const base = `/plans/${planId}`;
  return (
    <>
      <TopBar userName={user.name}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-head">{plan.title}</span>
          <span className="chip hidden md:inline-flex">Текущий этап: {prog.current.stage.title}</span>
          <span className="chip hidden md:inline-flex">{plan.depth === "deep" ? "Глубокая" : "Стандарт"}</span>
        </div>
      </TopBar>
      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 md:sticky md:top-0 md:h-[calc(100vh-57px)] md:w-64 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:p-4">
          <NavLink href={base}>Обзор</NavLink>
          <div className="cap mt-3 mb-1 hidden px-2 md:block">Этапы</div>
          {prog.stages.map((s) => (
            <NavLink key={s.stage.key} href={`${base}/${s.stage.key}`}>
              <span className="flex items-center gap-2">
                <span className={`inline-grid size-5 place-items-center text-[11px] ${s.closure ? "bg-head text-black" : "border border-line"}`}>{s.stage.num.slice(1)}</span>
                <span className={s.unlocked ? "" : "text-muted"}>{s.stage.title}</span>
              </span>
            </NavLink>
          ))}
          <div className="cap mt-3 mb-1 hidden px-2 md:block">Работа</div>
          <NavLink href={`${base}/review`}>
            <span className="flex items-center justify-between gap-2">
              Требует проверки {toReview > 0 && <span className="rounded bg-amber px-1.5 text-[12px] text-black">{toReview}</span>}
            </span>
          </NavLink>
          <NavLink href={`${base}/control`}>
            <span className="flex items-center justify-between gap-2">
              Контроль {late ? <span className="rounded bg-amber px-1.5 text-[12px] text-black">факт</span> : plan.control ? <span className="cap">вкл</span> : null}
            </span>
          </NavLink>
          <NavLink href={`${base}/team`}>Команда</NavLink>
          <NavLink href={`${base}/check`}>Противоречия</NavLink>
          <NavLink href={`${base}/items`}>Все записи</NavLink>
          <NavLink href={`${base}/sources`}>Источники</NavLink>
          <NavLink href={`${base}/documents`}>Документы</NavLink>
        </nav>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-10">
          {late && (
            <Link href={`${base}/control`} className="mb-6 block max-w-5xl rounded-lg border border-amber/60 bg-amber/10 px-4 py-2.5 text-head hover:bg-amber/20">
              Контроль: пора внести факт по целям за {new Date(late.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })} →
            </Link>
          )}
          {children}
        </main>
      </div>
    </>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block shrink-0 rounded-lg px-2 py-1.5 whitespace-nowrap hover:bg-panel-2 hover:text-head">
      {children}
    </Link>
  );
}
