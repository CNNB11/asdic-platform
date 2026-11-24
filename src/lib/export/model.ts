import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { displayValue, findStage, itemTitle, type Method } from "@/method";
import { sectionStatus } from "@/lib/progress";
import { MODE_LABEL } from "@/components/ui";

export interface DocItem {
  title: string;
  badge?: string;
  fields: { label: string; value: string; refs: number[] }[];
  status: { kind: "signed" | "approved" | "unreviewed" | "unsigned"; text: string };
  options?: { title: string; chosen: boolean }[];
}

export interface DocModel {
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
  sections: { title: string; mode: string; modeLabel: string; description: string; items: DocItem[] }[];
  sources: { n: number; title: string; url?: string; citedBy: string[] }[];
}

export async function buildStageModel(plan: typeof schema.plans.$inferSelect, method: Method, stageKey: string, userName: string): Promise<DocModel> {
  const stage = findStage(method, stageKey);
  const items = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.planId, plan.id), inArray(schema.items.sectionKey, stage.sections.map((s) => s.key))));
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

  // Принятые бренд-борды: их палитры и шрифты попадают в документ текстом с HEX
  const boards = stage.sections.some((x) => x.visuals)
    ? (await db.select().from(schema.visuals).where(and(eq(schema.visuals.planId, plan.id), inArray(schema.visuals.verdict, ["accepted", "base"])))).filter((v) => v.meta)
    : [];
  const KIND: Record<string, string> = { brand: "бренд", trend: "по тренду", counter: "контр-палитра" };
  const boardItems = (itemId: string): DocItem[] =>
    boards
      .filter((v) => v.itemId === itemId)
      .map((v) => ({
        title: `Бренд-борд от ${new Date(v.createdAt).toLocaleDateString("ru-RU")}`,
        fields: [
          ...(v.meta?.palettes ?? []).map((p) => ({
            label: `Палитра «${p.name}», ${KIND[p.kind] ?? p.kind}${p.recommended ? ", рекомендуем" : ""}`,
            value: `${p.colors.map((c) => `${c.hex} ${c.name ? `${c.name}, ` : ""}${c.role}`).join("; ")}. ${p.why}`,
            refs: [],
          })),
          ...(v.meta?.fonts ?? []).map((f) => ({ label: `Шрифт: ${f.role}`, value: `${f.family}, бесплатный (Google Fonts). ${f.why}`, refs: [] })),
        ],
        status: { kind: "approved" as const, text: `${v.verdict === "accepted" ? "Принял(а)" : "Взял(а) как основу"} ${v.verdictBy ?? ""}`.trim() },
      }));

  const outstanding: string[] = [];
  const sections = stage.sections.map((section) => {
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
      else if (it.reviewStatus === "unreviewed") status = { kind: "unreviewed", text: "Требует проверки: сделано ИИ, человек ещё не проверил" };
      else status = { kind: "approved", text: ai ? `Сделано ИИ, проверил(а) ${by}` : `Внёс(ла) ${by}` };
      if (section.mode === "yellow" && it.reviewStatus === "unreviewed") outstanding.push(`${section.title}: «${title}» не проверено человеком`);
      if (section.mode === "red" && it.reviewStatus !== "signed") outstanding.push(`${section.title}: «${title}» не подписано`);
      const badge = section.fields.find((f) => f.uniqueTrue && it.values[f.key] === true)?.label;
      const options = it.decision?.options.map((o, i) => ({ title: o.title, chosen: it.decision?.chosenIndex === i }));
      return { title, badge, fields, status, options };
    });
    if (section.visuals) {
      const withBoards = docItems.flatMap((d, i) => [d, ...boardItems(st.items[i].id)]);
      docItems.splice(0, docItems.length, ...withBoards);
    }
    return { title: section.title, mode: section.mode, modeLabel: MODE_LABEL[section.mode], description: section.description, items: docItems };
  });

  return {
    planTitle: plan.title,
    company: plan.company,
    stageNum: stage.num,
    stageTitle: stage.title,
    stageTitleRu: stage.titleRu,
    question: stage.question,
    preparedAt: new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
    preparedBy: userName,
    methodLine: `${method.name} версия ${method.version} · ${method.author}`,
    pointA: plan.pointA,
    pointB: plan.pointB,
    outstanding,
    sections,
    sources,
  };
}
