import type { DecisionMode, FieldDef, Section } from "@/method";
import { displayValue } from "@/method";

/** ASDIC™: знак ™ 0,3 высоты строки, верх по верху букв, цвет основного текста */
export function Asdic() {
  return (
    <span className="whitespace-nowrap">
      ASDIC<sup style={{ fontSize: "0.42em", top: "-0.95em", color: "var(--text)", marginLeft: "0.05em" }}>™</sup>
    </span>
  );
}

export const MODE_LABEL: Record<DecisionMode, string> = {
  red: "Решает человек",
  yellow: "ИИ делает, человек проверяет",
  green: "ИИ делает, проверка выборочная",
};

export function ModeDot({ mode, title }: { mode: DecisionMode; title?: string }) {
  return <i className={`dot dot-${mode}`} title={title ?? MODE_LABEL[mode]} aria-label={MODE_LABEL[mode]} />;
}

export function ModeChip({ mode }: { mode: DecisionMode }) {
  return (
    <span className="chip">
      <ModeDot mode={mode} />
      {MODE_LABEL[mode]}
    </span>
  );
}

export function FieldInput({ f, value, name }: { f: FieldDef; value?: unknown; name?: string }) {
  const n = name ?? `f_${f.key}`;
  const v = value == null ? "" : String(value);
  if (f.type === "longtext") return <textarea name={n} defaultValue={v} placeholder={f.placeholder} className="field" required={f.required} rows={4} />;
  if (f.type === "enum")
    return (
      <select name={n} defaultValue={v} className="field" required={f.required}>
        <option value="">Не выбрано</option>
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (f.type === "bool")
    return (
      <label className="flex items-center gap-2 text-head">
        <input type="checkbox" name={n} defaultChecked={value === true || value === "true"} className="size-4 accent-white" /> Да
      </label>
    );
  return <input name={n} defaultValue={v} placeholder={f.placeholder} className="field" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} required={f.required} />;
}

export function FormFields({ section, values }: { section: Section; values?: Record<string, unknown> }) {
  return (
    <div className="grid gap-5">
      {section.fields.map((f) => (
        <label key={f.key} className="grid gap-1.5">
          <span className="flex items-center gap-2 text-head">
            {f.label}
            {f.required && <span className="cap">обязательное</span>}
            {f.evidence === "recommended" && <span className="chip">нужен источник</span>}
          </span>
          {f.help && <span className="cap">{f.help}</span>}
          <FieldInput f={f} value={values?.[f.key]} />
        </label>
      ))}
    </div>
  );
}

export function ValuesView({
  section,
  values,
  evidence,
  compact,
}: {
  section: Section;
  values: Record<string, unknown>;
  evidence?: { field?: string; sourceTitle: string; quote: string; page?: number }[];
  compact?: boolean;
}) {
  return (
    <dl className={compact ? "grid gap-2" : "grid gap-4"}>
      {section.fields.map((f) => {
        const v = displayValue(section, f.key, values[f.key]);
        if (!v) return null;
        const ev = evidence?.filter((e) => e.field === f.key) ?? [];
        return (
          <div key={f.key}>
            <dt className="cap">{f.label}</dt>
            <dd className={`${compact ? "text-sm" : ""} whitespace-pre-wrap text-head`}>{v}</dd>
            {ev.length > 0 && <EvidenceList ev={ev} />}
          </div>
        );
      })}
    </dl>
  );
}

export function EvidenceList({ ev }: { ev: { sourceTitle: string; quote: string; page?: number }[] }) {
  return (
    <ul className="mt-2 grid gap-1.5">
      {ev.map((e, i) => (
        <li key={i} className="border-l border-line pl-3 text-sm">
          <span className="cap">
            {e.sourceTitle}
            {e.page ? `, стр. ${e.page}` : ""}
          </span>
          <div>«{e.quote}»</div>
        </li>
      ))}
    </ul>
  );
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return <p className="rounded-lg border border-red/50 bg-red/10 px-3 py-2 text-sm text-head">{text}</p>;
}

// Часовой пояс дат на страницах. По умолчанию UTC+3 (Москва, Эр-Рияд); на сервере меняется переменной APP_TIME_ZONE.
const TIME_ZONE = (typeof process !== "undefined" && process.env.APP_TIME_ZONE) || "Europe/Moscow";

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
}

export const OP_LABEL: Record<string, string> = {
  draft_sources: "Черновик из источников",
  draft_web: "Черновик из интернета",
  options: "Варианты решения",
  improve_sources: "Улучшение",
  improve_web: "Улучшение с поиском",
  critique: "Критика",
};

export const ORIGIN_LABEL: Record<string, string> = {
  manual: "вручную",
  ai_sources: "ИИ по источникам",
  ai_web: "ИИ по интернету",
  ai_options: "вариант ИИ, выбран человеком",
};

export function ItemBadge({ red, status }: { red: boolean; status: string }) {
  if (red) return status === "signed" ? <span className="cap text-red">подписано</span> : <span className="cap text-amber">не подписано</span>;
  if (status === "unreviewed") return <span className="cap text-amber">требует проверки</span>;
  return <span className="cap">проверено</span>;
}

/** Где ограничить объём контекста для ИИ */
export function ScopePicker() {
  const opts = [
    { v: "plan", t: "Весь план", d: "ИИ видит все записи плана и все источники" },
    { v: "stage", t: "Только этот этап", d: "Записи текущего этапа и все источники" },
    { v: "none", t: "Только этот уровень", d: "Записи этого уровня и все источники" },
  ];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-head">Что учитывать</legend>
      {opts.map((o, i) => (
        <label key={o.v} className="flex items-start gap-2.5">
          <input type="radio" name="scope" value={o.v} defaultChecked={i === 0} className="mt-1.5 accent-white" />
          <span>
            <span className="text-head">{o.t}</span>
            <span className="cap block">{o.d}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
