import { docParts, type DocModel } from "./model";
import { fmtNum } from "@/lib/num";

export function renderMarkdown(m: DocModel): string {
  const out: string[] = [];
  const full = m.kind === "full";
  out.push(`# ${m.planTitle}`, "", full ? "## Стратегия развития: путь A → B" : `## ${m.stageNum}. ${m.stageTitle} (${m.stageTitleRu})`, "", `*${m.question}*`, "");
  if (m.paid && m.brand?.confidential) out.push("**КОНФИДЕНЦИАЛЬНО**", "");
  out.push(`Подготовлено ${m.preparedAt}${m.brand?.preparedFor ? ` для ${m.brand.preparedFor}` : ""}. Ответственный: ${m.preparedBy}.`, "", m.paid ? `${m.methodLine}.` : `${m.methodLine}. ASDIC™ — метод SWISSIN.`, "");
  if (m.pointA || m.pointB) out.push(`**Точка A:** ${m.pointA || "—"}`, "", `**Точка B:** ${m.pointB || "—"}`, "");
  if (m.outstanding.length) {
    out.push("## Что ещё не сделано", "");
    m.outstanding.forEach((o) => out.push(`- ${o}`));
    out.push("");
  }
  const d = m.dashboard;
  if (full && d) {
    if (d.positioning) out.push(`> ${d.positioning}`, "");
    if (d.kpis.length) {
      out.push("## Цели с цифрами", "", "| Показатель | Сейчас | Цель | Срок | Факт |", "| --- | --- | --- | --- | --- |");
      d.kpis.forEach((k) => {
        const f = k.facts?.[k.facts.length - 1];
        out.push(`| ${k.metric || k.goal} | ${k.currentText} ${k.unit} | ${k.targetText} ${k.unit} | ${k.deadline} | ${f ? `${fmtNum(f.value)} (${f.date})` : "—"} |`);
      });
      out.push("");
    }
    out.push("## SWOT", "");
    ([["Сильные стороны", d.swot.strengths], ["Слабые стороны", d.swot.weaknesses], ["Возможности", d.swot.opportunities], ["Угрозы", d.swot.threats]] as const).forEach(([t, xs]) => out.push(`**${t}:** ${xs.join("; ") || "—"}`, ""));
    if (d.timeline.length) {
      out.push("## Дорожная карта", "", "| Дата | Что | Кто |", "| --- | --- | --- |");
      d.timeline.forEach((r) => out.push(`| ${r.date} | ${r.label} | ${r.owner ?? ""} |`));
      out.push("");
    }
    const x = d.deep;
    const r = (n: number) => fmtNum(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
    if (x?.unit) out.push(`## Юнит-экономика${x.unit.name ? `: ${x.unit.name}` : ""}`, "", `**${x.unit.verdictText}.** ${x.unit.cards.map((c) => `${c.label}: ${c.value}`).join(" · ")}`, "");
    if (x?.channels) {
      out.push("## Бюджет по каналам", "", "| Канал | Бюджет в месяц | Заявок | Продаж |", "| --- | --- | --- | --- |");
      x.channels.rows.forEach((c) => out.push(`| ${c.channel} | ${fmtNum(Math.round(c.budget))} ${x.channels!.currency} | ${r(c.leads)} | ${c.sales != null ? r(c.sales) : "—"} |`));
      out.push("");
    }
    if (x?.scenarios) {
      out.push("## Сценарии «что если»", "", `Базовый расчёт: ${r(x.scenarios.base)} заявок в день.`, "", "| Сценарий | Заявок в день | Комментарий |", "| --- | --- | --- |");
      x.scenarios.rows.forEach((c) => out.push(`| ${c.name} | ${r(c.leadsDay)} | ${c.comment.replace(/\n+/g, " ")} |`));
      out.push("");
    }
    if (x?.benchmarks) {
      out.push("## Бенчмарки ниши", "", "| Показатель | В нише | У нас |", "| --- | --- | --- |");
      x.benchmarks.forEach((b) => out.push(`| ${b.metric} | ${b.niche} | ${b.ours || "—"} |`));
      out.push("");
    }
    if (x?.content) {
      out.push("## Контент-план на 90 дней", "", "| Неделя | Тема | Канал | Формат | Призыв |", "| --- | --- | --- | --- | --- |");
      x.content.forEach((c) => out.push(`| ${c.week} | ${c.topic} | ${c.channel} | ${c.format} | ${c.cta} |`));
      out.push("");
    }
  }
  for (const p of docParts(m)) {
    if (full) out.push(`# ${p.num}. ${p.titleRu} (${p.title})`, "", `*${p.question}*`, "");
  for (const s of p.sections) {
    out.push(`## ${s.title}`, "", `*${s.modeLabel}.* ${s.description}`, "");
    if (!s.items.length) out.push("Записей пока нет.", "");
    for (const it of s.items) {
      out.push(`### ${it.title}${it.badge ? ` (${it.badge.toLowerCase()})` : ""}`, "");
      it.fields.forEach((f) => out.push(`- **${f.label}:** ${f.value.replace(/\n+/g, " ")}${f.refs.map((n) => ` [${n}]`).join("")}`));
      if (it.options?.length) out.push(`- **Рассмотренные варианты:** ${it.options.map((o) => (o.chosen ? `${o.title} (выбран)` : o.title)).join("; ")}`);
      out.push("", it.status.kind === "signed" || it.status.kind === "approved" ? `*${it.status.text}*` : `> **${it.status.text}**`, "");
    }
  }
  }
  if (m.sources.length) {
    out.push("## Источники", "");
    m.sources.forEach((s) => out.push(`${s.n}. ${s.url ? `[${s.title}](${s.url})` : s.title} — использован в: ${s.citedBy.join("; ")}`));
    out.push("");
  }
  out.push("---", "", m.paid ? "Решения на ключевых уровнях приняли и подписали ответственные лица." : "Документ подготовлен на платформе ASDIC™ с помощью ИИ. Записи, сделанные ИИ, проверяет человек; решения на красных уровнях принимает и подписывает только человек.");
  if (m.brand?.contact) out.push("", m.brand.contact);
  return out.join("\n");
}

export async function buildStageMarkdown(...args: Parameters<typeof import("./model").buildStageModel>) {
  const { buildStageModel } = await import("./model");
  const model = await buildStageModel(...args);
  return { model, markdown: renderMarkdown(model) };
}

export async function buildFullMarkdown(...args: Parameters<typeof import("./model").buildFullModel>) {
  const { buildFullModel } = await import("./model");
  const model = await buildFullModel(...args);
  return { model, markdown: renderMarkdown(model) };
}
