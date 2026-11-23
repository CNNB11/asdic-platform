import type { DocModel } from "./model";

export function renderMarkdown(m: DocModel): string {
  const out: string[] = [];
  out.push(`# ${m.planTitle}`, "", `## ${m.stageNum}. ${m.stageTitle} (${m.stageTitleRu})`, "", `*${m.question}*`, "");
  out.push(`Подготовлено ${m.preparedAt}. Ведёт: ${m.preparedBy}.`, "", `${m.methodLine}. ASDIC™ — метод SWISSIN.`, "");
  if (m.pointA || m.pointB) out.push(`**Точка A:** ${m.pointA || "—"}`, "", `**Точка B:** ${m.pointB || "—"}`, "");
  if (m.outstanding.length) {
    out.push("## Что ещё не сделано", "");
    m.outstanding.forEach((o) => out.push(`- ${o}`));
    out.push("");
  }
  for (const s of m.sections) {
    out.push(`## ${s.title}`, "", `*${s.modeLabel}.* ${s.description}`, "");
    if (!s.items.length) out.push("Записей пока нет.", "");
    for (const it of s.items) {
      out.push(`### ${it.title}${it.badge ? ` (${it.badge.toLowerCase()})` : ""}`, "");
      it.fields.forEach((f) => out.push(`- **${f.label}:** ${f.value.replace(/\n+/g, " ")}${f.refs.map((n) => ` [${n}]`).join("")}`));
      if (it.options?.length) out.push(`- **Рассмотренные варианты:** ${it.options.map((o) => (o.chosen ? `${o.title} (выбран)` : o.title)).join("; ")}`);
      out.push("", it.status.kind === "signed" || it.status.kind === "approved" ? `*${it.status.text}*` : `> **${it.status.text}**`, "");
    }
  }
  if (m.sources.length) {
    out.push("## Источники", "");
    m.sources.forEach((s) => out.push(`${s.n}. ${s.url ? `[${s.title}](${s.url})` : s.title} — использован в: ${s.citedBy.join("; ")}`));
    out.push("");
  }
  out.push("---", "", "Документ подготовлен на платформе ASDIC™. Записи, сделанные ИИ, проверяет человек; решения на красных уровнях принимает и подписывает только человек.");
  return out.join("\n");
}

export async function buildStageMarkdown(...args: Parameters<typeof import("./model").buildStageModel>) {
  const { buildStageModel } = await import("./model");
  const model = await buildStageModel(...args);
  return { model, markdown: renderMarkdown(model) };
}
