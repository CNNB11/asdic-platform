import type { PlanControl } from "@/db/schema";
import { isoDay, parseDate, parseNum } from "./num";

export const WINDOW_LABEL: Record<PlanControl["window"], string> = { week: "раз в неделю", month: "раз в месяц", quarter: "раз в квартал" };

function addWindow(d: Date, w: PlanControl["window"], n: number) {
  const x = new Date(d);
  if (w === "week") x.setUTCDate(x.getUTCDate() + 7 * n);
  else x.setUTCMonth(x.getUTCMonth() + (w === "month" ? n : 3 * n));
  return x;
}

/** Даты сверок: каждое окно от даты включения. Возвращает прошедшие и ближайшую будущую. */
export function schedule(c: PlanControl, today = new Date()) {
  const start = parseDate(c.startAt) ?? today;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const past: string[] = [];
  let n = 1;
  let d = addWindow(start, c.window, n);
  while (d.getTime() <= t && n < 500) {
    past.push(isoDay(d));
    d = addWindow(start, c.window, ++n);
  }
  return { past, next: isoDay(d), current: past[past.length - 1] ?? null };
}

/** Сверка просрочена: последняя прошедшая дата без факта хотя бы по одной цели */
export function overdue(c: PlanControl | null | undefined, goalIds: string[], checkins: { itemId: string; periodDate: string }[], today = new Date()) {
  if (!c || !goalIds.length) return null;
  const { current } = schedule(c, today);
  if (!current) return null;
  const missing = goalIds.filter((g) => !checkins.some((x) => x.itemId === g && x.periodDate === current));
  return missing.length ? { date: current, missing: missing.length } : null;
}

export type GoalState = "done" | "on_track" | "behind" | "far_behind" | "no_data" | "no_number";

export const STATE_LABEL: Record<GoalState, string> = {
  done: "Цель достигнута",
  on_track: "В графике",
  behind: "Отстаём",
  far_behind: "Сильно отстаём",
  no_data: "Нет факта",
  no_number: "У цели нет числа",
};

/**
 * Где должны быть сейчас по прямой от точки A (дата включения Контроля) до цели к сроку,
 * и насколько факт отстаёт. Работает и для целей «на снижение».
 */
export function goalStatus(g: Record<string, unknown>, start: string, fact: { date: string; value: number } | undefined) {
  const a = parseNum(g.current);
  const b = parseNum(g.target);
  const end = parseDate(g.deadline);
  const s = parseDate(start);
  if (a == null || b == null || !end || !s || a === b) return { state: "no_number" as GoalState };
  if (!fact) return { state: "no_data" as GoalState, a, b };
  const at = parseDate(fact.date)!;
  const share = Math.max(0, Math.min(1, (at.getTime() - s.getTime()) / (end.getTime() - s.getTime() || 1)));
  const expected = a + (b - a) * share;
  const progress = (fact.value - a) / (b - a);
  const gap = (fact.value - expected) / (b - a); // <0 — отстаём, доля от всего пути
  const state: GoalState = progress >= 1 ? "done" : gap >= -0.1 ? "on_track" : gap >= -0.25 ? "behind" : "far_behind";
  return { state, a, b, expected, progress, gap, deviation: fact.value - expected };
}
