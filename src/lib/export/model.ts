import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PlanBrand } from "@/db/schema";
import { displayValue, findStage, itemTitle, type Method, type Stage } from "@/method";
import { sectionStatus } from "@/lib/progress";
import { MODE_LABEL } from "@/components/ui";
import { datesIn, isoDay, parseDate, parseNum } from "@/lib/num";
import { calcGoal } from "@/lib/goalMath";
import type { Digest } from "./digest";
import { ROLES } from "@/method/asdic";

export interface DocItem {
  title: string;
  badge?: string;
  fields: { label: string; value: string; refs: number[] }[];
  status: { kind: "signed" | "approved" | "unreviewed" | "unsigned"; text: string };
  options?: { title: string; chosen: boolean }[];
}

export interface DocSection {
  title: string;
  mode: string;
  modeLabel: string;
  description: string;
  items: DocItem[];
}

/** Глава документа: один этап метода */
export interface DocPart {
  key?: string;
  num: string;
  title: string;
  titleRu: string;
  question: string;
  sections: DocSection[];
}

export interface Kpi {
  goal: string;
  metric: string;
  unit: string;
  current: number | null;
  target: number | null;
  currentText: string;
  targetText: string;
  deadline: string;
  /** Факт по сверкам Контроля, по возрастанию даты */
  facts?: { date: string; value: number }[];
}

export interface TimelineRow {
  label: string;
  owner?: string;
  /** ГГГГ-ММ-ДД */
  date: string;
  kind: "action" | "launch" | "checkpoint" | "goal";
}

/** Сводка стратегии для первых страниц полной выгрузки: цифры, графики, SWOT */
export interface Dashboard {
  positioning?: string;
  segment?: string;
  horizon?: string;
  budget?: { total: string; split: string };
  kpis: Kpi[];
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  timeline: TimelineRow[];
  /** Воронка из расчёта цели: сколько нужно в месяц и в день */
  funnel?: { revenue: number; currency: string; months: number; verdict: string; verdictText: string; steps: { label: string; month: number; day: number }[] };
  /** Начало и конец шкалы времени, ГГГГ-ММ-ДД */
  range?: { from: string; to: string };
}

export interface DocModel {
  /** stage — документ этапа, full — вся стратегия. В старых версиях поля нет (= stage) */
  kind?: "stage" | "full";
  planTitle: string;
  company: string;
  stageNum: string;
  stageTitle: string;
  stageTitleRu: string;
  question: string;
  preparedAt: string;
  preparedBy: string;
  methodLine: string;
  pointA: string;
  pointB: string;
  outstanding: string[];
  sections: DocSection[];
  sources: { n: number; title: string; url?: string; citedBy: string[] }[];
  /** Главы полной стратегии */
  parts?: DocPart[];
  dashboard?: Dashboard;
  /** Слой для быстрого чтения, который пишет ИИ: главный вывод, заголовки-выводы, цифры, решения, риски */
  digest?: Digest;
  /** Платный тариф на момент сборки: белый лейбл, без водяного знака */
  paid?: boolean;
  brand?: PlanBrand;
}

type Plan = typeof schema.plans.$inferSelect;
type Item = typeof schema.items.$inferSelect;

/** Главы документа из записей плана. Нумерация источников общая на весь документ. */
async function collect(plan: Plan, stages: Stage[], paid: boolean) {
  const keys = stages.flatMap((s) => s.sections.map((x) => x.key));
  const items = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.planId, plan.id), inArray(schema.items.sectionKey, keys)))
    .orderBy(schema.items.createdAt);
  const cites = items.length ? await db.select().from(schema.citations).where(inArray(schema.citations.itemId, items.map((i) => i.id))) : [];
  const srcIds = [...new Set(cites.map((c) => c.sourceId))];
  const srcs = srcIds.length ? await db.select().from(schema.sources).where(inArray(schema.sources.id, srcIds)) : [];
  const order = new Map<string, number>();
  const sources: DocModel["sources"] = [];
  const refOf = (sourceId: string) => {
    if (!order.has(sourceId)) {
      const s = srcs.find((x) => x.id === sourceId);
      order.set(sourceId, sources.length + 1);
      sources.push({ n: sources.length + 1, title: s?.title ?? "Источник", url: s?.url ?? undefined, citedBy: [] });
    }
    return order.get(sourceId)!;
  };

  const outstanding: string[] = [];
  const parts: DocPart[] = stages.map((stage) => ({
    key: stage.key,
    num: stage.num,
    title: stage.title,
    titleRu: stage.titleRu,
    question: stage.question,
    sections: stage.sections.map((section) => {
      const st = sectionStatus(section, items);
      st.reqs.filter((r) => !r.ok).forEach((r) => outstanding.push(`${section.title}: ${r.label.toLowerCase()} (есть ${r.have} из ${r.min})`));
      const docItems: DocItem[] = st.items.map((it) => {
        const title = itemTitle(section, it.values);
        const fields = section.fields
          .filter((f) => f.key !== section.titleField || f.type === "enum")
          .map((f) => {
            const value = displayValue(section, f.key, it.values[f.key]);
            const refs = [...new Set(cites.filter((c) => c.itemId === it.id && c.fieldKey === f.key).map((c) => refOf(c.sourceId)))];
            refs.forEach((n) => {
              const s = sources[n - 1];
              const label = `${section.itemLabel}: ${title}`;
              if (!s.citedBy.includes(label)) s.citedBy.push(label);
            });
            return { label: f.label, value, refs };
          })
          .filter((f) => f.value);
        const by = it.reviewedBy ?? "";
        const when = it.reviewedAt ? new Date(it.reviewedAt).toLocaleDateString("ru-RU") : "";
        const ai = it.origin !== "manual";
        let status: DocItem["status"];
        if (section.mode === "red") status = it.reviewStatus === "signed" ? { kind: "signed", text: `Решение подписал(а) ${by}, ${when}` } : { kind: "unsigned", text: "Решение не подписано человеком" };
        else if (it.reviewStatus === "unreviewed") status = { kind: "unreviewed", text: paid ? "Черновик: ещё не проверено ответственным" : "Требует проверки: сделано ИИ, человек ещё не проверил" };
        // В платной выгрузке не пишем «сделано ИИ»: запись проверил и отвечает за неё человек
        else status = { kind: "approved", text: paid ? `Проверил(а) ${by}` : ai ? `Сделано ИИ, проверил(а) ${by}` : `Внёс(ла) ${by}` };
        if (section.mode === "yellow" && it.reviewStatus === "unreviewed") outstanding.push(`${section.title}: «${title}» не проверено человеком`);
        if (section.mode === "red" && it.reviewStatus !== "signed") outstanding.push(`${section.title}: «${title}» не подписано`);
        const badge = section.fields.find((f) => f.uniqueTrue && it.values[f.key] === true)?.label;
        const options = it.decision?.options.map((o, i) => ({ title: o.title, chosen: it.decision?.chosenIndex === i }));
        return { title, badge, fields, status, options };
      });
      return { title: section.title, mode: section.mode, modeLabel: MODE_LABEL[section.mode], description: section.description, items: docItems };
    }),
  }));
  return { parts, sources, outstanding, items };
}

function base(plan: Plan, method: Method, userName: string, paid: boolean) {
  return {
    planTitle: plan.title,
    company: plan.company,
    preparedAt: new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
    preparedBy: userName,
    methodLine: paid ? `Подготовлено по методике ${method.name} версия ${method.version}` : `${method.name} версия ${method.version} · ${method.author}`,
    pointA: plan.pointA,
    pointB: plan.pointB,
    paid,
    brand: plan.brand ?? undefined,
  };
}

export async function buildStageModel(plan: Plan, method: Method, stageKey: string, userName: string, paid = false): Promise<DocModel> {
  const stage = findStage(method, stageKey);
  const { parts, sources, outstanding } = await collect(plan, [stage], paid);
  return {
    kind: "stage",
    ...base(plan, method, userName, paid),
    stageNum: stage.num,
    stageTitle: stage.title,
    stageTitleRu: stage.titleRu,
    question: stage.question,
    outstanding,
    sections: parts[0].sections,
    sources,
  };
}

/** Полная стратегия: все этапы, сводка с цифрами, графики и SWOT */
export async function buildFullModel(plan: Plan, method: Method, userName: string, paid = false): Promise<DocModel> {
  const { parts, sources, outstanding, items } = await collect(plan, method.stages, paid);
  return {
    kind: "full",
    ...base(plan, method, userName, paid),
    stageNum: "",
    stageTitle: "Стратегия",
    stageTitleRu: "Полный план A → B",
    question: "Где бизнес сейчас, куда идёт и как туда попасть",
    outstanding,
    sections: [],
    parts,
    sources,
    dashboard: await buildDashboard(plan, items),
  };
}

/** Для сводки берём только то, что решил или проверил человек */
const settled = (it: Item) => it.reviewStatus !== "unreviewed";
const s = (v: unknown) => String(v ?? "").trim();

async function buildDashboard(plan: Plan, all: Item[]): Promise<Dashboard> {
  const ok = all.filter(settled);
  const of = (key: string) => ok.filter((i) => i.sectionKey === key);
  const first = (key: string) => of(key)[0]?.values;

  const kpis: Kpi[] = of("goals").map((g) => ({
    goal: s(g.values.goal),
    metric: s(g.values.metric),
    unit: s(g.values.unit),
    current: parseNum(g.values.current),
    target: parseNum(g.values.target),
    currentText: s(g.values.current),
    targetText: s(g.values.target),
    deadline: s(g.values.deadline),
  }));
  const goalIds = of("goals").map((g) => g.id);
  if (goalIds.length) {
    const facts = await db.select().from(schema.goalCheckins).where(inArray(schema.goalCheckins.itemId, goalIds)).orderBy(schema.goalCheckins.periodDate);
    of("goals").forEach((g, i) => {
      const f = facts.filter((x) => x.itemId === g.id).map((x) => ({ date: x.periodDate, value: parseNum(x.value) })).filter((x): x is { date: string; value: number } => x.value != null);
      if (f.length) kpis[i].facts = f;
    });
  }

  const name = (it: Item) => s(it.values.name) || s(it.values.statement) || s(it.values.what);
  const swot = {
    strengths: of("company").filter((i) => i.values.kind === "strength").map(name),
    weaknesses: of("company").filter((i) => i.values.kind === "weakness").map(name),
    opportunities: of("market").filter((i) => i.values.impact === "opportunity").map(name),
    threats: of("market").filter((i) => i.values.impact === "threat").map(name),
  };

  const timeline: TimelineRow[] = [];
  const push = (label: string, date: unknown, kind: TimelineRow["kind"], owner?: string) => {
    const d = parseDate(date);
    if (d && label) timeline.push({ label, date: isoDay(d), kind, owner: owner || undefined });
  };
  of("action_plan").forEach((i) => push(s(i.values.what), i.values.deadline, "action", s(i.values.owner_name) || ROLES.find((r) => r.value === i.values.owner)?.label || s(i.values.owner)));
  of("launch").forEach((i) => push(s(i.values.what), i.values.date, "launch"));
  of("checkpoints").forEach((i) => push(s(i.values.what).split("\n")[0].slice(0, 80), i.values.date, "checkpoint"));
  of("goals").forEach((i) => push(s(i.values.goal), i.values.deadline, "goal"));
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const horizon = s(first("horizon")?.period);
  const span = datesIn(horizon);
  let range: Dashboard["range"];
  const all_ = [...span.map(isoDay), ...timeline.map((t) => t.date)].sort();
  if (all_.length) range = { from: span[0] ? isoDay(span[0]) : all_[0], to: span[1] ? isoDay(span[1]) : all_[all_.length - 1] };
  if (range && range.from === range.to) {
    const d = new Date(range.to);
    d.setUTCMonth(d.getUTCMonth() + 1);
    range.to = isoDay(d);
  }

  let funnel: Dashboard["funnel"];
  const gm = first("goal_math");
  const calc = gm ? calcGoal(gm) : null;
  if (gm && calc) {
    const steps = [
      ...(calc.trafficMonth ? [{ label: "Обращения или визиты", month: calc.trafficMonth, day: calc.trafficDay! }] : []),
      { label: "Заявки", month: calc.leadsMonth, day: calc.leadsDay },
      { label: "Продажи", month: calc.salesMonth, day: calc.salesDay },
    ];
    const VERD: Record<string, string> = { realistic: "Реально", stretch: "Напряжённо", unrealistic: "Нереально без изменений", unknown: "Не с чем сравнить" };
    funnel = { revenue: parseNum(gm.revenue_target) ?? 0, currency: s(gm.currency), months: calc.months, verdict: calc.verdict, verdictText: VERD[calc.verdict], steps };
  }

  const seg = of("segments").sort((a, b) => s(a.values.priority).localeCompare(s(b.values.priority)))[0];
  const budget = first("budget");
  return {
    positioning: s(first("positioning")?.statement) || undefined,
    segment: seg ? s(seg.values.name) : undefined,
    horizon: horizon || undefined,
    budget: budget ? { total: s(budget.total), split: s(budget.split) } : undefined,
    kpis,
    swot,
    timeline,
    range,
    funnel,
  };
}

/** Части документа: у старых документов этапа глав нет, есть только sections */
export function docParts(m: DocModel): DocPart[] {
  return m.parts ?? [{ num: m.stageNum, title: m.stageTitle, titleRu: m.stageTitleRu, question: m.question, sections: m.sections }];
}
