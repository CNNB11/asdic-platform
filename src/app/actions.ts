"use server";

import bcrypt from "bcryptjs";
import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/access";
import { newId } from "@/lib/ids";
import { extractText, storeFile, validateFile } from "@/lib/sources";
import { runCritique, runDraft, runImprove, summarizeSource, type DraftResult, type ImproveResult, type OptionsResult, type Scope } from "@/lib/ai/ops";
import { buildStageMarkdown } from "@/lib/export/markdown";
import { withCallCtx } from "@/lib/ai/telemetry";
import { displayValue, findSection, type Section } from "@/method";
import { ASDIC } from "@/method/asdic";

export type FormState = { error?: string } | undefined;

// ---------- вход ----------

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email.includes("@") || !name) return { error: "Укажите имя и почту" };
  if (password.length < 8) return { error: "Пароль не короче 8 символов" };
  const invite = process.env.SIGNUP_CODE;
  if (invite && String(fd.get("code") ?? "") !== invite) return { error: "Неверный код приглашения" };
  const [exists] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (exists) return { error: "Такая почта уже зарегистрирована" };
  const id = newId();
  await db.insert(schema.users).values({ id, email, name, passwordHash: await bcrypt.hash(password, 10) });
  await createSession(id);
  redirect("/plans");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) return { error: "Неверная почта или пароль" };
  await createSession(u.id);
  redirect("/plans");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// ---------- планы ----------

export async function createPlan(fd: FormData) {
  const user = await requireUser();
  const title = String(fd.get("title") ?? "").trim() || "Новый план";
  const id = newId();
  await db.insert(schema.plans).values({
    id,
    ownerId: user.id,
    methodKey: ASDIC.key,
    methodVersion: ASDIC.version,
    title,
    company: String(fd.get("company") ?? "").trim(),
    pointA: String(fd.get("pointA") ?? "").trim(),
    pointB: String(fd.get("pointB") ?? "").trim(),
  });
  redirect(`/plans/${id}`);
}

export async function updatePlan(planId: string, fd: FormData) {
  await requirePlan(planId);
  await db
    .update(schema.plans)
    .set({
      title: String(fd.get("title") ?? "").trim() || "План",
      company: String(fd.get("company") ?? "").trim(),
      pointA: String(fd.get("pointA") ?? "").trim(),
      pointB: String(fd.get("pointB") ?? "").trim(),
      updatedAt: new Date(),
    })
    .where(eq(schema.plans.id, planId));
  revalidatePath(`/plans/${planId}`);
}

// ---------- записи ----------

function readValues(section: Section, fd: FormData, prefix = "f_") {
  const values: Record<string, unknown> = {};
  for (const f of section.fields) {
    const raw = fd.get(`${prefix}${f.key}`);
    if (f.type === "bool") values[f.key] = raw === "on" || raw === "true";
    else values[f.key] = String(raw ?? "").trim();
  }
  return values;
}

function missingRequired(section: Section, values: Record<string, unknown>) {
  return section.fields.filter((f) => f.required && f.type !== "bool" && !String(values[f.key] ?? "").trim()).map((f) => f.label);
}

/** Поле «только одна запись с true»: снимаем отметку у остальных записей уровня */
async function enforceUnique(planId: string, section: Section, keepId: string, values: Record<string, unknown>) {
  for (const f of section.fields.filter((x) => x.uniqueTrue)) {
    if (values[f.key] !== true) continue;
    const others = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.planId, planId), eq(schema.items.sectionKey, section.key)));
    for (const o of others) {
      if (o.id !== keepId && o.values[f.key] === true) {
        await db.update(schema.items).set({ values: { ...o.values, [f.key]: false } }).where(eq(schema.items.id, o.id));
      }
    }
  }
}

/** Сохранение записи человеком. Жёлтые и зелёные записи считаются проверенными, красные — подписанными. */
export async function saveItem(planId: string, sectionKey: string, itemId: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const { user, plan, method } = await requirePlan(planId);
  const { section } = findSection(method, sectionKey);
  const values = readValues(section, fd);
  const missing = missingRequired(section, values);
  if (missing.length) return { error: `Заполните: ${missing.join(", ")}` };
  const now = new Date();
  const red = section.mode === "red";
  let decision = null as typeof schema.items.$inferSelect.decision;
  const opId = String(fd.get("op") ?? "");
  const optIdx = fd.get("opt");
  if (red && opId) {
    const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
    const r = op?.result as OptionsResult | undefined;
    if (r) decision = { options: r.options.map((o) => ({ title: o.title, values: o.values, pros: o.pros, cons: o.cons, risks: o.risks })), chosenIndex: optIdx === null || optIdx === "" ? null : Number(optIdx), methodVersion: plan.methodVersion };
    if (op) await db.update(schema.aiOps).set({ status: "applied", outcome: optIdx === null || optIdx === "" ? "Человек записал свой вариант" : `Выбран вариант ${Number(optIdx) + 1}`, updatedAt: now }).where(eq(schema.aiOps.id, op.id));
  }
  const confirmedBy = String(fd.get("confirmedBy") ?? "").trim();
  if (red) {
    decision = decision ?? { options: [], chosenIndex: null, methodVersion: plan.methodVersion };
    if (confirmedBy) decision.confirmedBy = confirmedBy;
  }
  let id = itemId;
  if (id) {
    const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, id), eq(schema.items.planId, planId)));
    if (!it) return { error: "Запись не найдена" };
    await db
      .update(schema.items)
      .set({
        values,
        reviewStatus: red ? "signed" : "approved",
        reviewedBy: user.name,
        reviewedAt: now,
        updatedBy: user.id,
        updatedAt: now,
        ...(red ? { decision: { ...(it.decision ?? {}), ...decision!, options: decision!.options.length ? decision!.options : it.decision?.options ?? [], chosenIndex: decision!.options.length ? decision!.chosenIndex : it.decision?.chosenIndex ?? null } } : {}),
      })
      .where(eq(schema.items.id, id));
  } else {
    id = newId();
    await db.insert(schema.items).values({
      id,
      planId,
      sectionKey,
      values,
      origin: opId ? "ai_options" : "manual",
      reviewStatus: red ? "signed" : "approved",
      reviewedBy: user.name,
      reviewedAt: now,
      decision,
      createdBy: user.id,
      updatedBy: user.id,
    });
    if (opId) {
      const [op] = await db.select().from(schema.aiOps).where(eq(schema.aiOps.id, opId));
      const r = op?.result as OptionsResult | undefined;
      const ev = r && optIdx !== null && optIdx !== "" ? r.options[Number(optIdx)]?.evidence ?? [] : [];
      for (const e of ev) {
        await db.insert(schema.citations).values({ id: newId(), itemId: id, fieldKey: e.field ?? "", sourceId: e.sourceId, quote: e.quote, verified: true });
      }
    }
  }
  await db.insert(schema.itemRevisions).values({ id: newId(), itemId: id, values, actor: user.id, savedBy: user.name, note: red ? "Решение подписано" : "Сохранено человеком" });
  await enforceUnique(planId, section, id, values);
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(`/plans/${planId}/items/${id}`);
}

export async function approveItem(planId: string, itemId: string) {
  const { user, method } = await requirePlan(planId);
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!it) return;
  const red = findSection(method, it.sectionKey).section.mode === "red";
  if (red && !String(it.values.rationale ?? "").trim()) return;
  await db
    .update(schema.items)
    .set({ reviewStatus: red ? "signed" : "approved", reviewedBy: user.name, reviewedAt: new Date() })
    .where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId), eq(schema.items.reviewStatus, "unreviewed")));
  revalidatePath(`/plans/${planId}`, "layout");
}

export async function deleteItem(planId: string, itemId: string) {
  const { method } = await requirePlan(planId);
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!it) return;
  await db.delete(schema.items).where(eq(schema.items.id, itemId));
  const { stage } = findSection(method, it.sectionKey);
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(`/plans/${planId}/${stage.key}`);
}

// ---------- источники ----------

export async function uploadSources(planId: string, _: FormState, fd: FormData): Promise<FormState> {
  const { user } = await requirePlan(planId);
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Выберите файлы" };
  const errors: string[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    try {
      const { ext, mime } = validateFile(file.name, bytes);
      const text = await extractText(ext, bytes);
      if (!text.trim()) throw new Error("В файле не найден текст (возможно, это скан). Распознавание сканов появится позже");
      const key = await storeFile(bytes, ext);
      let summary = "";
      try {
        summary = await withCallCtx({ planId, userId: user.id, kind: "source_summary" }, () => summarizeSource(file.name, text));
      } catch {
        summary = "";
      }
      await db.insert(schema.sources).values({ id: newId(), planId, kind: "file", title: file.name, storageKey: key, mime, size: bytes.length, text, summary, status: "ready", addedBy: user.id });
    } catch (e) {
      errors.push(`${file.name}: ${(e as Error).message}`);
    }
  }
  revalidatePath(`/plans/${planId}`, "layout");
  return errors.length ? { error: errors.join("; ") } : undefined;
}

export async function addNote(planId: string, _: FormState, fd: FormData): Promise<FormState> {
  const { user } = await requirePlan(planId);
  const title = String(fd.get("title") ?? "").trim();
  const text = String(fd.get("text") ?? "").trim();
  const url = String(fd.get("url") ?? "").trim();
  if (!title || !text) return { error: "Укажите название и текст заметки" };
  if (url && !/^https?:\/\//.test(url)) return { error: "Ссылка должна начинаться с http:// или https://" };
  await db.insert(schema.sources).values({ id: newId(), planId, kind: url ? "url" : "note", title, url: url || null, text, summary: "", status: "ready", addedBy: user.id });
  revalidatePath(`/plans/${planId}`, "layout");
}

export async function deleteSource(planId: string, sourceId: string) {
  await requirePlan(planId);
  await db.delete(schema.sources).where(and(eq(schema.sources.id, sourceId), eq(schema.sources.planId, planId)));
  revalidatePath(`/plans/${planId}`, "layout");
}

// ---------- ИИ ----------

function scopeOf(fd: FormData): Scope {
  const s = String(fd.get("scope") ?? "plan");
  return s === "stage" || s === "none" ? s : "plan";
}

export async function startDraft(planId: string, sectionKey: string, web: boolean, fd: FormData) {
  const { user, plan, method } = await requirePlan(planId);
  const opId = await runDraft({ plan, method, sectionKey, web, guidance: String(fd.get("guidance") ?? ""), scope: scopeOf(fd), userId: user.id });
  redirect(`/plans/${planId}/ops/${opId}`);
}

export async function startImprove(planId: string, itemId: string, web: boolean, fd: FormData) {
  const { user, plan, method } = await requirePlan(planId);
  const [item] = await db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!item) redirect(`/plans/${planId}`);
  const opId = await runImprove({ plan, method, item, web, guidance: String(fd.get("guidance") ?? ""), scope: scopeOf(fd), userId: user.id });
  redirect(`/plans/${planId}/ops/${opId}`);
}

export async function startCritique(planId: string, itemId: string) {
  const { user, plan, method } = await requirePlan(planId);
  const [item] = await db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!item) redirect(`/plans/${planId}`);
  const opId = await runCritique({ plan, method, item, userId: user.id });
  redirect(`/plans/${planId}/ops/${opId}`);
}

async function loadOp(planId: string, opId: string) {
  const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
  if (!op || op.status !== "ready") throw new Error("Операция уже применена или недоступна");
  return op;
}

/** Сохранение выбранных черновиков ИИ: записи попадают в план как «не проверено человеком» */
export async function applyDraft(planId: string, opId: string, fd: FormData) {
  const { user, method } = await requirePlan(planId);
  const op = await loadOp(planId, opId);
  const { section, stage } = findSection(method, op.sectionKey);
  const r = op.result as DraftResult;
  const picked = fd.getAll("pick").map(Number).filter((i) => Number.isInteger(i) && r.items[i]);
  const existing = await db.select().from(schema.items).where(and(eq(schema.items.planId, planId), eq(schema.items.sectionKey, section.key)));
  const uniq = section.fields.filter((f) => f.uniqueTrue).map((f) => f.key);
  const taken = new Set(uniq.filter((k) => existing.some((e) => e.values[k] === true)));
  const origin = op.kind === "draft_web" ? "ai_web" : "ai_sources";
  for (const i of picked) {
    const draft = r.items[i];
    // Человек мог поправить поля прямо в ответе ИИ: берём то, что пришло из формы
    const edited = fd.has(`d${i}__edit`) ? readValues(section, fd, `d${i}_`) : null;
    const values = edited ? { ...draft.values, ...edited } : { ...draft.values };
    for (const k of uniq) {
      if (values[k] === true) {
        if (taken.has(k)) values[k] = false;
        else taken.add(k);
      }
    }
    const id = newId();
    await db.insert(schema.items).values({ id, planId, sectionKey: section.key, values, origin, reviewStatus: "unreviewed", createdBy: user.id, updatedBy: user.id });
    await db.insert(schema.itemRevisions).values({ id: newId(), itemId: id, values, actor: "ai", savedBy: user.name, note: "Черновик ИИ сохранён" });
    for (const e of draft.evidence) {
      await db.insert(schema.citations).values({ id: newId(), itemId: id, fieldKey: e.field ?? "", sourceId: e.sourceId, quote: e.quote, verified: true });
    }
  }
  await db.update(schema.aiOps).set({ status: "applied", outcome: `Принято ${picked.length} из ${r.items.length}`, updatedAt: new Date() }).where(eq(schema.aiOps.id, op.id));
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(`/plans/${planId}/${stage.key}?added=${picked.length}`);
}

export async function applyImprove(planId: string, opId: string, fd: FormData) {
  const { user, method } = await requirePlan(planId);
  const op = await loadOp(planId, opId);
  const r = op.result as ImproveResult;
  const [item] = await db.select().from(schema.items).where(and(eq(schema.items.id, op.itemId ?? ""), eq(schema.items.planId, planId)));
  if (!item) redirect(`/plans/${planId}`);
  const picked = new Set(fd.getAll("pick").map(String));
  const chosen = r.changes.filter((c) => picked.has(c.field));
  const values = { ...item.values };
  const { section } = findSection(method, op.sectionKey);
  for (const c of chosen) {
    // Предложение ИИ человек мог поправить прямо в ответе
    const raw = fd.get(`p_${c.field}`);
    const f = section.fields.find((x) => x.key === c.field);
    values[c.field] = !fd.has(`p__${c.field}`) || !f ? c.proposed : f.type === "bool" ? raw === "on" || raw === "true" : String(raw ?? "").trim();
  }
  if (chosen.length) {
    // Содержание поменял ИИ: запись снова требует проверки, а красное решение — новой подписи
    await db
      .update(schema.items)
      .set({ values, reviewStatus: "unreviewed", reviewedBy: null, reviewedAt: null, updatedBy: "ai", updatedAt: new Date() })
      .where(eq(schema.items.id, item.id));
    await db.insert(schema.itemRevisions).values({ id: newId(), itemId: item.id, values, actor: "ai", savedBy: user.name, note: `ИИ: применено улучшений ${chosen.length}` });
    for (const c of chosen) {
      await db.delete(schema.citations).where(and(eq(schema.citations.itemId, item.id), eq(schema.citations.fieldKey, c.field)));
      for (const e of c.evidence) {
        await db.insert(schema.citations).values({ id: newId(), itemId: item.id, fieldKey: c.field, sourceId: e.sourceId, quote: e.quote, verified: true });
      }
    }
  }
  await db.update(schema.aiOps).set({ status: "applied", outcome: `Применено ${chosen.length} из ${r.changes.length}`, updatedAt: new Date() }).where(eq(schema.aiOps.id, op.id));
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(`/plans/${planId}/items/${item.id}?applied=${chosen.length}`);
}

export async function discardOp(planId: string, opId: string) {
  await requirePlan(planId);
  const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
  if (!op) redirect(`/plans/${planId}`);
  await db.update(schema.aiOps).set({ status: "discarded", outcome: "Отклонено целиком", updatedAt: new Date() }).where(eq(schema.aiOps.id, opId));
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(op.itemId ? `/plans/${planId}/items/${op.itemId}` : `/plans/${planId}`);
}

/** Критика ничего не меняет в записи: человек отмечает, что прочитал */
export async function ackCritique(planId: string, opId: string) {
  await requirePlan(planId);
  const [op] = await db.select().from(schema.aiOps).where(and(eq(schema.aiOps.id, opId), eq(schema.aiOps.planId, planId)));
  if (!op) redirect(`/plans/${planId}`);
  await db.update(schema.aiOps).set({ status: "applied", outcome: "Прочитано", updatedAt: new Date() }).where(eq(schema.aiOps.id, opId));
  revalidatePath(`/plans/${planId}`, "layout");
  redirect(op.itemId ? `/plans/${planId}/items/${op.itemId}` : `/plans/${planId}`);
}

// ---------- документы ----------

export async function generateDocument(planId: string, stageKey: string) {
  const { user, plan, method } = await requirePlan(planId);
  const { model, markdown } = await buildStageMarkdown(plan, method, stageKey, user.name);
  const [{ v }] = await db
    .select({ v: max(schema.documents.version) })
    .from(schema.documents)
    .where(and(eq(schema.documents.planId, planId), eq(schema.documents.stageKey, stageKey)));
  const id = newId();
  await db.insert(schema.documents).values({ id, planId, stageKey, version: (v ?? 0) + 1, markdown, model, createdBy: user.id });
  revalidatePath(`/plans/${planId}/documents`);
  redirect(`/plans/${planId}/documents?ready=${id}`);
}

export async function deleteDocuments(planId: string, ids: string[]) {
  await requirePlan(planId);
  if (ids.length) await db.delete(schema.documents).where(and(eq(schema.documents.planId, planId), inArray(schema.documents.id, ids)));
  revalidatePath(`/plans/${planId}/documents`);
}

// ---------- этапы ----------

/** Переход к следующему этапу делает человек: закрыть можно только выполненный этап */
export async function closeStage(planId: string, stageKey: string, fd: FormData) {
  const { user, method } = await requirePlan(planId);
  const { planItems, planClosures } = await import("@/lib/data");
  const { planProgress } = await import("@/lib/progress");
  const prog = planProgress(method, await planItems(planId), await planClosures(planId));
  const st = prog.stages.find((s) => s.stage.key === stageKey);
  if (!st || !st.unlocked || !st.complete || st.closure) redirect(`/plans/${planId}/${stageKey}`);
  await db.insert(schema.stageClosures).values({ id: newId(), planId, stageKey, closedBy: user.name, note: String(fd.get("note") ?? "").trim() });
  revalidatePath(`/plans/${planId}`, "layout");
  const idx = method.stages.findIndex((s) => s.key === stageKey);
  redirect(`/plans/${planId}/${method.stages[idx + 1]?.key ?? stageKey}`);
}

export async function reopenStage(planId: string, stageKey: string) {
  await requirePlan(planId);
  await db.delete(schema.stageClosures).where(and(eq(schema.stageClosures.planId, planId), eq(schema.stageClosures.stageKey, stageKey)));
  revalidatePath(`/plans/${planId}`, "layout");
}

// ---------- визуальные концепции ----------

/** Контекст для вёрстки: проверенные и подписанные записи плана, сама концепция и, для бренд-борда, тренды */
async function visualBrief(plan: typeof schema.plans.$inferSelect, method: typeof ASDIC, it: typeof schema.items.$inferSelect, userId: string) {
  const { itemsBlock, planBlock } = await import("@/lib/ai/prompts");
  const { section } = findSection(method, it.sectionKey);
  const all = await db.select().from(schema.items).where(eq(schema.items.planId, plan.id));
  const approved = all.filter((x) => x.reviewStatus !== "unreviewed" && x.sectionKey !== it.sectionKey);
  const concept = section.fields
    .map((f) => {
      const v = displayValue(section, f.key, it.values[f.key]);
      return v ? `${f.label}: ${v}` : null;
    })
    .filter(Boolean)
    .join("\n");
  let trends = "";
  if (it.values.kind === "moodboard" || it.values.kind === "concept") {
    const { visualTrends } = await import("@/lib/images/trends");
    trends = await withCallCtx({ planId: plan.id, userId, kind: "image_trends" }, () => visualTrends(plan, userId));
  }
  return [
    planBlock(plan),
    itemsBlock(method, approved),
    `<concept>\n${concept}\n</concept>`,
    trends ? `<design_trends>\n${trends.replace(/</g, "‹")}\n</design_trends>` : "<design_trends>Поиск трендов недоступен: палитру «По тренду» строй на своих знаниях и прямо скажи об этом в борде.</design_trends>",
  ].join("\n\n");
}

/** Генерация изображений по записи-концепции. Ошибку провайдера показываем на странице записи. */
export async function generateVisual(planId: string, itemId: string, fd: FormData) {
  const { user, plan, method } = await requirePlan(planId);
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.planId, planId)));
  if (!it || !findSection(method, it.sectionKey).section.visuals) redirect(`/plans/${planId}`);
  const { generateVisuals } = await import("@/lib/images/generate");
  const brief = await visualBrief(plan, method, it, user.id);
  let q: string;
  try {
    const r = await generateVisuals({ planId, item: it, userId: user.id, count: Number(fd.get("count") ?? 1) || 1, aspect: String(fd.get("aspect") ?? ""), brief });
    q = `made=${r.made}${r.failed ? `&failed=${r.failed}` : ""}`;
  } catch (e) {
    q = `verr=${encodeURIComponent((e as Error).message.slice(0, 400))}`;
  }
  revalidatePath(`/plans/${planId}/items/${itemId}`);
  redirect(`/plans/${planId}/items/${itemId}?${q}#visuals`);
}

const VERDICTS = ["accepted", "base", "rejected", "new"] as const;

/** Решение человека по картинке. «Принять» или «Взять как основу» заодно утверждает концепцию. */
export async function setVisualVerdict(planId: string, visualId: string, verdict: string) {
  const { user } = await requirePlan(planId);
  if (!(VERDICTS as readonly string[]).includes(verdict)) return;
  const [v] = await db.select().from(schema.visuals).where(and(eq(schema.visuals.id, visualId), eq(schema.visuals.planId, planId)));
  if (!v) return;
  await db.update(schema.visuals).set({ verdict, verdictBy: verdict === "new" ? null : user.name }).where(eq(schema.visuals.id, visualId));
  if (verdict === "accepted" || verdict === "base") {
    await db
      .update(schema.items)
      .set({ reviewStatus: "approved", reviewedBy: user.name, reviewedAt: new Date() })
      .where(and(eq(schema.items.id, v.itemId), eq(schema.items.planId, planId), eq(schema.items.reviewStatus, "unreviewed")));
  }
  revalidatePath(`/plans/${planId}`, "layout");
}

/** Точечная правка визуала: Claude меняет только нужное место, результат сохраняется новой версией */
export async function editVisual(planId: string, visualId: string, fd: FormData) {
  const { user, plan, method } = await requirePlan(planId);
  const instruction = String(fd.get("instruction") ?? "").trim().slice(0, 2000);
  const [v] = await db.select().from(schema.visuals).where(and(eq(schema.visuals.id, visualId), eq(schema.visuals.planId, planId)));
  if (!v) redirect(`/plans/${planId}`);
  const [it] = await db.select().from(schema.items).where(and(eq(schema.items.id, v.itemId), eq(schema.items.planId, planId)));
  if (!it) redirect(`/plans/${planId}`);
  let q: string;
  if (!instruction) q = `verr=${encodeURIComponent("Напишите, что поправить")}`;
  else if (v.mime !== "text/html" && v.mime !== "image/svg+xml") q = `verr=${encodeURIComponent("Точечная правка работает только для визуалов, сверстанных Claude")}`;
  else {
    try {
      const { editVisualCode } = await import("@/lib/images/providers/claude");
      const { readStored, storeFile } = await import("@/lib/sources");
      const { itemsBlock, planBlock } = await import("@/lib/ai/prompts");
      const all = await db.select().from(schema.items).where(eq(schema.items.planId, planId));
      const brief = `${planBlock(plan)}\n\n${itemsBlock(method, all.filter((x) => x.reviewStatus !== "unreviewed"))}`;
      const r = await withCallCtx({ planId, userId: user.id, kind: "image_edit" }, async () =>
        editVisualCode({ code: (await readStored(v.storageKey)).toString("utf8"), mime: v.mime, instruction, brief }),
      );
      const key = await storeFile(r.bytes, v.mime === "text/html" ? ".html" : ".svg");
      await db.insert(schema.visuals).values({
        id: newId(),
        planId,
        itemId: v.itemId,
        parentId: v.id,
        storageKey: key,
        mime: v.mime,
        prompt: instruction,
        aspect: v.aspect,
        provider: "claude",
        model: r.model,
        costUsd: r.costUsd.toFixed(4),
        notes: `Правка: ${instruction}. ${r.notes}`,
        meta: v.meta,
        createdBy: user.id,
      });
      q = "edited=1";
    } catch (e) {
      q = `verr=${encodeURIComponent((e as Error).message.slice(0, 400))}`;
    }
  }
  revalidatePath(`/plans/${planId}/items/${v.itemId}`);
  redirect(`/plans/${planId}/items/${v.itemId}?${q}#visuals`);
}
