import { ASDIC } from "@/method/asdic";

/** Что входит в глубокую стратегию: уровни с depth: "deep" */
export const DEEP_LEVELS = ASDIC.stages.flatMap((s) => s.sections.filter((x) => x.depth === "deep").map((x) => x.title));

export const DEPTHS = [
  {
    v: "standard",
    t: "Стандарт",
    time: "1–2 часа",
    d: "Анализ с проблемами ниши, расчёт цели, цели с цифрами, ценностное предложение, план действий с ролями и Контроль. Для малого бизнеса и первого круга.",
  },
  {
    v: "deep",
    t: "Глубокая",
    time: "1–2 дня",
    d: `Всё из Стандарта и ещё: ${DEEP_LEVELS.map((x) => x.toLowerCase()).join(", ")}.`,
  },
];

/** Выбор глубины: радио-карточки. Переключить можно в любой момент, записи не теряются. */
export function DepthChoice({ value }: { value: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {DEPTHS.map((o) => (
        <label key={o.v} className="card flex cursor-pointer items-start gap-3 p-4 has-[:checked]:border-head/60">
          <input type="radio" name="depth" value={o.v} defaultChecked={value === o.v} className="mt-1.5 accent-white" />
          <span>
            <span className="text-head">
              {o.t} <span className="cap">· {o.time}</span>
            </span>
            <span className="cap mt-1 block">{o.d}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
