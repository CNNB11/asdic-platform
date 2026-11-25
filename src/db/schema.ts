import { boolean, customType, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const id = () => text("id").primaryKey();
const ts = (n: string) => timestamp(n, { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Тариф: free | pro | team | consultant (см. src/lib/billing/tiers.ts) */
  tier: text("tier").notNull().default("free"),
  /** Кредиты тарифа: обновляются раз в месяц до нормы тарифа, не копятся */
  creditsPlan: integer("credits_plan").notNull().default(0),
  /** Купленные пакеты и стартовые кредиты: не сгорают. Может уйти в минус на последней операции */
  creditsExtra: integer("credits_extra").notNull().default(30),
  /** Когда в следующий раз пополнить кредиты тарифа */
  creditsResetAt: timestamp("credits_reset_at", { withTimezone: true }),
  paddleCustomerId: text("paddle_customer_id"),
  paddleSubscriptionId: text("paddle_subscription_id"),
  /** Статус подписки в Paddle: active | trialing | past_due | paused | canceled */
  subscriptionStatus: text("subscription_status"),
  /** Год или месяц: year | month */
  billingInterval: text("billing_interval"),
  createdAt: ts("created_at"),
});

/** Движение кредитов. ref уникален: повтор вебхука или журнала не спишет и не начислит дважды */
export const creditLedger = pgTable("credit_ledger", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Плюс начисление, минус списание */
  delta: integer("delta").notNull(),
  /** ai | subscription | pack | signup | admin | refill */
  reason: text("reason").notNull(),
  ref: text("ref").unique(),
  note: text("note").notNull().default(""),
  costUsd: text("cost_usd"),
  createdAt: ts("created_at"),
});

/** Настройки приложения, которые админ задаёт из интерфейса (например, секрет вебхука Paddle) */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at"),
});

export const plans = pgTable("plans", {
  id: id(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  methodKey: text("method_key").notNull(),
  methodVersion: text("method_version").notNull(),
  title: text("title").notNull(),
  company: text("company").notNull().default(""),
  pointA: text("point_a").notNull().default(""),
  pointB: text("point_b").notNull().default(""),
  language: text("language").notNull().default("ru"),
  /** Оформление выгрузки: логотип, данные на обложке, цвет, гриф NDA */
  brand: jsonb("brand").$type<PlanBrand>(),
  /** Контроль: окно сверок после закрытия Strategy */
  control: jsonb("control").$type<PlanControl>(),
  /** Команда: какие роли есть, каких нет и как закрыть */
  team: jsonb("team").$type<TeamRole[]>(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export interface PlanBrand {
  /** Ключ файла логотипа в таблице files */
  logoKey?: string;
  logoMime?: string;
  /** Название компании на обложке (если пусто, берётся название плана) */
  companyName?: string;
  /** Для кого подготовлено: инвестор, совет директоров, партнёр */
  preparedFor?: string;
  /** Контакты на последней странице */
  contact?: string;
  /** Цвет акцента документа, HEX */
  accent?: string;
  /** Гриф «Конфиденциально» на каждой странице (платные тарифы) */
  confidential?: boolean;
  /** Текст уведомления о конфиденциальности */
  ndaText?: string;
}

export interface PlanControl {
  /** week | month | quarter */
  window: "week" | "month" | "quarter";
  /** С какой даты считаются сверки, ГГГГ-ММ-ДД */
  startAt: string;
  enabledBy: string;
}

export interface TeamRole {
  key: string;
  label: string;
  /** have — есть в команде, partial — частично (совмещает), missing — нет */
  status: "have" | "partial" | "missing";
  name?: string;
  /** Как закрыть роль, если её нет: hire | freelance | agency | train | owner */
  cover?: string;
}

/** origin: manual | ai_sources | ai_web | ai_improve
 *  reviewStatus: unreviewed | approved (жёлтые/зелёные) ; signed (красные решения) */
export const items = pgTable("items", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  values: jsonb("values").$type<Record<string, unknown>>().notNull(),
  origin: text("origin").notNull(),
  reviewStatus: text("review_status").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  /** Для красных решений: какие варианты рассматривались */
  decision: jsonb("decision").$type<DecisionInfo | null>(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export interface DecisionInfo {
  options: { title: string; values: Record<string, unknown>; pros: string; cons: string; risks: string }[];
  chosenIndex: number | null; // null = свой вариант
  methodVersion: string;
  /** Красные решения подтверждает второй человек (в маленькой команде — заказчик) */
  confirmedBy?: string;
}

export const itemRevisions = pgTable("item_revisions", {
  id: id(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  values: jsonb("values").$type<Record<string, unknown>>().notNull(),
  actor: text("actor").notNull(), // user id или "ai"
  savedBy: text("saved_by").notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at"),
});

/** kind: file | url | note ; status: ready | rejected */
export const sources = pgTable("sources", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  storageKey: text("storage_key"),
  mime: text("mime"),
  size: integer("size"),
  text: text("text").notNull().default(""),
  summary: text("summary").notNull().default(""),
  status: text("status").notNull(),
  error: text("error"),
  addedBy: text("added_by").notNull(),
  createdAt: ts("created_at"),
});

export const citations = pgTable("citations", {
  id: id(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  quote: text("quote").notNull(),
  verified: boolean("verified").notNull(),
  createdAt: ts("created_at"),
});

/** kind: draft_sources | draft_web | improve_sources | improve_web | critique | options
 *  status: running | ready | applied | discarded | failed */
export const aiOps = pgTable("ai_ops", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  sectionKey: text("section_key").notNull(),
  itemId: text("item_id"),
  guidance: text("guidance").notNull().default(""),
  scope: text("scope").notNull().default("plan"),
  status: text("status").notNull(),
  /** Итог для человека: сколько принято из предложенного, отредактировано ли потом */
  outcome: text("outcome"),
  result: jsonb("result").$type<unknown>(),
  error: text("error"),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const documents = pgTable("documents", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  stageKey: text("stage_key").notNull(),
  version: integer("version").notNull(),
  markdown: text("markdown").notNull(),
  model: jsonb("model").$type<unknown>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at"),
});

/** Факт по цели на дату сверки Контроля. Одна запись на цель и дату. */
export const goalCheckins = pgTable(
  "goal_checkins",
  {
    id: id(),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    /** Дата сверки, ГГГГ-ММ-ДД */
    periodDate: text("period_date").notNull(),
    value: text("value").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => [uniqueIndex("goal_checkins_item_period").on(t.itemId, t.periodDate)],
);

/** Переход к следующему этапу делает человек */
export const stageClosures = pgTable("stage_closures", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  stageKey: text("stage_key").notNull(),
  closedBy: text("closed_by").notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at"),
});

/** Журнал каждого вызова Claude: модель, токены, стоимость, длительность, ошибка. Замена LangSmith для MVP. */
export const aiCalls = pgTable("ai_calls", {
  id: id(),
  planId: text("plan_id"),
  opId: text("op_id"),
  userId: text("user_id"),
  kind: text("kind").notNull(), // draft_sources, improve_web, research, source_summary...
  step: text("step").notNull(), // structured | research
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  webSearches: integer("web_searches").notNull().default(0),
  costUsd: text("cost_usd").notNull().default("0"),
  durationMs: integer("duration_ms").notNull(),
  stopReason: text("stop_reason"),
  error: text("error"),
  /** Сокращённый вход и выход для отладки (без полного текста источников) */
  requestPreview: text("request_preview").notNull().default(""),
  responsePreview: text("response_preview").notNull().default(""),
  createdAt: ts("created_at"),
});

/** Изображения, сгенерированные по записи-концепции. verdict: new | accepted | base | rejected */
export const visuals = pgTable("visuals", {
  id: id(),
  planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  /** Промпт ровно в том виде, в каком ушёл провайдеру */
  prompt: text("prompt").notNull(),
  aspect: text("aspect").notNull().default("1:1"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  costUsd: text("cost_usd").notNull().default("0"),
  /** Из какого визуала сделана точечная правка */
  parentId: text("parent_id"),
  /** Пояснение автора макета (Claude): идея и опора на записи плана */
  notes: text("notes").notNull().default(""),
  /** Структурные данные борда: палитры и шрифты, из которых человек выбирает */
  meta: jsonb("meta").$type<VisualMeta>(),
  verdict: text("verdict").notNull().default("new"),
  verdictBy: text("verdict_by"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at"),
});

export interface VisualPalette {
  name: string;
  kind: "brand" | "trend" | "counter";
  recommended?: boolean;
  why: string;
  colors: { hex: string; role: string; name?: string }[];
}
export interface VisualMeta {
  palettes?: VisualPalette[];
  fonts?: { family: string; role: string; why: string }[];
}

/** Файлы (загрузки и визуалы) храним в базе: диск на хостинге стирается при перезапуске */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at"),
});
