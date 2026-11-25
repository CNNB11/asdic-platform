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
    credits: 1000,
    maxPlans: 5,
    blurb: "Для собственника или маркетолога",
    features: ["1 000 кредитов в месяц (≈ 3–4 полных плана)", "До 5 планов", "Поиск в интернете, визуалы, бренд-борды"],
  },
  {
    key: "team",
    name: "Команда",
    priceMonth: 149,
    credits: 3500,
    maxPlans: null,
    blurb: "Для отдела маркетинга",
    features: ["3 500 кредитов в месяц", "Планы без ограничений", "Всё из Pro"],
  },
  {
    key: "consultant",
    name: "Консультант",
    priceMonth: 249,
    credits: 6000,
    maxPlans: null,
    blurb: "Для агентств и консультантов с клиентами",
    features: ["6 000 кредитов в месяц", "Планы клиентов без ограничений", "Всё из Команды"],
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
 * Фиксированные цены операций в кредитах. Не зависят от себестоимости: когда ИИ дешевеет, цена для клиента
 * остаётся прежней. Посчитаны в ноябре 2026 как себестоимость × MARKUP по тогдашним ценам.
 * Защита: если отдельная операция вышла необычно дорогой (огромные документы), спишется её себестоимость × MARKUP.
 */
const PRICES: Record<string, number> = {
  draft_web: 27,
  options_web: 27,
  improve_web: 21,
  draft_sources: 6,
  options: 6,
  improve_sources: 5,
  critique: 4,
  image: 23,
  image_trends: 17,
  image_edit: 6,
  source_summary: 1,
  doc_digest: 2,
};
/** Ключ цены для черновика уровня */
export const draftKind = (red: boolean, web: boolean) => (red ? (web ? "options_web" : "options") : web ? "draft_web" : "draft_sources");

export const estimate = (kind: string) => PRICES[kind] ?? 6;

/** Сколько списать за операцию: фиксированная цена, но не меньше себестоимости × MARKUP */
export const chargeFor = (kind: string, costUsd: number) => Math.max(estimate(kind), creditsFor(costUsd));

/**
 * Во сколько кредитов обходится план целиком: по одному черновику на каждый уровень метода.
 * min: всё по загруженным источникам и один макет визуала.
 * typical: анализ (первый этап) с поиском в интернете, остальное по источникам, бренд-борд с трендами.
 */
export function planCost(method: { stages: { sections: { mode: string; visuals?: unknown }[] }[] }) {
  let min = 0;
  let typical = 0;
  method.stages.forEach((st, i) =>
    st.sections.forEach((s) => {
      if (s.visuals) {
        min += estimate("image");
        typical += estimate("image") + estimate("image_trends");
        return;
      }
      const red = s.mode === "red";
      min += estimate(draftKind(red, false));
      typical += estimate(draftKind(red, i === 0));
    }),
  );
  return { min, typical };
}

export const fmtCredits = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "кредит", "кредита", "кредитов")}`;
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
