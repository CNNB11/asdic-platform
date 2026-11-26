import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PlanBrand } from "@/db/schema";
import { displayValue, findStage, itemTitle, type Method, type Stage } from "@/method";
import { sectionStatus } from "@/lib/progress";
import { MODE_LABEL } from "@/components/ui";
import { datesIn, isoDay, parseDate, parseNum } from "@/lib/num";
import { calcChannel, calcGoal, calcScenario, calcUnit } from "@/lib/goalMath";
import { fmtNum } from "@/lib/num";
import type { Digest } from "./digest";
import { ROLES } from "@/method/asdic";
import { themeOf, type ThemeKey } from "./themes";

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
  /** Блоки глубокой стратегии: есть только там, где заполнены соответствующие уровни */
  deep?: DeepBlocks;
}

export interface DeepBlocks {
  unit?: { name: string; verdict: string; verdictText: string; cards: { value: string; label: string }[] };
  channels?: { currency: string; rows: { channel: string; budget: number; leads: number; sales: number | null }[] };
  scenarios?: { base: number; rows: { name: string; leadsDay: number; comment: string }[] };
  content?: { week: string; topic: string; channel: string; format: string; cta: string }[];
  benchmarks?: { metric: string; niche: string; ours: string }[];
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
  /** Оформление на момент сборки: тема, акцент и шрифты (из фирменного стиля, своего цвета или темы) */
  style?: DocStyle;
}

export interface DocStyle {
  theme: ThemeKey;
  accent: string;
  head: string;
  body: string;
  /** brand — из утверждённого фирменного стиля плана */
  source: "brand" | "theme";
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

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Тема из настроек; цвета и шрифты берём из утверждённого бренд-борда, если человек это разрешил */
export async function resolveStyle(plan: Plan): Promise<DocStyle> {
  const b = plan.brand ?? {};
  const t = themeOf(b.theme);
  const style: DocStyle = { theme: t.key, accent: t.accent, head: t.head, body: t.body, source: "theme" };
  if (b.autoStyle !== false) {
    const boards = await db
      .select({ meta: schema.visuals.meta, verdict: schema.visuals.verdict, at: schema.visuals.createdAt })
      .from(schema.visuals)
      .where(and(eq(schema.visuals.planId, plan.id), inArray(schema.visuals.verdict, ["accepted", "base"])));
    const board = boards
      .filter((v) => v.meta?.palettes?.length || v.meta?.fonts?.length)
      .sort((x, y) => (x.verdict === "base" ? -1 : 0) - (y.verdict === "base" ? -1 : 0) || +y.at - +x.at)[0]?.meta;
    if (board) {
      const pal = board.palettes?.find((p) => p.recommended) ?? board.palettes?.find((p) => p.kind === "brand") ?? board.palettes?.[0];
      const colors = (pal?.colors ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex));
      const usable = colors.filter((c) => lum(c.hex) > 0.03 && lum(c.hex) < 0.6);
      const acc = usable.find((c) => /акцент|accent|основн|primary|бренд/i.test(c.role)) ?? usable[0];
      if (acc) style.accent = acc.hex;
      const head = board.fonts?.find((f) => /заголов|head|display|логот/i.test(f.role))?.family ?? board.fonts?.[0]?.family;
      const body = board.fonts?.find((f) => /текст|body|основн|наборн/i.test(f.role))?.family ?? board.fonts?.[1]?.family ?? head;
      if (head) style.head = head;
      if (body) style.body = body;
      if (acc || head) style.source = "brand";
    }
  }
  // #141414 старая форма сохраняла всегда, это не выбор человека
  if (b.accent && /^#[0-9a-f]{6}$/i.test(b.accent) && b.accent.toLowerCase() !== "#141414") style.accent = b.accent;
  return style;
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
    style: await resolveStyle(plan),
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
    style: await resolveStyle(plan),
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

  const deep: DeepBlocks = {};
  const r1 = (n: number) => fmtNum(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  const ue = of("unit_economics")[0];
  const u = ue ? calcUnit(ue.values) : null;
  if (ue && u) {
    const cur = s(ue.values.currency);
    const money = (n: number) => `${n >= 1e6 ? fmtNum(Math.round(n / 1e5) / 10) + " млн" : n >= 1e4 ? fmtNum(Math.round(n / 100) / 10) + " тыс." : r1(n)}${cur ? " " + cur : ""}`;
    const VERD: Record<string, string> = { healthy: "Здоровая экономика", thin: "На грани", loss: "Убыточно" };
    deep.unit = {
      name: s(ue.values.name),
      verdict: u.verdict,
      verdictText: VERD[u.verdict],
      cards: [
        { value: money(u.ltv), label: "LTV, ценность клиента" },
        { value: Number.isFinite(u.ratio) ? `${r1(u.ratio)}×` : "∞", label: "LTV / CAC" },
        { value: Number.isFinite(u.paybackMonths) ? `${r1(u.paybackMonths)} мес.` : "нет", label: "Окупаемость привлечения" },
        ...(u.breakeven != null ? [{ value: r1(u.breakeven), label: "Продаж в месяц до безубыточности" }] : []),
      ],
    };
  }
  const ch = of("channel_budget")
    .map((i) => ({ i, c: calcChannel(i.values) }))
    .filter((x): x is { i: Item; c: NonNullable<ReturnType<typeof calcChannel>> } => !!x.c);
  if (ch.length)
    deep.channels = {
      currency: s(ch[0].i.values.currency),
      rows: ch.map(({ i, c }) => ({ channel: s(i.values.channel), budget: parseNum(i.values.budget_month) ?? 0, leads: c.leads, sales: c.sales })).sort((a, b) => b.leads - a.leads),
    };
  const gmBase = of("goal_math").find((i) => i.reviewStatus === "signed")?.values ?? first("goal_math");
  const sc = of("scenarios")
    .map((i) => ({ i, c: calcScenario(i.values, gmBase) }))
    .filter((x): x is { i: Item; c: NonNullable<ReturnType<typeof calcScenario>> } => !!x.c);
  if (sc.length) deep.scenarios = { base: sc[0].c.baseLeadsDay, rows: sc.map(({ i, c }) => ({ name: s(i.values.name), leadsDay: c.leadsDay, comment: s(i.values.comment) })) };
  const FORMAT: Record<string, string> = { post: "Пост", article: "Статья", video: "Видео", short: "Короткое видео", case: "Кейс", email: "Письмо", webinar: "Вебинар" };
  const cp = of("content_plan").sort((a, b) => (parseNum(a.values.week) ?? 0) - (parseNum(b.values.week) ?? 0));
  if (cp.length) deep.content = cp.map((i) => ({ week: s(i.values.week), topic: s(i.values.topic), channel: s(i.values.channel), format: FORMAT[s(i.values.format)] ?? s(i.values.format), cta: s(i.values.cta) }));
  const bm = of("benchmarks");
  if (bm.length) deep.benchmarks = bm.map((i) => ({ metric: s(i.values.metric), niche: s(i.values.niche_value), ours: s(i.values.our_value) }));

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
    deep: Object.keys(deep).length ? deep : undefined,
  };
}

/** Части документа: у старых документов этапа глав нет, есть только sections */
export function docParts(m: DocModel): DocPart[] {
  return m.parts ?? [{ num: m.stageNum, title: m.stageTitle, titleRu: m.stageTitleRu, question: m.question, sections: m.sections }];
}
