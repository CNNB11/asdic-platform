import "server-only";
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, PageBreak, Paragraph, ShadingType, TextRun } from "docx";
import type { DocModel } from "./model";

const FONT = "Space Grotesk";
const GREY = "7D7D7A";
const RED = "E4343F";

const t = (text: string, o: { color?: string; size?: number; sup?: boolean } = {}) => new TextRun({ text, font: FONT, color: o.color, size: o.size, superScript: o.sup });

export async function renderDocx(m: DocModel): Promise<Buffer> {
  const ps: Paragraph[] = [];
  ps.push(new Paragraph({ children: [t("ASDIC"), t("™", { sup: true, color: GREY }), t(" · путь из точки A в точку B", { color: GREY })] }));
  ps.push(new Paragraph({ spacing: { before: 2400 }, heading: HeadingLevel.TITLE, children: [t(m.planTitle, { size: 56 })] }));
  ps.push(new Paragraph({ children: [t(`${m.stageNum}. ${m.stageTitle} · ${m.stageTitleRu}`, { size: 32 })] }));
  ps.push(new Paragraph({ children: [t(m.question, { color: GREY, size: 26 })] }));
  if (m.pointA) ps.push(new Paragraph({ spacing: { before: 300 }, children: [t("Точка A: ", { color: GREY }), t(m.pointA)] }));
  if (m.pointB) ps.push(new Paragraph({ children: [t("Точка B: ", { color: GREY }), t(m.pointB)] }));
  ps.push(new Paragraph({ spacing: { before: 1200 }, children: [t(`${m.company ? m.company + " · " : ""}Подготовлено ${m.preparedAt} · ведёт ${m.preparedBy}`, { color: GREY, size: 18 })] }));
  ps.push(new Paragraph({ children: [t(m.methodLine, { color: GREY, size: 18 })] }));
  ps.push(new Paragraph({ children: [new PageBreak()] }));

  if (m.outstanding.length) {
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t("Что ещё не сделано")] }));
    m.outstanding.forEach((o) => ps.push(new Paragraph({ bullet: { level: 0 }, shading: { type: ShadingType.CLEAR, fill: "FDF3E1", color: "auto" }, children: [t(o)] })));
  }
  for (const s of m.sections) {
    const dot = s.mode === "red" ? RED : s.mode === "yellow" ? "F0A93B" : "3DBE8B";
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400 }, children: [t("■ ", { color: dot }), t(s.title)] }));
    ps.push(new Paragraph({ children: [t(`${s.modeLabel}. ${s.description}`, { color: GREY, size: 18 })] }));
    if (!s.items.length) ps.push(new Paragraph({ children: [t("Записей пока нет.", { color: GREY })] }));
    for (const it of s.items) {
      ps.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 240 }, children: [t(it.title), ...(it.badge ? [t(`  ${it.badge}`, { color: GREY, size: 18 })] : [])] }));
      for (const f of it.fields) {
        ps.push(new Paragraph({ children: [t(f.label, { color: GREY, size: 18 })] }));
        ps.push(new Paragraph({ spacing: { after: 80 }, children: [t(f.value), ...f.refs.map((n) => t(` [${n}]`, { color: GREY, sup: true }))] }));
      }
      if (it.options?.length) {
        ps.push(new Paragraph({ children: [t("Рассмотренные варианты", { color: GREY, size: 18 })] }));
        ps.push(new Paragraph({ children: it.options.flatMap((o, i) => [...(i ? [t("; ")] : []), t(o.chosen ? `${o.title} (выбран)` : o.title, { color: o.chosen ? RED : undefined })]) }));
      }
      const warn = it.status.kind === "unreviewed" || it.status.kind === "unsigned";
      ps.push(
        new Paragraph({
          spacing: { after: 160 },
          border: warn ? { left: { style: BorderStyle.SINGLE, size: 12, color: "F0A93B", space: 6 } } : undefined,
          shading: warn ? { type: ShadingType.CLEAR, fill: "FDF3E1", color: "auto" } : undefined,
          children: [t(it.status.text, { color: it.status.kind === "signed" ? RED : warn ? "7A4B00" : GREY, size: 18 })],
        }),
      );
    }
  }
  if (m.sources.length) {
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400 }, children: [t("Источники")] }));
    for (const s of m.sources) {
      ps.push(
        new Paragraph({
          children: [
            t(`[${s.n}] `),
            s.url ? new ExternalHyperlink({ link: s.url, children: [new TextRun({ text: s.title, font: FONT, style: "Hyperlink" })] }) : t(s.title),
          ],
        }),
      );
      ps.push(new Paragraph({ spacing: { after: 120 }, children: [t(`Использован в: ${s.citedBy.join("; ")}`, { color: GREY, size: 18 })] }));
    }
  }
  ps.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.LEFT, children: [t("Документ подготовлен на платформе ASDIC", { color: GREY, size: 16 }), t("™", { color: GREY, size: 16, sup: true }), t(". Записи, сделанные ИИ, проверяет человек; решения на красных уровнях принимает и подписывает только человек.", { color: GREY, size: 16 })] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21, color: "222222" } } } },
    sections: [{ properties: {}, children: ps }],
  });
  return Packer.toBuffer(doc);
}
