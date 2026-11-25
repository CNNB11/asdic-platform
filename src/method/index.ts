import { ASDIC } from "./asdic";
import type { Method, Section, Stage } from "./types";

const METHODS: Record<string, Method> = { [ASDIC.key]: ASDIC };

export function getMethod(key: string): Method {
  const m = METHODS[key];
  if (!m) throw new Error(`Unknown method ${key}`);
  return m;
}

export type Depth = "standard" | "deep";

/** Метод для глубины плана: в стандартной стратегии уровней «deep» нет. Записи в них сохраняются и вернутся при переключении. */
export function methodForDepth(m: Method, depth: string | null | undefined): Method {
  if (depth === "deep") return m;
  return { ...m, stages: m.stages.map((st) => ({ ...st, sections: st.sections.filter((s) => s.depth !== "deep") })) };
}

/** Есть ли уровень в методе этой глубины */
export function hasSection(m: Method, key: string) {
  return m.stages.some((st) => st.sections.some((s) => s.key === key));
}

export function listMethods(): Method[] {
  return Object.values(METHODS);
}

export function findSection(method: Method, sectionKey: string): { stage: Stage; section: Section } {
  for (const stage of method.stages) {
    const section = stage.sections.find((s) => s.key === sectionKey);
    if (section) return { stage, section };
  }
  throw new Error(`Unknown section ${sectionKey}`);
}

export function findStage(method: Method, stageKey: string): Stage {
  const s = method.stages.find((x) => x.key === stageKey);
  if (!s) throw new Error(`Unknown stage ${stageKey}`);
  return s;
}

export function itemTitle(section: Section, values: Record<string, unknown>): string {
  const v = values[section.titleField];
  const f = section.fields.find((x) => x.key === section.titleField);
  if (f?.type === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v ?? "");
  return String(v ?? "").slice(0, 120) || section.itemLabel;
}

export function displayValue(section: Section, key: string, v: unknown): string {
  const f = section.fields.find((x) => x.key === key);
  if (v === undefined || v === null || v === "") return "";
  if (f?.type === "bool") return v === true || v === "true" ? "Да" : "Нет";
  if (f?.type === "enum") return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f?.type === "number" && /^-?\d+(\.\d+)?$/.test(String(v))) return Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (f?.type === "date") {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return String(v);
}

export * from "./types";
