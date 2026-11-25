import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePlan } from "@/lib/access";
import { planClosures } from "@/lib/data";
import { deleteCheckin, disableControl, enableControl, saveCheckins } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { CheckinForm } from "@/components/CheckinForm";
import { STATE_LABEL, WINDOW_LABEL, goalStatus, overdue, schedule, type GoalState } from "@/lib/control";
import { fmtNum, parseNum, ruDay } from "@/lib/num";

const STATE_COLOR: Record<GoalState, string> = {
  done: "text-green",
  on_track: "text-green",
  behind: "text-amber",
  far_behind: "text-red",
  no_data: "text-muted",
  no_number: "text-amber",
};

/** Контроль: после закрытия Strategy план сверяется с фактом по окну (неделя, месяц, квартал) */
export default async function ControlPage({ params }: PageProps<"/plans/[planId]/control">) {
  const { planId } = await params;
  const { plan } = await requirePlan(planId);
  const closures = await planClosures(planId);
  const strategyClosed = closures.some((c) => c.stageKey === "strategy");
  const goals = await db.select().from(schema.items).where(and(eq(schema.items.planId, planId), eq(schema.items.sectionKey, "goals"))).orderBy(schema.items.createdAt);
  const signed = goals.filter((g) => g.reviewStatus === "signed");
  const checkins = await db.select().from(schema.goalCheckins).where(eq(schema.goalCheckins.planId, planId)).orderBy(schema.goalCheckins.periodDate);
  const c = plan.control;
  const today = new Date().toISOString().slice(0, 10);
  const sch = c ? schedule(c) : null;
  const late = overdue(c, signed.map((g) => g.id), checkins);
  const base = `/plans/${planId}`;

  return (
    <div className="grid max-w-5xl gap-6">
      <div>
        <p className="cap">Этап 05 · Control</p>
        <h1 className="mt-1">Контроль</h1>
        <p className="prose-w mt-2">
          Платформа сверяет факт с целями стратегии по выбранному окну: напоминает о сверке, показывает, где вы должны быть к этой дате, и насколько отстаёте или опережаете.
        </p>
      </div>

      {!c && (
        <section className="card grid gap-4 p-6">
          {strategyClosed ? (
            <>
              <h3>Включите Контроль</h3>
              <p>Стратегия закрыта. Выберите, как часто сверять факт с целями. Первая сверка будет через одно окно от даты начала.</p>
              <form action={enableControl.bind(null, planId)} className="flex flex-wrap items-end gap-4">
                <label className="grid gap-1.5">
                  <span className="cap">Окно сверки</span>
                  <select name="window" defaultValue="month" className="field">
                    <option value="week">Неделя</option>
                    <option value="month">Месяц</option>
                    <option value="quarter">Квартал</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="cap">Начало отсчёта</span>
                  <input type="date" name="startAt" defaultValue={today} className="field" />
                </label>
                <Submit>Включить Контроль</Submit>
              </form>
            </>
          ) : (
            <>
              <h3>Контроль включится после стратегии</h3>
              <p>
                Сначала подпишите цели с цифрами и закройте этап Strategy: без целевых чисел сверять нечего.{" "}
                <Link href={`${base}/strategy`} className="link">
                  Открыть Strategy
                </Link>
              </p>
            </>
          )}
        </section>
      )}

      {c && sch && (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="text-head">Сверка {WINDOW_LABEL[c.window]}</div>
            <div className="cap">
              С {ruDay(c.startAt)} · включил(а) {c.enabledBy} · следующая сверка {ruDay(sch.next)}
            </div>
          </div>
          <form action={disableControl.bind(null, planId)}>
            <Submit className="btn btn-ghost" pending="…">
              Выключить
            </Submit>
          </form>
        </section>
      )}

      {late && (
        <div className="rounded-lg border border-amber/60 bg-amber/10 px-4 py-3 text-head">
          Пора внести факт за {ruDay(late.date)}: не заполнено целей {late.missing}.
        </div>
      )}

      {signed.length === 0 && <p className="card px-4 py-3">Подписанных целей пока нет.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {signed.map((g) => {
          const mine = checkins.filter((x) => x.itemId === g.id);
          const facts = mine.map((x) => ({ date: x.periodDate, value: parseNum(x.value)! })).filter((x) => x.value != null);
          const last = facts[facts.length - 1];
          const st = goalStatus(g.values, c?.startAt ?? g.createdAt.toISOString().slice(0, 10), last);
          const unit = String(g.values.unit ?? "");
          return (
            <section key={g.id} className="card grid gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="cap">{String(g.values.metric ?? "")}</div>
                  <h3 className="mt-0.5">{String(g.values.goal ?? "")}</h3>
                </div>
                <span className={`chip ${STATE_COLOR[st.state]}`}>{STATE_LABEL[st.state]}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Точка A" v={st.a} unit={unit} />
                <Num label={last ? `Факт ${ruDay(last.date)}` : "Факт"} v={last?.value} unit={unit} strong />
                <Num label={`Цель к ${g.values.deadline ? ruDay(String(g.values.deadline)) : "сроку"}`} v={st.b} unit={unit} />
              </div>
              {st.state === "no_number" && (
                <p className="cap">
                  Впишите в цель числа «сейчас» и «цель».{" "}
                  <Link href={`${base}/items/${g.id}/edit`} className="link">
                    Открыть цель
                  </Link>
                </p>
              )}
              {"expected" in st && st.expected != null && (
                <p className="text-sm">
                  К этой дате по плану: <span className="text-head">{fmtNum(Math.round(st.expected * 100) / 100)}</span> {unit}. Отклонение:{" "}
                  <span className={st.deviation! >= 0 === st.b! >= st.a! ? "text-green" : "text-red"}>
                    {st.deviation! > 0 ? "+" : ""}
                    {fmtNum(Math.round(st.deviation! * 100) / 100)} {unit}
                  </span>
                  . Пройдено пути: {Math.round(st.progress! * 100)}%.
                </p>
              )}
              <Chart a={st.a} b={st.b} start={c?.startAt} deadline={String(g.values.deadline ?? "")} facts={facts} />
              {mine.length > 0 && (
                <details>
                  <summary className="cap cursor-pointer">История сверок: {mine.length}</summary>
                  <ul className="mt-2 grid gap-1 text-sm">
                    {mine
                      .slice()
                      .reverse()
                      .map((x) => (
                        <li key={x.id} className="flex flex-wrap items-baseline gap-x-3">
                          <span className="w-28 cap">{ruDay(x.periodDate)}</span>
                          <span className="text-head">
                            {fmtNum(Number(x.value))} {unit}
                          </span>
                          {x.note && <span className="cap">{x.note}</span>}
                          <form action={deleteCheckin.bind(null, planId, x.id)} className="ml-auto">
                            <Submit className="cap hover:text-head" pending="…">
                              Удалить
                            </Submit>
                          </form>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>

      {c && signed.length > 0 && (
        <section className="card p-6">
          <h3>Внести факт</h3>
          <p className="cap mt-1 mb-4">Число на дату сверки. Комментарий поможет понять отклонение при оценке ядра.</p>
          <CheckinForm
            action={saveCheckins.bind(null, planId)}
            date={late?.date ?? sch?.current ?? today}
            goals={signed.map((g) => {
              const l = checkins.filter((x) => x.itemId === g.id).at(-1);
              return { id: g.id, title: String(g.values.metric || g.values.goal || "Цель"), unit: String(g.values.unit ?? ""), last: l ? `${fmtNum(Number(l.value))} на ${ruDay(l.periodDate)}` : undefined };
            })}
          />
        </section>
      )}
    </div>
  );
}

function Num({ label, v, unit, strong }: { label: string; v?: number | null; unit: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${strong ? "border-head/40" : "border-line"}`}>
      <div className="cap">{label}</div>
      <div className="mt-1 text-xl text-head">
        {v != null ? fmtNum(v) : "—"} <span className="cap">{unit}</span>
      </div>
    </div>
  );
}

/** План по прямой от A к B и точки факта */
function Chart({ a, b, start, deadline, facts }: { a?: number; b?: number; start?: string; deadline: string; facts: { date: string; value: number }[] }) {
  if (a == null || b == null || !start || !deadline) return null;
  const t0 = new Date(start).getTime();
  const t1 = new Date(deadline).getTime();
  if (!(t1 > t0)) return null;
  const W = 420;
  const H = 120;
  const vals = [a, b, ...facts.map((f) => f.value)];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (d: string) => 8 + Math.max(0, Math.min(1, (new Date(d).getTime() - t0) / (t1 - t0))) * (W - 16);
  const y = (v: number) => (hi === lo ? H / 2 : H - 10 - ((v - lo) / (hi - lo)) * (H - 20));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="План и факт">
      <line x1={x(start)} y1={y(a)} x2={x(deadline)} y2={y(b)} stroke="currentColor" strokeOpacity=".35" strokeDasharray="4 3" />
      <circle cx={x(deadline)} cy={y(b)} r="4" fill="none" stroke="currentColor" />
      {facts.length > 1 && <polyline points={facts.map((f) => `${x(f.date)},${y(f.value)}`).join(" ")} fill="none" stroke="var(--color-head, #fff)" strokeWidth="2" />}
      {facts.map((f) => (
        <circle key={f.date} cx={x(f.date)} cy={y(f.value)} r="3.5" fill="var(--color-head, #fff)" />
      ))}
    </svg>
  );
}
