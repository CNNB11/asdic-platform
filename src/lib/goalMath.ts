import { fmtNum, parseDate, parseNum } from "./num";

export interface GoalMath {
  months: number;
  salesTotal: number;
  salesMonth: number;
  salesDay: number;
  leadsMonth: number;
  leadsDay: number;
  trafficMonth: number | null;
  trafficDay: number | null;
  /** Во сколько раз нужно больше продаж, чем сейчас */
  growth: number | null;
  verdict: "realistic" | "stretch" | "unrealistic" | "unknown";
  text: string;
}

const VERDICT_TEXT = {
  realistic: "Оценка: реально, рост до 30% к текущему темпу.",
  stretch: "Оценка: напряжённо, нужно продавать в 1,3–2 раза больше, чем сейчас. Без изменений в продукте, каналах или чеке цель под угрозой.",
  unrealistic: "Оценка: нереально без изменений, нужно больше чем вдвое против текущего темпа. Меняем средний чек, конверсию, сегменты или срок.",
  unknown: "Оценки нет: укажите доход за такой же период сейчас.",
};

/** Калькулятор цели: доход к сроку → продажи, заявки и обращения в месяц и в день, плюс вердикт о реальности */
export function calcGoal(v: Record<string, unknown>, today = new Date()): GoalMath | null {
  const target = parseNum(v.revenue_target);
  const check = parseNum(v.avg_check);
  const conv = parseNum(v.lead_conv);
  const end = parseDate(v.period_end);
  if (!target || !check || !conv || conv <= 0 || !end) return null;
  const days = Math.max(1, (end.getTime() - today.getTime()) / 86400000);
  const months = Math.max(1, Math.round((days / 30.44) * 10) / 10);
  const workDays = parseNum(v.work_days) || 22;
  const tconv = parseNum(v.traffic_conv);
  const salesTotal = target / check;
  const salesMonth = salesTotal / months;
  const leadsMonth = salesMonth / (conv / 100);
  const trafficMonth = tconv && tconv > 0 ? leadsMonth / (tconv / 100) : null;
  const now = parseNum(v.revenue_now);
  const growth = now && now > 0 ? target / now : null;
  const verdict: GoalMath["verdict"] = growth == null ? "unknown" : growth <= 1.3 ? "realistic" : growth <= 2 ? "stretch" : "unrealistic";
  const cur = String(v.currency ?? "").trim();
  const r = (n: number) => fmtNum(Math.ceil(n * 10) / 10);
  const lines = [
    `Срок: ${months} мес. Нужно продаж всего: ${r(salesTotal)} по среднему чеку ${fmtNum(check)}${cur ? " " + cur : ""}.`,
    `В месяц: ${r(salesMonth)} продаж, ${r(leadsMonth)} заявок${trafficMonth ? `, ${r(trafficMonth)} обращений или визитов` : ""}.`,
    `В рабочий день: ${r(salesMonth / workDays)} продаж, ${r(leadsMonth / workDays)} заявок${trafficMonth ? `, ${r(trafficMonth / workDays)} обращений` : ""}.`,
    growth ? `Это в ${fmtNum(Math.round(growth * 100) / 100)} раза больше текущего дохода.` : "",
    VERDICT_TEXT[verdict],
    `Допущения: средний чек и конверсии не меняются весь срок, ${workDays} рабочих дня в месяце, продажи распределены равномерно. Бенчмарков ниши в расчёте нет.`,
  ].filter(Boolean);
  return {
    months,
    salesTotal,
    salesMonth,
    salesDay: salesMonth / workDays,
    leadsMonth,
    leadsDay: leadsMonth / workDays,
    trafficMonth,
    trafficDay: trafficMonth ? trafficMonth / workDays : null,
    growth,
    verdict,
    text: lines.join("\n"),
  };
}

const r1 = (n: number) => fmtNum(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);

/** Юнит-экономика: маржа с продажи, LTV, LTV/CAC, окупаемость, безубыточность */
export function calcUnit(v: Record<string, unknown>) {
  const check = parseNum(v.avg_check);
  const margin = parseNum(v.margin_pct);
  const cac = parseNum(v.cac);
  if (!check || margin == null || cac == null) return null;
  const perYear = parseNum(v.purchases_year) || 1;
  const years = parseNum(v.years) || 1;
  const cur = String(v.currency ?? "").trim();
  const c = (n: number) => `${r1(n)}${cur ? " " + cur : ""}`;
  const profit = (check * margin) / 100;
  const ltv = profit * perYear * years;
  const ratio = cac > 0 ? ltv / cac : Infinity;
  const paybackSales = profit > 0 ? cac / profit : Infinity;
  const paybackMonths = Number.isFinite(paybackSales) ? (paybackSales / perYear) * 12 : Infinity;
  const fixed = parseNum(v.fixed_month);
  const breakeven = fixed && profit > 0 ? fixed / profit : null;
  const verdict = ratio >= 3 ? "healthy" : ratio >= 1 ? "thin" : "loss";
  const text = [
    `Маржа с одной продажи: ${c(profit)}. Ценность клиента за всё время (LTV): ${c(ltv)}.`,
    `LTV/CAC: ${Number.isFinite(ratio) ? fmtNum(Math.round(ratio * 10) / 10) : "∞"}. ${verdict === "healthy" ? "Здоровая экономика: клиент приносит в 3 раза больше, чем стоит." : verdict === "thin" ? "На грани: клиент окупается, но запаса мало." : "Убыточно: клиент приносит меньше, чем стоит его привлечение."}`,
    Number.isFinite(paybackMonths) ? `Привлечение клиента окупается за ${r1(paybackSales)} покупки, примерно ${r1(paybackMonths)} мес.` : "Привлечение не окупается: маржа с продажи нулевая.",
    breakeven != null ? `Точка безубыточности: ${r1(breakeven)} продаж в месяц, чтобы покрыть постоянные расходы.` : "",
  ].filter(Boolean);
  return { profit, ltv, ratio, paybackMonths, breakeven, verdict, text: text.join("\n") };
}

/** Сценарий «что если» от расчёта цели: сколько продаж и заявок понадобится при другой цене или конверсии */
export function calcScenario(v: Record<string, unknown>, base: Record<string, unknown> | undefined) {
  if (!base) return null;
  const b = calcGoal(base);
  if (!b) return null;
  const pc = parseNum(v.price_change) ?? 0;
  const cc = parseNum(v.conv_change) ?? 0;
  const check = (parseNum(base.avg_check) ?? 0) * (1 + pc / 100);
  const conv = (parseNum(base.lead_conv) ?? 0) * (1 + cc / 100);
  const s = calcGoal({ ...base, avg_check: String(check), lead_conv: String(conv) });
  if (!s) return null;
  const d = (x: number, y: number) => `${x >= y ? "+" : ""}${fmtNum(Math.round(((x - y) / y) * 100))}%`;
  return {
    text: [
      `Нужно продаж в день: ${r1(s.salesDay)} вместо ${r1(b.salesDay)} (${d(s.salesDay, b.salesDay)}).`,
      `Заявок в день: ${r1(s.leadsDay)} вместо ${r1(b.leadsDay)} (${d(s.leadsDay, b.leadsDay)}).`,
      s.trafficDay && b.trafficDay ? `Обращений в день: ${r1(s.trafficDay)} вместо ${r1(b.trafficDay)}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    leadsDay: s.leadsDay,
    baseLeadsDay: b.leadsDay,
  };
}

/** Прогноз канала: заявки и продажи в месяц и цена продажи */
export function calcChannel(v: Record<string, unknown>) {
  const budget = parseNum(v.budget_month);
  const cpl = parseNum(v.cpl);
  if (!budget || !cpl) return null;
  const leads = budget / cpl;
  const conv = parseNum(v.lead_conv);
  const sales = conv ? (leads * conv) / 100 : null;
  const cur = String(v.currency ?? "").trim();
  return {
    leads,
    sales,
    text: `${r1(leads)} заявок в месяц${sales != null ? `, ${r1(sales)} продаж, цена продажи ${r1(budget / (sales || 1))}${cur ? " " + cur : ""}` : ""}.`,
  };
}

/** Поля, которые платформа считает сама при сохранении записи. items — записи плана для расчётов, зависящих от других уровней. */
export function deriveValues(sectionKey: string, values: Record<string, unknown>, items: { sectionKey: string; values: Record<string, unknown>; reviewStatus: string }[] = []) {
  if (sectionKey === "goal_math") {
    const m = calcGoal(values);
    return m ? { ...values, result: m.text, verdict: m.verdict } : values;
  }
  if (sectionKey === "unit_economics") {
    const m = calcUnit(values);
    return m ? { ...values, result: m.text, verdict: m.verdict } : values;
  }
  if (sectionKey === "channel_budget") {
    const m = calcChannel(values);
    return m ? { ...values, result: m.text } : values;
  }
  if (sectionKey === "scenarios") {
    const base = items.find((i) => i.sectionKey === "goal_math" && i.reviewStatus === "signed") ?? items.find((i) => i.sectionKey === "goal_math");
    const m = calcScenario(values, base?.values);
    return m ? { ...values, result: m.text } : { ...values, result: base ? values.result : "Сначала подпишите расчёт цели: сценарий считается от него." };
  }
  return values;
}
