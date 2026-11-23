import { ASDIC } from "./asdic";
import type { Method, Section, Stage } from "./types";

const METHODS: Record<string, Method> = { [ASDIC.key]: ASDIC };

export function getMethod(key: string): Method {
  const m = METHODS[key];
  if (!m) throw new Error(`Unknown method ${key}`);
  return m;
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
  return String(v);
}

export * from "./types";
