import type { Method, Section, Stage } from "@/method";

export interface ItemLike {
  sectionKey: string;
  values: Record<string, unknown>;
  reviewStatus: string;
}

export interface SectionStatus<T extends ItemLike = ItemLike> {
  section: Section;
  items: T[];
  reqs: { label: string; have: number; min: number; ok: boolean }[];
  needed: number; // сколько записей не хватает в сумме
  unreviewed: number; // жёлтые: не утверждены
  complete: boolean; // требования выполнены и проверка пройдена по правилам светофора
}

/** Что засчитывается в требования: красные — только подписанные решения, остальные — все записи */
function counts(section: Section, it: ItemLike) {
  if (section.mode === "red") return it.reviewStatus === "signed";
  return true;
}

export function sectionStatus<T extends ItemLike>(section: Section, all: T[]): SectionStatus<T> {
  const items = all.filter((i) => i.sectionKey === section.key);
  const counted = items.filter((i) => counts(section, i));
  const reqs = section.requirements.map((r) => {
    const have = counted.filter((i) => !r.where || String(i.values[r.where.field]) === r.where.equals).length;
    return { label: r.label, have, min: r.min, ok: have >= r.min };
  });
  const needed = reqs.reduce((n, r) => n + Math.max(0, r.min - r.have), 0);
  const unreviewed = section.mode === "yellow" ? items.filter((i) => i.reviewStatus === "unreviewed").length : 0;
  const complete = reqs.every((r) => r.ok) && unreviewed === 0;
  return { section, items, reqs, needed, unreviewed, complete };
}

export function stageStatus<T extends ItemLike>(stage: Stage, all: T[]) {
  const sections = stage.sections.map((s) => sectionStatus(s, all));
  const color = { red: 0, yellow: 0, green: 0 };
  stage.sections.forEach((s) => color[s.mode]++);
  return {
    stage,
    sections,
    complete: sections.every((s) => s.complete),
    remaining: sections.filter((s) => !s.complete).length,
    unreviewed: sections.reduce((n, s) => n + s.unreviewed, 0),
    color,
  };
}

/** Этап открыт, если предыдущий выполнен и человек его закрыл. Первый этап открыт всегда. */
export function planProgress<T extends ItemLike>(method: Method, all: T[], closures: { stageKey: string; closedBy: string; createdAt: Date }[] = []) {
  const stages = method.stages.map((st) => stageStatus(st, all));
  let open = true;
  const withLock = stages.map((s) => {
    const unlocked = open;
    const closure = closures.find((c) => c.stageKey === s.stage.key) ?? null;
    open = open && s.complete && !!closure;
    return { ...s, unlocked, closure };
  });
  const current = withLock.find((s) => s.unlocked && !s.closure) ?? withLock[withLock.length - 1];
  return { stages: withLock, current };
}
