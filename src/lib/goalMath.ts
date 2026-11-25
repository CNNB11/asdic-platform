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
  realistic: "Реально: рост до 30% к текущему темпу.",
  stretch: "Напряжённо: нужно продавать в 1,3–2 раза больше, чем сейчас. Без изменений в продукте, каналах или чеке цель под угрозой.",
  unrealistic: "Нереально без изменений: нужно больше чем вдвое против текущего темпа. Меняем средний чек, конверсию, сегменты или срок.",
  unknown: "Не с чем сравнить: укажите доход за такой же период сейчас.",
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

/** Поля, которые платформа считает сама при сохранении записи */
export function deriveValues(sectionKey: string, values: Record<string, unknown>) {
  if (sectionKey !== "goal_math") return values;
  const m = calcGoal(values);
  if (!m) return values;
  return { ...values, result: m.text, verdict: m.verdict };
}
