import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocModel } from "./model";

const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TM = `ASDIC<sup class="tm">™</sup>`;

/** Печатная версия документа этапа: белый лист, Space Grotesk 400, красный только для решений человека */
export async function renderHtml(m: DocModel): Promise<string> {
  const font = await readFile(path.join(process.cwd(), "src/fonts/SpaceGrotesk-Regular.woff2"));
  const sections = m.sections
    .map(
      (s) => `<section><h2><i class="dot ${s.mode}"></i>${e(s.title)}</h2><p class="cap">${e(s.modeLabel)}. ${e(s.description)}</p>
${s.items.length ? "" : `<p class="cap">Записей пока нет.</p>`}
${s.items
  .map(
    (it) => `<article class="${it.status.kind}"><h3>${e(it.title)}${it.badge ? ` <span class="badge">${e(it.badge)}</span>` : ""}</h3>
<ul>${it.fields.map((f) => `<li><span class="lbl">${e(f.label)}</span> ${e(f.value)}${f.refs.map((n) => `<sup class="ref">[${n}]</sup>`).join("")}</li>`).join("")}
${it.options?.length ? `<li><span class="lbl">Рассмотренные варианты</span> ${it.options.map((o) => (o.chosen ? `<b class="chosen">${e(o.title)} (выбран)</b>` : e(o.title))).join("; ")}</li>` : ""}</ul>
<p class="st ${it.status.kind}">${e(it.status.text)}</p></article>`,
  )
  .join("")}</section>`,
    )
    .join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${e(m.planTitle)} · ${e(m.stageTitle)}</title><style>
@font-face{font-family:SG;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");font-weight:400}
@page{size:A4;margin:22mm 20mm 20mm}
*{font-weight:400!important;box-sizing:border-box}
body{font-family:SG,sans-serif;color:#222;font-size:10.5pt;line-height:1.5;margin:0}
h1{font-size:30pt;line-height:1.1;color:#000;margin:0 0 6mm}
h2{font-size:17pt;color:#000;margin:10mm 0 2mm;display:flex;align-items:center;gap:3mm;break-after:avoid}
h3{font-size:12.5pt;color:#000;margin:5mm 0 1.5mm;break-after:avoid}
.cover{height:240mm;display:flex;flex-direction:column;justify-content:space-between;break-after:page}
.stage{font-size:16pt;color:#000}.q{color:#7d7d7a;font-size:13pt}
.cap,.meta{color:#7d7d7a;font-size:9pt}
.tm{font-size:.42em;vertical-align:top;position:relative;top:-.2em;color:#7d7d7a}
.dot{width:3mm;height:3mm;display:inline-block}.dot.red{background:#e4343f}.dot.yellow{background:#f0a93b}.dot.green{background:#3dbe8b}
ul{padding:0;margin:0;list-style:none}li{margin:1.2mm 0}.lbl{color:#7d7d7a;display:block;font-size:9pt}
article{break-inside:avoid;border-left:.6mm solid #ddd;padding-left:4mm;margin:4mm 0}
article.signed,article.unsigned{border-left-color:#e4343f}
.st{font-size:9pt;color:#7d7d7a;margin:1.5mm 0 0}.st.signed{color:#e4343f}
.st.unreviewed,.st.unsigned{background:#fdf3e1;color:#7a4b00;padding:1.5mm 3mm;display:inline-block}
.badge{font-size:9pt;color:#7d7d7a;border:.3mm solid #ccc;padding:.3mm 2mm;border-radius:3mm}
.chosen{color:#e4343f}.ref{color:#7d7d7a;font-size:7.5pt}
.out{background:#fdf3e1;padding:4mm 5mm;margin:6mm 0}.out li{margin:.8mm 0}
table{border-collapse:collapse;width:100%;font-size:9pt}td,th{border-bottom:.3mm solid #ddd;padding:2mm;text-align:left;vertical-align:top}th{color:#7d7d7a}
a{color:#000}
</style></head><body>
<div class="cover"><div><p class="meta">${TM} · путь из точки A в точку B</p></div>
<div><h1>${e(m.planTitle)}</h1><p class="stage">${e(m.stageNum)}. ${e(m.stageTitle)} · ${e(m.stageTitleRu)}</p><p class="q">${e(m.question)}</p>
${m.pointA ? `<p><span class="lbl">Точка A</span>${e(m.pointA)}</p>` : ""}${m.pointB ? `<p><span class="lbl">Точка B</span>${e(m.pointB)}</p>` : ""}</div>
<div class="meta">${e(m.company)}<br>Подготовлено ${e(m.preparedAt)} · ведёт ${e(m.preparedBy)}<br>${e(m.methodLine).replace("ASDIC™", TM)}</div></div>
${m.outstanding.length ? `<div class="out"><b>Что ещё не сделано</b><ul>${m.outstanding.map((o) => `<li>${e(o)}</li>`).join("")}</ul></div>` : ""}
${sections}
${m.sources.length ? `<section><h2>Источники</h2><table><tr><th>Источник</th><th>Где использован</th></tr>${m.sources.map((s) => `<tr><td>[${s.n}] ${s.url ? `<a href="${e(s.url)}">${e(s.title)}</a>` : e(s.title)}</td><td>${s.citedBy.map(e).join("<br>")}</td></tr>`).join("")}</table></section>` : ""}
<p class="cap" style="margin-top:12mm">Документ подготовлен на платформе ${TM}. Записи, сделанные ИИ, проверяет человек; решения на красных уровнях принимает и подписывает только человек.</p>
</body></html>`;
}
