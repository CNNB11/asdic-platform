/**
 * Тарифы и цены. Меняйте цифры здесь: страница тарифов, лимиты и товары в Paddle берут их отсюда.
 * Цена ИИ-операции для клиента = реальная себестоимость × MARKUP, в кредитах по CREDIT_USD.
 */
export const CREDIT_USD = 0.1;
export const MARKUP = 3.5;
/** Стартовые кредиты при регистрации (тариф Free) */
export const SIGNUP_CREDITS = 30;

export type TierKey = "free" | "pro" | "team" | "consultant";

export interface Tier {
  key: TierKey;
  name: string;
  /** $ в месяц; за год платят 10 месяцев */
  priceMonth: number;
  credits: number;
  /** null = без ограничения */
  maxPlans: number | null;
  blurb: string;
  features: string[];
}

export const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    priceMonth: 0,
    credits: 0,
    maxPlans: 1,
    blurb: "Попробовать на одном плане",
    features: [`${SIGNUP_CREDITS} кредитов один раз`, "1 план", "Все этапы метода и выгрузка документов"],
  },
  {
    key: "pro",
    name: "Pro",
    priceMonth: 49,
    credits: 400,
    maxPlans: 5,
    blurb: "Для собственника или маркетолога",
    features: ["400 кредитов в месяц", "До 5 планов", "Поиск в интернете, визуалы, бренд-борды"],
  },
  {
    key: "team",
    name: "Команда",
    priceMonth: 149,
    credits: 1500,
    maxPlans: null,
    blurb: "Для отдела маркетинга",
    features: ["1 500 кредитов в месяц", "Планы без ограничений", "Всё из Pro"],
  },
  {
    key: "consultant",
    name: "Консультант",
    priceMonth: 249,
    credits: 3000,
    maxPlans: null,
    blurb: "Для агентств и консультантов с клиентами",
    features: ["3 000 кредитов в месяц", "Планы клиентов без ограничений", "Всё из Команды"],
  },
];

export const tierOf = (key: string | null | undefined) => TIERS.find((t) => t.key === key) ?? TIERS[0];

export interface Pack {
  key: "pack_100" | "pack_500";
  credits: number;
  price: number;
}
export const PACKS: Pack[] = [
  { key: "pack_100", credits: 100, price: 12 },
  { key: "pack_500", credits: 500, price: 50 },
];

/** Ключ товара в Paddle (custom_data.asdic у цены) */
export type PriceKey = `${Exclude<TierKey, "free">}_${"month" | "year"}` | Pack["key"];

/** Сколько кредитов списать за вызов с реальной себестоимостью cost ($). Любой платный вызов стоит хотя бы 1 кредит. */
export const creditsFor = (costUsd: number) => (costUsd > 0 ? Math.max(1, Math.ceil((costUsd * MARKUP) / CREDIT_USD - 1e-9)) : 0);

/**
 * Оценка цены операции до запуска, в кредитах. Опирается на средние реальные вызовы из журнала ИИ
 * (ноябрь 2026); фактически списывается по точной себестоимости после вызова.
 */
const ESTIMATES: Record<string, number> = {
  draft_web: creditsFor(0.77),
  options_web: creditsFor(0.77),
  improve_web: creditsFor(0.6),
  draft_sources: creditsFor(0.16),
  options: creditsFor(0.16),
  improve_sources: creditsFor(0.12),
  critique: creditsFor(0.1),
  image: creditsFor(0.65),
  image_trends: creditsFor(0.46),
  image_edit: creditsFor(0.16),
  source_summary: 1,
};
/** Ключ оценки для черновика уровня */
export const draftKind = (red: boolean, web: boolean) => (red ? (web ? "options_web" : "options") : web ? "draft_web" : "draft_sources");

export const estimate = (kind: string) => ESTIMATES[kind] ?? creditsFor(0.16);

export const fmtCredits = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "кредит", "кредита", "кредитов")}`;
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
