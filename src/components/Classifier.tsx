"use client";
import { useState } from "react";

type Ans = "yes" | "no" | "unsure" | null;
type Color = 0 | 1 | 2; // зелёный, жёлтый, красный
const NAMES = ["Зелёный", "Жёлтый", "Красный"];
const DOT = ["dot-green", "dot-yellow", "dot-red"];
const MEANING = [
  "ИИ делает сам, человек проверяет выборочно. Отвечает владелец процесса; записывать ничего не нужно, достаточно журнала.",
  "ИИ предлагает, человек проверяет всё и правит. Факты сверяются с источниками. Отвечает тот, кто проверил; записать, что исправлено.",
  "Решает и отвечает человек по имени, ИИ только помогает думать: три разных варианта, сначала слабые места каждого, потом сильные. Человек записывает причину выбора, к ней возвращаются в Control. Цвет подтверждает второй человек.",
];

const QUESTIONS = [
  { k: "judgment", t: "Суждение", q: "Задача из закрытого списка красных решений: требует выбора по ценностям, вкусу или ответственности?" },
  { k: "reversible", t: "Обратимость", q: "Результат можно отменить быстро и дёшево?" },
  { k: "external", t: "Выход наружу", q: "Результат увидит клиент, аудитория, партнёр или регулятор?" },
  { k: "verifiable", t: "Проверяемость", q: "Результат можно быстро сверить с источником, данными или образцом?" },
] as const;

const RAISE = [
  "Цифры, факты, цитаты, сравнение с конкурентами",
  "Новый рынок, язык или культура",
  "Юридические, медицинские или финансовые утверждения",
  "Личные или конфиденциальные данные",
  "Бренд или продукт делается впервые",
  "ИИ работал с чужими сайтами или файлами",
];
const LOWER = ["Есть утверждённый образец", "Задача повторяется без ошибок", "ИИ работает только с данными, которые ему дали, и ссылается на них"];

export function Classifier({ redList }: { redList: { stage: string; items: string[] }[] }) {
  const [task, setTask] = useState("");
  const [a, setA] = useState<Record<string, Ans>>({ judgment: null, reversible: null, external: null, verifiable: null });
  const [raise, setRaise] = useState<string[]>([]);
  const [lower, setLower] = useState<string[]>([]);
  const done = Object.values(a).every((v) => v !== null);

  // При сомнении ответ считается худшим: цвет берут на ступень выше
  const judgment = a.judgment !== "no";
  const irreversible = a.reversible !== "yes";
  const external = a.external !== "no";
  const verifiable = a.verifiable === "yes";
  const unsure = Object.values(a).includes("unsure");

  const why: string[] = [];
  let base: Color;
  if (judgment) {
    base = 2;
    why.push(a.judgment === "unsure" ? "Неясно, нужен ли выбор человека: при сомнении считаем, что нужен." : "Задача требует суждения: верного ответа нет, есть человек, который отвечает за выбор.");
  } else if (irreversible && external) {
    base = 2;
    why.push("Результат необратим и выходит наружу: ошибку ИИ увидят, и вернуть её не получится.");
  } else if (!irreversible && !external && verifiable) {
    base = 0;
    why.push("Суждение не нужно, результат обратим, остаётся внутри и проверяется.");
  } else {
    base = 1;
    const r: string[] = [];
    if (irreversible) r.push("результат трудно отменить");
    if (external) r.push("результат выходит наружу");
    if (!verifiable) r.push("результат трудно проверить");
    why.push(`Суждение не нужно, но ${r.join(", ")}.`);
  }
  let color = base;
  if (base < 2 && raise.length) {
    color = (color + 1) as Color;
    why.push(`Поднимает на ступень: ${raise.join("; ").toLowerCase()}.`);
  }
  if (base < 2 && lower.length && color > 0) {
    color = (color - 1) as Color;
    why.push(`Опускает на ступень: ${lower.join("; ").toLowerCase()}.`);
  }
  if (base === 2 && lower.length) why.push("Красное не опускается: суждение и ответственность не нарабатываются повторением.");
  if (unsure) why.push("Были ответы «не уверен»: они засчитаны как худший вариант.");

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="grid gap-6">
      <label className="grid gap-1.5">
        <span className="text-head">Задача</span>
        <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} className="field" placeholder="Например: написать пресс-релиз о запуске в Саудовской Аравии" />
      </label>

      {QUESTIONS.map((q, i) => (
        <fieldset key={q.k} className="card grid gap-3 p-4">
          <legend className="sr-only">{q.t}</legend>
          <div>
            <span className="cap">
              {i + 1}. {q.t}
            </span>
            <p className="mt-0.5 text-head">{q.q}</p>
          </div>
          {q.k === "judgment" && (
            <details>
              <summary className="cap cursor-pointer">Закрытый список красных решений</summary>
              <ul className="mt-2 grid gap-1 text-sm">
                {redList.map((s) => (
                  <li key={s.stage}>
                    <span className="text-head">{s.stage}:</span> {s.items.join(", ")}
                  </li>
                ))}
              </ul>
              <p className="cap mt-2">Всё, чего нет в списке, красное только если необратимо и выходит наружу.</p>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {(["yes", "no", "unsure"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setA({ ...a, [q.k]: v })} className={`chip ${a[q.k] === v ? "border-head bg-head text-black" : ""}`}>
                {{ yes: "Да", no: "Нет", unsure: "Не уверен" }[v]}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="card grid content-start gap-2 p-4">
          <legend className="sr-only">Что поднимает цвет</legend>
          <span className="cap">Поднимает на ступень</span>
          {RAISE.map((r) => (
            <label key={r} className="flex items-start gap-2.5">
              <input type="checkbox" checked={raise.includes(r)} onChange={() => toggle(raise, setRaise, r)} className="mt-1.5 accent-white" />
              <span>{r}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="card grid content-start gap-2 p-4">
          <legend className="sr-only">Что опускает цвет</legend>
          <span className="cap">Опускает на ступень</span>
          {LOWER.map((r) => (
            <label key={r} className="flex items-start gap-2.5">
              <input type="checkbox" checked={lower.includes(r)} onChange={() => toggle(lower, setLower, r)} className="mt-1.5 accent-white" />
              <span>{r}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <section className={`card p-5 ${done ? (color === 2 ? "border-red/70" : color === 1 ? "border-amber/60" : "border-green/60") : ""}`} aria-live="polite">
        {done ? (
          <>
            <div className="flex items-center gap-3">
              <i className={`dot ${DOT[color]}`} />
              <h2>{NAMES[color]}</h2>
            </div>
            {task && <p className="cap mt-1">{task}</p>}
            <p className="mt-3 text-head">{MEANING[color]}</p>
            <ul className="mt-3 grid gap-1">
              {why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p className="cap mt-4">Цвет задаёт не сложность задачи, а цена непроверенной ошибки ИИ: что случится, если ИИ ошибся и никто этого не заметил.</p>
          </>
        ) : (
          <p>Ответьте на четыре вопроса, чтобы получить цвет.</p>
        )}
      </section>
    </div>
  );
}
