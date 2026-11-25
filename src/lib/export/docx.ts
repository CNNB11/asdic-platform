import "server-only";
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { docParts, type DocModel } from "./model";
import { readStored } from "@/lib/sources";
import { fmtNum } from "@/lib/num";
import { DEFAULT_NDA } from "./html";

const FONT = "Space Grotesk";
const GREY = "7D7D7A";
const RED = "E4343F";

const t = (text: string, o: { color?: string; size?: number; sup?: boolean } = {}) => new TextRun({ text, font: FONT, color: o.color, size: o.size, superScript: o.sup });

export async function renderDocx(m: DocModel): Promise<Buffer> {
  const ps: (Paragraph | Table)[] = [];
  const full = m.kind === "full";
  const conf = !!(m.paid && m.brand?.confidential);
  const logo = await logoRun(m);
  if (logo) ps.push(new Paragraph({ children: [logo] }));
  else if (m.paid) ps.push(new Paragraph({ children: [t(m.brand?.companyName || m.company.split(/[.\n]/)[0].slice(0, 80))] }));
  else ps.push(new Paragraph({ children: [t("ASDIC"), t("™", { sup: true, color: GREY }), t(" · путь из точки A в точку B", { color: GREY })] }));
  if (conf) ps.push(new Paragraph({ spacing: { before: 200 }, children: [t("КОНФИДЕНЦИАЛЬНО", { color: RED, size: 18 })] }));
  ps.push(new Paragraph({ spacing: { before: 2400 }, heading: HeadingLevel.TITLE, children: [t(m.planTitle, { size: 56 })] }));
  ps.push(new Paragraph({ children: [t(full ? "Стратегия развития: путь A → B" : `${m.stageNum}. ${m.stageTitle} · ${m.stageTitleRu}`, { size: 32 })] }));
  ps.push(new Paragraph({ children: [t(m.question, { color: GREY, size: 26 })] }));
  if (m.pointA) ps.push(new Paragraph({ spacing: { before: 300 }, children: [t("Точка A: ", { color: GREY }), t(m.pointA)] }));
  if (m.pointB) ps.push(new Paragraph({ children: [t("Точка B: ", { color: GREY }), t(m.pointB)] }));
  ps.push(new Paragraph({ spacing: { before: 1200 }, children: [t(`${m.brand?.preparedFor ? "Для: " + m.brand.preparedFor + " · " : ""}Подготовлено ${m.preparedAt} · ответственный ${m.preparedBy}`, { color: GREY, size: 18 })] }));
  ps.push(new Paragraph({ children: [t(m.methodLine, { color: GREY, size: 18 })] }));
  ps.push(new Paragraph({ children: [new PageBreak()] }));

  if (m.outstanding.length) {
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t("Что ещё не сделано")] }));
    m.outstanding.forEach((o) => ps.push(new Paragraph({ bullet: { level: 0 }, shading: { type: ShadingType.CLEAR, fill: "FDF3E1", color: "auto" }, children: [t(o)] })));
  }
  const d = m.dashboard;
  if (full && d) {
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t("Стратегия на одной странице")] }));
    if (d.positioning) ps.push(new Paragraph({ spacing: { before: 200, after: 200 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "141414", space: 8 } }, children: [t(d.positioning, { size: 28 })] }));
    if (d.kpis.length) {
      ps.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t("Цели с цифрами")] }));
      ps.push(table(["Показатель", "Сейчас", "Цель", "Срок", "Факт"], d.kpis.map((k) => { const f = k.facts?.[k.facts.length - 1]; return [k.metric || k.goal, `${k.currentText} ${k.unit}`, `${k.targetText} ${k.unit}`, k.deadline, f ? `${fmtNum(f.value)} (${f.date})` : "—"]; })));
    }
    ps.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [t("SWOT")] }));
    const j = (xs: string[]) => xs.join("\n") || "—";
    ps.push(table(["Сильные стороны", "Слабые стороны"], [[j(d.swot.strengths), j(d.swot.weaknesses)]]));
    ps.push(table(["Возможности", "Угрозы"], [[j(d.swot.opportunities), j(d.swot.threats)]]));
    if (d.timeline.length) {
      ps.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [t("Дорожная карта")] }));
      ps.push(table(["Дата", "Что", "Кто"], d.timeline.map((r) => [r.date, r.label, r.owner ?? ""])));
    }
    const x = d.deep;
    const r = (n: number) => fmtNum(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
    const h2 = (s: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [t(s)] });
    if (x?.unit) ps.push(h2(`Юнит-экономика: ${x.unit.verdictText.toLowerCase()}`), table(x.unit.cards.map((c) => c.label), [x.unit.cards.map((c) => c.value)]));
    if (x?.channels) ps.push(h2("Бюджет по каналам"), table(["Канал", "Бюджет в месяц", "Заявок", "Продаж"], x.channels.rows.map((c) => [c.channel, `${fmtNum(Math.round(c.budget))} ${x.channels!.currency}`, r(c.leads), c.sales != null ? r(c.sales) : "—"])));
    if (x?.scenarios) ps.push(h2(`Сценарии «что если» (база: ${r(x.scenarios.base)} заявок в день)`), table(["Сценарий", "Заявок в день", "Комментарий"], x.scenarios.rows.map((c) => [c.name, r(c.leadsDay), c.comment])));
    if (x?.benchmarks) ps.push(h2("Бенчмарки ниши"), table(["Показатель", "В нише", "У нас"], x.benchmarks.map((b) => [b.metric, b.niche, b.ours || "—"])));
    if (x?.content) ps.push(h2("Контент-план на 90 дней"), table(["Неделя", "Тема", "Канал", "Формат", "Призыв"], x.content.map((c) => [c.week, c.topic, c.channel, c.format, c.cta])));
    ps.push(new Paragraph({ children: [new PageBreak()] }));
  }
  for (const p of docParts(m)) {
  if (full) ps.push(new Paragraph({ heading: HeadingLevel.TITLE, pageBreakBefore: true, children: [t(`${p.num}. ${p.titleRu}`, { size: 44 })] }), new Paragraph({ children: [t(`${p.title} · ${p.question}`, { color: GREY })] }));
  for (const s of p.sections) {
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
  if (conf) ps.push(new Paragraph({ spacing: { before: 600 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 6 } }, children: [t("Конфиденциально. ", { color: RED, size: 18 }), t(m.brand?.ndaText || DEFAULT_NDA, { size: 18 })] }));
  if (m.brand?.contact) ps.push(new Paragraph({ spacing: { before: 300 }, children: [t(m.brand.contact, { color: GREY, size: 18 })] }));
  ps.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.LEFT, children: m.paid ? [t(m.methodLine, { color: GREY, size: 16 })] : [t("Документ подготовлен на платформе ASDIC", { color: GREY, size: 16 }), t("™", { color: GREY, size: 16, sup: true }), t(" с помощью ИИ. Записи, сделанные ИИ, проверяет человек; решения на красных уровнях принимает и подписывает только человек.", { color: GREY, size: 16 })] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21, color: "222222" } } } },
    sections: [
      {
        properties: { titlePage: true },
        headers: { default: new Header({ children: [new Paragraph({ children: [t(m.brand?.companyName || m.planTitle, { color: GREY, size: 15 }), ...(conf ? [t("   КОНФИДЕНЦИАЛЬНО", { color: RED, size: 15 })] : [])] })] }), first: new Header({ children: [] }) },
        footers: { default: new Footer({ children: m.paid ? [] : [new Paragraph({ children: [t("Сделано на платформе ASDIC™ · бесплатная версия", { color: GREY, size: 14 })] })] }), first: new Footer({ children: [] }) },
        children: ps,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function logoRun(m: DocModel) {
  const key = m.brand?.logoKey;
  const mime = m.brand?.logoMime ?? "";
  if (!key || !/png|jpe?g/.test(mime)) return null;
  try {
    const data = await readStored(key);
    const { w, h } = imageSize(data, mime);
    const height = 60;
    return new ImageRun({ type: mime.includes("png") ? "png" : "jpg", data, transformation: { width: Math.round((w / h) * height) || 160, height } });
  } catch {
    return null;
  }
}

/** Размер PNG или JPEG по заголовку файла */
function imageSize(b: Buffer, mime: string) {
  if (mime.includes("png")) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: 3, h: 1 };
}

function table(head: string[], rows: string[][]) {
  const cell = (x: string, h = false) =>
    new TableCell({
      shading: h ? { type: ShadingType.CLEAR, fill: "F3F3F1", color: "auto" } : undefined,
      children: x.split("\n").map((line) => new Paragraph({ children: [t(line, { size: 18, color: h ? GREY : undefined })] })),
    });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: head.map((x) => cell(x, true)) }), ...rows.map((r) => new TableRow({ children: r.map((x) => cell(x)) }))] });
}
