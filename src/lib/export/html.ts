import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { docParts, type Dashboard, type DeepBlocks, type DocItem, type DocModel, type DocSection, type Kpi } from "./model";
import { themeOf, type ThemeKey } from "./themes";
import { embeddedFontCss } from "@/lib/images/fonts";
import { readStored } from "@/lib/sources";
import { fmtNum, ruDay } from "@/lib/num";

const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TM = `ASDIC<sup class="tm">™</sup>`;
const RED = "#e4343f";

export const DEFAULT_NDA =
  "Документ содержит конфиденциальную информацию и предназначен только для указанных получателей. Копирование, пересылка и раскрытие третьим лицам без письменного согласия владельца запрещены.";

/** Надписи колонтитулов: в PDF их ставит Chromium на каждой странице, кроме обложки */
export function pageChrome(m: DocModel) {
  const conf = !!(m.paid && m.brand?.confidential);
  return {
    left: m.brand?.companyName || m.planTitle,
    right: conf ? "Конфиденциально" : m.kind === "full" ? "Стратегия" : `${m.stageNum}. ${m.stageTitleRu}`,
    footer: m.paid ? "" : "Сделано на платформе ASDIC™ · бесплатная версия",
    confidential: conf,
  };
}

async function logoUri(m: DocModel) {
  const key = m.brand?.logoKey;
  if (!key) return null;
  try {
    const buf = await readStored(key);
    return `data:${m.brand?.logoMime ?? "image/png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Стиль документа. Старые документы без style: минимализм и цвет из brand.accent */
function styleOf(m: DocModel, override?: string) {
  const st = m.style;
  const theme = themeOf(override ?? st?.theme ?? "minimal");
  const a = m.brand?.accent ?? "";
  const own = /^#[0-9a-f]{6}$/i.test(a) && a.toLowerCase() !== "#141414" ? a : !st && a ? a : null;
  // Если тему переключили при скачивании, цвета и шрифты бренда сохраняем, иначе берём из темы
  const keep = st && (st.source === "brand" || !override || override === st.theme);
  return {
    theme: theme.key as ThemeKey,
    accent: own ?? (keep && st ? st.accent : theme.accent),
    head: keep && st?.source === "brand" ? st.head : theme.head,
    body: keep && st?.source === "brand" ? st.body : theme.body,
  };
}

const fontMemo = new Map<string, Promise<string>>();
/** Шрифты темы или бренда, встроенные в файл: документ выглядит одинаково без интернета */
function themeFonts(families: string[]) {
  const list = [...new Set(families.filter((f) => f && f !== "SG"))];
  if (!list.length) return Promise.resolve("");
  const key = list.join("|");
  if (!fontMemo.has(key)) {
    const p = embeddedFontCss(list.map((f) => `font-family:"${f}";`).join(""), 2_500_000)
      .then((r) => r.css)
      .catch(() => "");
    fontMemo.set(key, p);
    p.then((css) => {
      if (!css) fontMemo.delete(key);
    });
  }
  return fontMemo.get(key)!;
}

const fam = (f: string, fallback: string) => (f === "SG" ? `SG,${fallback}` : `"${f.replace(/"/g, "")}",SG,${fallback}`);

/** Печатная версия: отчёт в стиле консалтинга. Space Grotesk 400, красный только для решений человека. */
export async function renderHtml(m: DocModel, themeOverride?: string): Promise<string> {
  const font = await readFile(path.join(process.cwd(), "src/fonts/SpaceGrotesk-Regular.woff2"));
  const sty = styleOf(m, themeOverride);
  const extraFonts = await themeFonts([sty.head, sty.body]);
  const serifHead = /serif|playfair|lora|literata|cormorant|garamond/i.test(sty.head) && !/sans/i.test(sty.head);
  const logo = await logoUri(m);
  const parts = docParts(m);
  const full = m.kind === "full";
  const chrome = pageChrome(m);
  const d = m.dashboard;

  const toc: { id: string; title: string; sub?: string }[] = [];
  if (full && d) toc.push({ id: "summary", title: "Стратегия на одной странице" }, { id: "charts", title: "Цели, дорожная карта и SWOT" });
  if (full && d?.deep) toc.push({ id: "economics", title: "Экономика, каналы и сценарии" });
  parts.forEach((p, i) => {
    const g = m.digest?.stages.find((x) => x.key === p.key);
    toc.push({ id: `part-${i}`, title: `${p.num}. ${p.titleRu}`, sub: g?.actionTitle ?? p.sections.map((s) => s.title).join(" · ") });
  });
  if (m.outstanding.length) toc.push({ id: "open", title: "Приложение. Что ещё не закрыто" });
  if (m.sources.length) toc.push({ id: "sources", title: "Источники" });
  toc.push({ id: "about", title: "О документе" });

  const body = [
    cover(m, logo, chrome.confidential),
    full ? contents(toc) : "",
    full && d ? summary(m, d) : "",
    full && d ? charts(d) : "",
    full && d?.deep ? deepSection(d.deep) : "",
    parts.map((p, i) => part(p.num, p.titleRu, p.title, p.question, p.sections, i, full, m.digest?.stages.find((x) => x.key === p.key))).join(""),
    m.outstanding.length ? `<section id="open" class="open page"><h2>Приложение. Что ещё не закрыто</h2><p class="cap">Пункты метода, которые на момент сборки не выполнены. Перед отправкой документа их стоит закрыть.</p><ul>${m.outstanding.map((o) => `<li>${e(o)}</li>`).join("")}</ul></section>` : "",
    m.sources.length ? sourcesBlock(m) : "",
    about(m, chrome.confidential),
  ].join("");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${e(m.planTitle)} · ${e(full ? "Стратегия" : m.stageTitle)}</title><style>
@font-face{font-family:SG;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");font-weight:400}
${extraFonts}
@page{size:A4;margin:24mm 18mm 20mm}
@page :first{margin:0}
:root{--hf:${fam(sty.head, serifHead ? "Georgia,serif" : "sans-serif")};--bf:${fam(sty.body, "sans-serif")};--a:${sty.accent};--soft:color-mix(in srgb,var(--a) 10%,#fff);--mid:color-mix(in srgb,var(--a) 45%,#fff);--ink:#141414;--mut:#7d7d7a;--line:#e6e6e3;--red:${RED}}
*{box-sizing:border-box}
.t-minimal *{font-weight:400!important}
body{font-family:var(--bf);color:#262626;font-size:10pt;line-height:1.5;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:34pt;line-height:1.05;color:var(--ink);margin:0;letter-spacing:-.01em}
h2{font-size:20pt;line-height:1.15;color:var(--ink);margin:0 0 3mm;break-after:avoid}
h3{font-size:13pt;color:var(--ink);margin:8mm 0 2mm;display:flex;align-items:center;gap:2.5mm;break-after:avoid}
h4{font-size:11.5pt;color:var(--ink);margin:0 0 1.5mm;break-after:avoid}
p{margin:0 0 2mm}
.cap{color:var(--mut);font-size:8.5pt}
.tm{font-size:.42em;vertical-align:top;position:relative;top:-.15em}
.page{break-before:page}
/* обложка */
.cover{height:297mm;width:210mm;display:grid;grid-template-rows:auto 1fr auto;padding:22mm 20mm 18mm;position:relative;overflow:hidden;break-after:page}
.cover:before{content:"";position:absolute;left:0;top:0;bottom:0;width:7mm;background:var(--a)}
.cover .logo img{max-height:22mm;max-width:70mm;object-fit:contain}
.cover .logo .name{font-size:14pt;color:var(--ink)}
.cover .mid{align-self:center}
.kicker{font-size:10pt;letter-spacing:.14em;text-transform:uppercase;color:var(--a);margin-bottom:6mm}
.cover .sub{font-size:14pt;color:var(--mut);margin-top:5mm;max-width:150mm}
.ab{display:grid;grid-template-columns:1fr 8mm 1fr;gap:3mm;margin-top:14mm;max-width:170mm;align-items:stretch}
.ab div.box{border-top:.8mm solid var(--line);padding-top:3mm;font-size:9.5pt}
.ab div.box.b{border-top-color:var(--a)}
.ab .arrow{align-self:center;text-align:center;color:var(--mut);font-size:14pt}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;border-top:.3mm solid var(--line);padding-top:4mm;font-size:8.5pt}
.meta b{display:block;color:var(--mut);font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.5mm}
.stamp{position:absolute;right:20mm;top:22mm;border:.6mm solid var(--red);color:var(--red);padding:2mm 4mm;font-size:9pt;letter-spacing:.14em;text-transform:uppercase;transform:rotate(-4deg)}
.made{margin-top:4mm;color:var(--mut);font-size:8pt}
/* оглавление */
.toc ol{list-style:none;padding:0;margin:8mm 0 0;counter-reset:t}
.toc li{display:grid;grid-template-columns:12mm 1fr;padding:3mm 0;border-bottom:.3mm solid var(--line);counter-increment:t}
.toc li:before{content:counter(t,decimal-leading-zero);color:var(--a)}
.toc a{color:var(--ink);text-decoration:none;font-size:12pt}
/* сводка */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
.card{border:.3mm solid var(--line);padding:4mm 5mm;break-inside:avoid}
.card.tint{background:var(--soft);border-color:transparent}
.lbl{display:block;color:var(--mut);font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1mm}
.quote{font-size:15pt;line-height:1.3;color:var(--ink);border-left:1.2mm solid var(--a);padding:1mm 0 1mm 5mm;margin:6mm 0}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin:5mm 0}
.kpi{border-top:1mm solid var(--a);padding-top:3mm;break-inside:avoid;min-width:0;overflow-wrap:anywhere}
.kpi .big{font-size:22pt;line-height:1.1;color:var(--ink)}
.kpi .from{color:var(--mut);font-size:9pt}
.kpi .unit{font-size:9pt;color:var(--mut)}
.kpi .goal{font-size:9pt;margin-top:1.5mm}
.facts{margin-top:2mm}
/* графики */
.bars{display:grid;gap:5mm;margin:4mm 0 8mm}
.bar .track{position:relative;height:7mm;background:#f3f3f1;margin-top:1.5mm}
.bar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--mid)}
.bar .fact{position:absolute;left:0;top:1.75mm;height:3.5mm;background:var(--a)}
.bar .tick{position:absolute;top:-1mm;bottom:-1mm;width:.5mm;background:var(--ink)}
.bar .legend{display:flex;justify-content:space-between;font-size:8pt;color:var(--mut);margin-top:1mm}
.gantt{width:100%;border-collapse:collapse;font-size:8pt;margin:3mm 0 8mm;table-layout:fixed}
.gantt td,.gantt th{border-bottom:.2mm solid var(--line);padding:1.2mm 1mm;vertical-align:middle}
.gantt th{color:var(--mut);text-align:left;font-size:7pt}
.gantt .lane{position:relative;height:4mm}
.gantt .lane .m{position:absolute;top:.4mm;width:3.2mm;height:3.2mm;transform:translateX(-50%) rotate(45deg)}
.gantt .lane .grid{position:absolute;top:-1.2mm;bottom:-1.2mm;width:.2mm;background:var(--line)}
.m.action{background:var(--a)}.m.launch{background:var(--red)}.m.goal{background:var(--ink)}.m.checkpoint{background:#fff;border:.4mm solid var(--ink)}
.keys{display:flex;gap:5mm;font-size:8pt;color:var(--mut);flex-wrap:wrap}.keys i{display:inline-block;width:2.6mm;height:2.6mm;transform:rotate(45deg);margin-right:1.5mm}
.swot{display:grid;grid-template-columns:1fr 1fr;gap:0;border:.3mm solid var(--line);margin-top:3mm}
.swot>div{padding:4mm 5mm;min-height:40mm;break-inside:avoid}
.swot>div:nth-child(1),.swot>div:nth-child(2){border-bottom:.3mm solid var(--line)}
.swot>div:nth-child(odd){border-right:.3mm solid var(--line)}
.swot .t{font-size:11pt;color:var(--ink);display:flex;justify-content:space-between}
.swot .t span{color:var(--a)}
.swot ul{margin:2mm 0 0;padding-left:4mm}
/* главы */
.opener{break-before:page;padding-top:30mm;margin-bottom:10mm}
.opener .num{font-size:64pt;line-height:1;color:var(--a)}
.opener .q{font-size:14pt;color:var(--mut);margin-top:3mm}
.stagehead{margin-bottom:6mm}
.dot{width:2.6mm;height:2.6mm;display:inline-block;flex:none}.dot.red{background:var(--red)}.dot.yellow{background:#f0a93b}.dot.green{background:#3dbe8b}
.secdesc{color:var(--mut);font-size:8.5pt;margin-bottom:3mm}
article{break-inside:avoid;border-left:.5mm solid var(--line);padding:1mm 0 1mm 4mm;margin:3.5mm 0}
article.signed,article.unsigned{border-left-color:var(--red)}
article ul{padding:0;margin:0;list-style:none}article li{margin:1mm 0}
article .lbl{margin:0}
.st{font-size:8pt;color:var(--mut);margin:1.5mm 0 0}.st.signed{color:var(--red)}
.st.unreviewed,.st.unsigned{background:#fdf3e1;color:#7a4b00;padding:1mm 2.5mm;display:inline-block}
.badge{font-size:8pt;color:var(--a);border:.3mm solid var(--mid);padding:.2mm 2mm;border-radius:3mm}
.chosen{color:var(--red)}.ref{color:var(--mut);font-size:7pt}
.open{background:#fdf3e1;padding:5mm 6mm;margin:0 0 6mm;break-inside:avoid}.open h2{font-size:14pt}.open ul{margin:2mm 0 0;padding-left:4mm}
table.src{border-collapse:collapse;width:100%;font-size:8.5pt}table.src td,table.src th{border-bottom:.3mm solid var(--line);padding:2mm;text-align:left;vertical-align:top}table.src th{color:var(--mut);font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em}
a{color:var(--ink)}
.about{break-before:page}
.nda{border:.4mm solid var(--red);padding:4mm 5mm;margin:5mm 0;font-size:9pt}
.nda b{color:var(--red);display:block;letter-spacing:.12em;text-transform:uppercase;font-size:8pt;margin-bottom:1mm}
.facts4{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-top:5mm;font-size:8.5pt}.facts4 .card{padding:3mm 4mm}
#summary .card{font-size:8.5pt;padding:3mm 4mm}#summary .kpis{margin:2mm 0}#summary .quote{font-size:12.5pt;margin:3mm 0}#summary .call{font-size:8.5pt;margin:1.6mm 0;padding:1.2mm 0 1.2mm 3.5mm}#summary .call b{font-size:9pt}#summary .facts4{margin-top:3mm}#summary .lead{font-size:11pt}
.lead{font-size:12pt;line-height:1.45;color:#3a3a3a;margin-top:3mm;max-width:165mm}
.call{border-left:1mm solid var(--line);padding:2mm 0 2mm 4mm;margin:2.5mm 0;font-size:9pt;break-inside:avoid}
.call b{display:block;color:var(--ink);font-size:10pt;margin-bottom:.5mm}
.call.dec{border-left-color:var(--red)}.call.risk{border-left-color:#f0a93b}
.nums{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin:7mm 0 3mm}
.nums>div{border-top:1mm solid var(--a);padding-top:2.5mm}
.nums .big{font-size:20pt;line-height:1.1;color:var(--ink)}
.funnel{display:grid;gap:2mm;margin-top:4mm}
.fs{display:grid;grid-template-columns:1fr 42mm;gap:4mm;align-items:center}
.fb{background:var(--a);color:#fff;padding:2.5mm 4mm;font-size:9.5pt;margin:0 auto;text-align:center;min-height:9mm}
.fs:nth-child(2) .fb{background:color-mix(in srgb,var(--a) 80%,#fff)}.fs:nth-child(3) .fb{background:color-mix(in srgb,var(--a) 62%,#fff)}
.fn{font-size:8.5pt;color:var(--mut)}.fn b{color:var(--ink);font-size:11pt}
.opener h1{margin-top:2mm}
.webnav{display:none}.gwrap{overflow-x:auto}
@media screen{
html{scroll-behavior:smooth;scroll-padding-top:64px}
body{background:#eeeeec;font-size:15px}
.webnav{display:flex;position:sticky;top:0;z-index:20;gap:18px;align-items:center;justify-content:space-between;padding:10px 24px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);font-size:13px}
.webnav .brand{display:flex;align-items:center;gap:10px;color:var(--ink);white-space:nowrap}.webnav img{height:26px}
.webnav b{color:var(--red);border:1px solid var(--red);padding:1px 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.webnav .links{display:flex;gap:16px;overflow-x:auto;scrollbar-width:none}.webnav .links a{color:var(--mut);text-decoration:none;white-space:nowrap}.webnav .links a:hover{color:var(--ink)}
.doc{max-width:900px;margin:28px auto 80px;padding:0 16px}
.doc>section,.doc>.cover{background:#fff;padding:56px 64px;margin:0 0 24px;border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 30px rgba(0,0,0,.05)}
.cover{height:auto;min-height:620px;width:auto}
.opener{break-before:auto;padding-top:0}
.kpi,.card,.call,article{transition:transform .15s}.kpi:hover,.card:hover{transform:translateY(-2px)}
.bar .track{border-radius:4px;overflow:hidden}
.gantt tr:hover td{background:var(--soft)}
.wm span{font-size:90px}
@media (max-width:700px){body .doc>.cover{padding-left:44px}.cover .stamp{position:static;display:inline-block;justify-self:start;margin-bottom:14px;transform:none}.webnav{padding:10px 16px}.webnav .brand{min-width:0;flex-wrap:wrap}.webnav .brand>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40vw}.webnav b{font-size:9px}.fs{grid-template-columns:1fr}.doc>section,.doc>.cover{padding:28px 20px}.kpis,.nums,.facts4,.meta{grid-template-columns:1fr 1fr}.grid2,.ab,.swot{grid-template-columns:1fr}.swot>div{border-right:0!important;border-bottom:1px solid var(--line)}.gantt{min-width:620px}.bar .legend{flex-direction:column}.ab .arrow{display:none}h1{font-size:28px}.webnav .links{display:none}}
}
h1,h2,h3,h4,.big,.quote,.opener .num,.toc a,.swot .t,.fn b{font-family:var(--hf)}
${THEME_CSS[sty.theme]}
.wm{position:fixed;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}
.wm span{transform:rotate(-35deg);font-size:46pt;color:rgba(20,20,20,.05);white-space:nowrap;letter-spacing:.1em}
</style></head><body class="t-${sty.theme}">
${m.paid ? "" : `<div class="wm"><span>ASDIC™ · FREE</span></div>`}
<nav class="webnav"><span class="brand">${logo ? `<img src="${logo}" alt="">` : ""}<span>${e(m.brand?.companyName || m.planTitle)}</span>${chrome.confidential ? `<b>Конфиденциально</b>` : ""}</span><span class="links">${toc.map((t) => `<a href="#${t.id}">${e(t.title.replace(/^\d+\.\s*/, ""))}</a>`).join("")}</span></nav>
<main class="doc">${body}</main>
</body></html>`;
}

function cover(m: DocModel, logo: string | null, conf: boolean) {
  const full = m.kind === "full";
  const company = m.brand?.companyName || m.company.split(/[.\n]/)[0].slice(0, 80);
  return `<div class="cover">
${conf ? `<div class="stamp">Конфиденциально</div>` : ""}
<div class="logo">${logo ? `<img src="${logo}" alt="">` : company ? `<span class="name">${e(company)}</span>` : ""}</div>
<div class="mid">
<div class="kicker">${full ? "Стратегия развития" : `Этап ${e(m.stageNum)} · ${e(m.stageTitle)}`}</div>
<h1>${e(m.planTitle)}</h1>
<p class="sub">${full ? "Путь из точки A в точку B: анализ, стратегия, продукт, взаимодействие с клиентами и контроль" : `${e(m.stageTitleRu)}. ${e(m.question)}`}</p>
${m.pointA || m.pointB ? `<div class="ab"><div class="box"><span class="lbl">Точка A · сейчас</span>${e(clip(m.pointA, 260))}</div><div class="arrow">→</div><div class="box b"><span class="lbl">Точка B · цель</span>${e(clip(m.pointB, 260))}</div></div>` : ""}
</div>
<div>
<div class="meta">
<div><b>Подготовлено для</b>${e(m.brand?.preparedFor || company || "—")}</div>
<div><b>Дата</b>${e(m.preparedAt)}</div>
<div><b>Ответственный</b>${e(m.preparedBy)}</div>
</div>
<div class="made">${m.paid ? e(m.methodLine).replace("ASDIC™", TM) : `${e(m.methodLine).replace("ASDIC™", TM)} · сделано на платформе ${TM} с помощью ИИ`}</div>
</div></div>`;
}

function contents(toc: { id: string; title: string; sub?: string }[]) {
  return `<section class="toc"><h2>Содержание</h2><ol>${toc.map((t) => `<li><span><a href="#${t.id}">${e(t.title)}</a>${t.sub ? `<br><span class="cap">${e(t.sub)}</span>` : ""}</span></li>`).join("")}</ol></section>`;
}

function summary(m: DocModel, d: Dashboard) {
  const facts = [
    d.segment ? `<div class="card"><span class="lbl">Главный сегмент</span>${e(d.segment)}</div>` : "",
    d.budget ? `<div class="card"><span class="lbl">Бюджет</span><span style="font-size:13pt;color:var(--ink)">${e(d.budget.total)}</span><br><span class="cap">${e(clip(d.budget.split, 200))}</span></div>` : "",
    d.horizon ? `<div class="card"><span class="lbl">Горизонт</span>${e(d.horizon)}</div>` : "",
  ].filter(Boolean);
  const g = m.digest;
  const head = g
    ? `<div class="kicker">Стратегия на одной странице</div><h1 style="font-size:24pt;line-height:1.15">${e(g.headline)}</h1><p class="lead">${e(g.subline)}</p>`
    : `<div class="kicker">Сводка</div><h2>Стратегия на одной странице</h2>`;
  const calls = g
    ? `<div class="grid2" style="margin-top:6mm"><div><span class="lbl">Ключевые решения</span>${g.decisions.map((x, i) => `<div class="call dec"><b>${i + 1}. ${e(x.title)}</b>${e(x.why)}</div>`).join("")}</div><div><span class="lbl">Риски и ответ на них</span>${g.risks.map((x) => `<div class="call risk"><b>${e(x.risk)}</b>${e(x.answer)}</div>`).join("")}</div></div>`
    : "";
  return `<section id="summary" class="page">${head}
${g ? "" : `<div class="grid2" style="margin-top:5mm"><div class="card"><span class="lbl">Точка A · где бизнес сейчас</span>${e(m.pointA || "Не описана")}</div><div class="card tint"><span class="lbl">Точка B · куда идём</span>${e(m.pointB || "Не описана")}</div></div>`}
${d.positioning ? `<div class="quote">${e(d.positioning)}</div>` : ""}
${d.kpis.length ? `<span class="lbl" style="margin-top:6mm">Цели с цифрами</span><div class="kpis">${d.kpis.map(kpiCard).join("")}</div>` : `<p class="cap" style="margin-top:6mm">Цели с цифрами ещё не подписаны.</p>`}
${calls}
<div class="facts4">${facts.join("")}</div>
</section>`;
}

function kpiCard(k: Kpi) {
  const last = k.facts?.[k.facts.length - 1];
  return `<div class="kpi"><span class="lbl">${e(k.metric || k.goal)}</span>
<div class="big">${k.target != null ? fmtNum(k.target) : e(k.targetText)} <span class="unit">${e(k.unit)}</span></div>
<div class="from">сейчас ${k.current != null ? fmtNum(k.current) : e(k.currentText) || "—"}${k.deadline ? ` · к ${e(ruDay(k.deadline))}` : ""}</div>
${last ? `<div class="from" style="color:var(--a)">факт ${fmtNum(last.value)} на ${e(ruDay(last.date))}</div>${spark(k)}` : ""}
<div class="goal">${e(k.goal)}</div></div>`;
}

/** Мини-график факта по сверкам Контроля: линия факта и пунктир цели */
export function spark(k: Kpi, w = 150, h = 34) {
  const f = k.facts ?? [];
  if (f.length < 2 || k.target == null) return "";
  const vals = [...f.map((x) => x.value), k.target, k.current ?? k.target];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const y = (v: number) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  const x = (i: number) => 2 + (i / (f.length - 1)) * (w - 4);
  const pts = f.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return `<svg class="facts" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${y(k.target)}" y2="${y(k.target)}" stroke="#141414" stroke-width=".8" stroke-dasharray="3 2"/><polyline points="${pts}" fill="none" stroke="var(--a)" stroke-width="1.6"/></svg>`;
}

function charts(d: Dashboard) {
  const nums = d.kpis.filter((k) => k.target != null);
  const bars = nums
    .map((k) => {
      const fact = k.facts?.[k.facts.length - 1]?.value;
      const max = Math.max(k.target!, k.current ?? 0, fact ?? 0) * 1.08 || 1;
      const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
      return `<div class="bar"><h4>${e(k.metric || k.goal)}</h4><div class="track">
${k.current != null ? `<div class="fill" style="width:${pct(k.current)}"></div>` : ""}
${fact != null ? `<div class="fact" style="width:${pct(fact)}"></div>` : ""}
<div class="tick" style="left:${pct(k.target!)}"></div></div>
<div class="legend"><span>A: ${k.current != null ? fmtNum(k.current) : "—"} ${e(k.unit)}${fact != null ? ` · факт: ${fmtNum(fact)}` : ""}</span><span>B: ${fmtNum(k.target!)} ${e(k.unit)}${k.deadline ? ` к ${e(ruDay(k.deadline))}` : ""}</span></div></div>`;
    })
    .join("");
  return `<section id="charts" class="page"><div class="kicker">Цифры</div>${funnel(d)}<h2>Цели: где мы и куда идём</h2>
${nums.length ? `<p class="cap">Светлая полоса: точка A. Чёрная отметка: цель. Тёмная полоса: факт последней сверки Контроля.</p><div class="bars">${bars}</div>` : `<p class="cap">Числовых целей пока нет.</p>`}
${gantt(d)}
<div style="break-inside:avoid"><h2 style="margin-top:6mm">SWOT</h2><p class="cap">Сильные и слабые стороны из анализа компании, возможности и угрозы из анализа рынка. Только проверенные записи.</p>
<div class="swot">${quad("Сильные стороны", "S", d.swot.strengths)}${quad("Слабые стороны", "W", d.swot.weaknesses)}${quad("Возможности", "O", d.swot.opportunities)}${quad("Угрозы", "T", d.swot.threats)}</div></div>
</section>`;
}

function funnel(d: Dashboard) {
  const f = d.funnel;
  if (!f) return "";
  const max = Math.max(...f.steps.map((x) => x.month)) || 1;
  const col = f.verdict === "realistic" ? "#3dbe8b" : f.verdict === "stretch" ? "#f0a93b" : f.verdict === "unrealistic" ? RED : "#7d7d7a";
  const r = (n: number) => fmtNum(n >= 100 ? Math.ceil(n) : Math.ceil(n * 10) / 10);
  return `<div style="break-inside:avoid;margin-bottom:8mm"><h2>Что нужно, чтобы прийти к ${fmtNum(f.revenue)}${f.currency ? " " + e(f.currency) : ""}</h2>
<p class="cap">Расчёт цели на ${fmtNum(f.months)} мес.: от дохода к продажам, заявкам и обращениям. <span style="color:${col}">● ${e(f.verdictText)}</span></p>
<div class="funnel">${f.steps
    .map((x) => `<div class="fs"><div class="fb" style="width:${Math.max(30, Math.sqrt(x.month / max) * 100).toFixed(1)}%"><span>${e(x.label)}</span></div><div class="fn"><b>${r(x.month)}</b> в месяц<br><b>${r(x.day)}</b> в день</div></div>`)
    .join("")}</div></div>`;
}

function quad(t: string, l: string, xs: string[]) {
  return `<div><div class="t">${t}<span>${l}</span></div>${xs.length ? `<ul>${xs.slice(0, 8).map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : `<p class="cap" style="margin-top:2mm">Нет проверенных записей</p>`}</div>`;
}

function gantt(d: Dashboard) {
  if (!d.range || !d.timeline.length) return `<h2 style="margin-top:4mm">Дорожная карта</h2><p class="cap">Действия, запуски и контрольные точки с датами пока не заданы.</p>`;
  const from = new Date(d.range.from);
  const to = new Date(d.range.to);
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1);
  const endD = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 1));
  const span = endD.getTime() - start || 1;
  const months: Date[] = [];
  for (let t = new Date(start); t < endD; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))) months.push(t);
  const step = Math.ceil(months.length / 12);
  const pos = (iso: string) => Math.max(0, Math.min(100, ((new Date(iso).getTime() - start) / span) * 100));
  const grid = months.map((mm) => `<i class="grid" style="left:${pos(mm.toISOString()).toFixed(2)}%"></i>`).join("");
  const rows = d.timeline.slice(0, 28);
  const head = months
    .map((mm, i) => (i % step === 0 ? `<span style="position:absolute;left:${pos(mm.toISOString()).toFixed(2)}%">${mm.toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" }).replace(".", "")}${mm.getUTCMonth() === 0 || i === 0 ? " " + String(mm.getUTCFullYear()).slice(2) : ""}</span>` : ""))
    .join("");
  return `<div style="break-inside:avoid"><h2 style="margin-top:4mm">Дорожная карта</h2>
<div class="keys"><span><i style="background:var(--a)"></i>Действие</span><span><i style="background:var(--red)"></i>Запуск (решение человека)</span><span><i style="border:.4mm solid #141414"></i>Контрольная точка</span><span><i style="background:#141414"></i>Срок цели</span></div>
<div class="gwrap"><table class="gantt"><colgroup><col style="width:38%"><col style="width:14%"><col></colgroup>
<tr><th>Что</th><th>Кто</th><th><div class="lane" style="height:3mm">${head}</div></th></tr>
${rows.map((r) => `<tr><td>${e(clip(r.label, 70))}</td><td class="cap">${e(r.owner ?? "")}</td><td><div class="lane">${grid}<i class="m ${r.kind}" title="${e(r.label)} · ${e(ruDay(r.date))}" style="left:${pos(r.date).toFixed(2)}%"></i></div></td></tr>`).join("")}
</table></div>${d.timeline.length > rows.length ? `<p class="cap">Показаны первые ${rows.length} из ${d.timeline.length}. Полный список в главах ниже.</p>` : ""}</div>`;
}

function part(num: string, titleRu: string, title: string, question: string, sections: DocSection[], i: number, full: boolean, g?: { actionTitle: string; takeaway: string; numbers: { value: string; label: string }[] }) {
  const head = full
    ? g
      ? `<div class="opener" id="part-${i}"><div class="kicker">${e(num)} · ${e(titleRu)} · ${e(title)}</div><h1 style="font-size:26pt;line-height:1.15">${e(g.actionTitle)}</h1>
${g.numbers.length ? `<div class="nums">${g.numbers.map((n) => `<div><div class="big">${e(n.value)}</div><span class="cap">${e(n.label)}</span></div>`).join("")}</div>` : ""}
<p class="lead">${e(g.takeaway)}</p></div>`
      : `<div class="opener" id="part-${i}"><div class="num">${e(num)}</div><h1>${e(titleRu)}</h1><p class="q">${e(title)} · ${e(question)}</p></div>`
    : `<div class="stagehead" id="part-${i}"><div class="kicker">Этап ${e(num)}</div><h2>${e(titleRu)}</h2><p class="cap">${e(question)}</p></div>`;
  return `<section>${head}${sections.map(sectionHtml).join("")}</section>`;
}

function sectionHtml(s: DocSection) {
  return `<h3><i class="dot ${s.mode}"></i>${e(s.title)}</h3><p class="secdesc">${e(s.modeLabel)}. ${e(s.description)}</p>
${s.items.length ? s.items.map(itemHtml).join("") : `<p class="cap">Записей пока нет.</p>`}`;
}

function itemHtml(it: DocItem) {
  return `<article class="${it.status.kind}"><h4>${e(it.title)}${it.badge ? ` <span class="badge">${e(it.badge)}</span>` : ""}</h4>
<ul>${it.fields.map((f) => `<li><span class="lbl">${e(f.label)}</span>${e(f.value).replace(/\n/g, "<br>")}${f.refs.map((n) => `<sup class="ref">[${n}]</sup>`).join("")}</li>`).join("")}
${it.options?.length ? `<li><span class="lbl">Рассмотренные варианты</span>${it.options.map((o) => (o.chosen ? `<span class="chosen">${e(o.title)} (выбран)</span>` : e(o.title))).join("; ")}</li>` : ""}</ul>
<p class="st ${it.status.kind}">${e(it.status.text)}</p></article>`;
}

function sourcesBlock(m: DocModel) {
  return `<section id="sources" class="page"><h2>Источники</h2><p class="cap">Каждая цитата в документе сверена с текстом источника.</p><table class="src"><tr><th>Источник</th><th>Где использован</th></tr>${m.sources
    .map((s) => `<tr><td>[${s.n}] ${s.url ? `<a href="${e(s.url)}">${e(s.title)}</a>` : e(s.title)}</td><td>${s.citedBy.map(e).join("<br>")}</td></tr>`)
    .join("")}</table></section>`;
}

function about(m: DocModel, conf: boolean) {
  const b = m.brand;
  return `<section id="about" class="about"><h2>О документе</h2>
<p>${e(m.methodLine).replace("ASDIC™", TM)}. Метод ведёт бизнес из точки A в точку B через пять этапов: Analysis, Strategy, Design, Interaction, Control.</p>
<p>Решения на ключевых уровнях (цели, сегменты, позиционирование, бюджет, продукт, запуски) приняли и подписали ответственные лица, они отмечены красным. ${m.paid ? "Остальные записи проверены ответственными." : "Записи, сделанные ИИ, проверяет человек; непроверенные отмечены в тексте."}</p>
<p class="cap">Документ не является гарантией результата. Цифры целей — плановые; факт сверяется на этапе Control.</p>
${conf ? `<div class="nda"><b>Конфиденциально</b>${e(b?.ndaText || DEFAULT_NDA)}</div>` : ""}
${b?.contact ? `<div class="card" style="margin-top:5mm"><span class="lbl">Контакты</span>${e(b.contact).replace(/\n/g, "<br>")}</div>` : ""}
<p class="cap" style="margin-top:8mm">Собрано ${e(m.preparedAt)} · ${e(m.preparedBy)}${m.paid ? "" : ` · платформа ${TM}, бесплатная версия`}</p>
</section>`;
}

function clip(s: string, n: number) {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** Оформление тем поверх общей вёрстки. Сетка, графики и адаптивность общие. */
const THEME_CSS: Record<ThemeKey, string> = {
  minimal: "",
  consulting: `
.t-consulting h1,.t-consulting h2{font-weight:700;letter-spacing:-.005em}
.t-consulting h3,.t-consulting h4,.t-consulting .swot .t{font-weight:700}
.t-consulting .cover:before{width:auto;right:0;height:10mm;bottom:auto}
.t-consulting .kicker{font-family:var(--bf);font-weight:600;font-size:8.5pt;letter-spacing:.18em}
.t-consulting h3{border-bottom:.3mm solid var(--line);padding-bottom:1.5mm}
.t-consulting .quote{font-style:italic}
.t-consulting .kpi,.t-consulting .nums>div{border-top-width:.6mm}
.t-consulting .big{font-weight:700}
.t-consulting .opener .num{font-weight:700}
.t-consulting table.src th,.t-consulting .gantt th{background:var(--soft);color:var(--ink)}
.t-consulting .lbl,.t-consulting .meta b{font-weight:600}
@media screen{.t-consulting .doc>section,.t-consulting .doc>.cover{border-radius:2px}.t-consulting body,body.t-consulting{background:#e9ebef}}
@media screen and (max-width:700px){body.t-consulting .doc>.cover{padding-left:20px;padding-top:44px}}`,
  startup: `
.t-startup h1{font-weight:800;letter-spacing:-.025em}
.t-startup h2{font-weight:800;letter-spacing:-.015em}
.t-startup h3,.t-startup h4,.t-startup .swot .t{font-weight:700}
.t-startup .cover{background:radial-gradient(120mm 120mm at 100% 0,var(--mid),transparent 70%),linear-gradient(160deg,var(--soft),#fff 55%)}
.t-startup .cover:before{display:none}
.t-startup .cover h1{font-size:40pt}
.t-startup .kicker{display:inline-block;background:var(--a);color:#fff;padding:1mm 3.5mm;border-radius:10mm;font-size:8pt;font-weight:700;letter-spacing:.1em}
.t-startup .card,.t-startup .call,.t-startup .open,.t-startup .nda{border-radius:4mm}
.t-startup .kpi,.t-startup .nums>div{border-top:0;background:var(--soft);padding:4mm 5mm;border-radius:4mm}
.t-startup .big{font-weight:800;color:var(--a)}
.t-startup .ab div.box{border:0;background:#fff;border-radius:4mm;padding:3mm 4mm;box-shadow:0 1mm 4mm rgba(0,0,0,.06)}
.t-startup .ab div.box.b{background:var(--a);color:#fff}.t-startup .ab div.box.b .lbl{color:rgba(255,255,255,.75)}
.t-startup .swot{border-radius:4mm;overflow:hidden}
.t-startup .bar .track,.t-startup .bar .fill,.t-startup .bar .fact,.t-startup .hb .tr,.t-startup .hb .fl{border-radius:2mm}
.t-startup .fb{border-radius:3mm}
.t-startup .dot{border-radius:50%}
.t-startup .gantt .lane .m{border-radius:50%;transform:translateX(-50%)}
.t-startup article{border-left-width:1mm;border-radius:0 2mm 2mm 0}
.t-startup .lbl,.t-startup .meta b{font-weight:700}
@media screen{.t-startup .doc>section,.t-startup .doc>.cover{border-radius:24px}body.t-startup{background:#f1f0f7}}
@media screen and (max-width:700px){.t-startup .kpis,.t-startup .nums{grid-template-columns:1fr}.t-startup .kpi,.t-startup .nums>div{min-width:0}}`,
  premium: `
.t-premium h1,.t-premium h2,.t-premium h3{font-weight:500;letter-spacing:0}
.t-premium h4,.t-premium .swot .t{font-weight:600}
.t-premium .cover{background:#111;color:#d9d3c7}
.t-premium .cover:before{width:auto;left:20mm;right:20mm;top:auto;bottom:0;height:1.2mm}
.t-premium .cover h1{color:#fff;font-size:40pt;font-weight:500}
.t-premium .cover .sub,.t-premium .cover .made{color:#a59e91}
.t-premium .cover .meta{border-top-color:#333}.t-premium .cover .meta b,.t-premium .cover .lbl{color:var(--a)}
.t-premium .cover .ab div.box{border-top-color:#333}.t-premium .cover .ab div.box.b{border-top-color:var(--a)}
.t-premium .cover .logo .name{color:#fff}
.t-premium .cover .logo img{background:#fff;padding:2mm 3mm;border-radius:1mm}
.t-premium .kicker{letter-spacing:.32em;font-size:8pt}
.t-premium .quote{font-style:italic;border-left-width:.4mm;font-size:17pt}
.t-premium .kpi,.t-premium .nums>div{border-top:.3mm solid var(--a)}
.t-premium .big{font-weight:500}
.t-premium .opener .num{font-style:italic;font-weight:400}
.t-premium .toc li:before{font-family:var(--hf);font-style:italic}
.t-premium .fb{background:#1b1b1b!important;color:#f3e6c8;border-bottom:.6mm solid var(--a)}
.t-premium .lbl,.t-premium .meta b{letter-spacing:.2em}
@media screen{body.t-premium{background:#e8e5df}.t-premium .doc>.cover{background:#111}.t-premium .webnav{background:rgba(17,17,17,.94);border-bottom-color:#2a2a2a}.t-premium .webnav .brand{color:#fff}.t-premium .webnav .links a{color:#a59e91}.t-premium .webnav .links a:hover{color:#fff}}`,
};

/** Глубокая стратегия: юнит-экономика, каналы, сценарии, бенчмарки и контент-план */
function deepSection(x: DeepBlocks) {
  const r = (n: number) => fmtNum(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  const blocks: string[] = [];
  if (x.unit) {
    const col = x.unit.verdict === "healthy" ? "#3dbe8b" : x.unit.verdict === "thin" ? "#f0a93b" : RED;
    blocks.push(`<div style="break-inside:avoid"><h2>Юнит-экономика${x.unit.name ? `: ${e(x.unit.name)}` : ""}</h2><p class="cap">Сколько приносит один клиент и сколько стоит его привлечь. <span style="color:${col}">● ${e(x.unit.verdictText)}</span></p>
<div class="nums">${x.unit.cards.map((c) => `<div><div class="big">${e(c.value)}</div><span class="cap">${e(c.label)}</span></div>`).join("")}</div></div>`);
  }
  if (x.channels) {
    const max = Math.max(...x.channels.rows.map((c) => c.leads)) || 1;
    const cur = x.channels.currency ? " " + e(x.channels.currency) : "";
    const total = x.channels.rows.reduce((a, c) => a + c.budget, 0);
    const leads = x.channels.rows.reduce((a, c) => a + c.leads, 0);
    blocks.push(`<div style="break-inside:avoid;margin-top:8mm"><h2>Бюджет по каналам и прогноз заявок</h2><p class="cap">Всего ${fmtNum(Math.round(total))}${cur} в месяц, около ${r(leads)} заявок. Длина полосы: заявки в месяц.</p>
<div class="hbars">${x.channels.rows
      .map(
        (c) =>
          `<div class="hb"><span class="nm">${e(c.channel)}</span><span class="tr"><span class="fl" style="width:${Math.max(3, (c.leads / max) * 100).toFixed(1)}%"></span></span><span class="vl"><b>${r(c.leads)}</b> заявок${c.sales != null ? ` · ${r(c.sales)} продаж` : ""}<br><span class="cap">${fmtNum(Math.round(c.budget))}${cur} в мес.</span></span></div>`,
      )
      .join("")}</div></div>`);
  }
  if (x.scenarios) {
    const max = Math.max(x.scenarios.base, ...x.scenarios.rows.map((s) => s.leadsDay)) * 1.1 || 1;
    const row = (name: string, v: number, base: boolean, note = "") =>
      `<div class="hb${base ? " base" : ""}"><span class="nm">${e(name)}</span><span class="tr"><span class="fl" style="width:${Math.max(3, (v / max) * 100).toFixed(1)}%"></span><i class="mk" style="left:${((x.scenarios!.base / max) * 100).toFixed(1)}%"></i></span><span class="vl"><b>${r(v)}</b> заявок в день${note ? `<br><span class="cap">${e(clip(note, 90))}</span>` : ""}</span></div>`;
    blocks.push(`<div style="break-inside:avoid;margin-top:8mm"><h2>Сценарии «что если»</h2><p class="cap">Сколько заявок в день нужно для той же цели при другой цене или конверсии. Вертикальная черта: базовый расчёт.</p>
<div class="hbars">${row("Базовый расчёт", x.scenarios.base, true)}${x.scenarios.rows.map((s) => row(s.name, s.leadsDay, false, s.comment)).join("")}</div></div>`);
  }
  if (x.benchmarks?.length)
    blocks.push(`<div style="break-inside:avoid;margin-top:8mm"><h2>Бенчмарки ниши</h2><table class="src"><tr><th>Показатель</th><th>В нише</th><th>У нас</th></tr>${x.benchmarks.map((b) => `<tr><td>${e(b.metric)}</td><td>${e(b.niche)}</td><td>${e(b.ours || "—")}</td></tr>`).join("")}</table></div>`);
  if (x.content?.length)
    blocks.push(`<div style="margin-top:8mm"><h2>Контент-план на 90 дней</h2><div class="gwrap"><table class="src cp"><tr><th>Неделя</th><th>Тема</th><th>Канал</th><th>Формат</th><th>Призыв</th></tr>${x.content
      .map((c) => `<tr><td>${e(c.week)}</td><td>${e(c.topic)}</td><td>${e(c.channel)}</td><td>${e(c.format)}</td><td>${e(c.cta)}</td></tr>`)
      .join("")}</table></div></div>`);
  return `<section id="economics" class="page"><div class="kicker">Глубокая стратегия</div>${blocks.join("")}</section>
<style>.hbars{display:grid;gap:3mm;margin-top:4mm}.hb{display:grid;grid-template-columns:42mm 1fr 44mm;gap:4mm;align-items:center;font-size:9pt;break-inside:avoid}.hb .tr{position:relative;height:6mm;background:#f3f3f1}.hb .fl{position:absolute;left:0;top:0;bottom:0;background:var(--a)}.hb.base .fl{background:var(--mid)}.hb .mk{position:absolute;top:-1mm;bottom:-1mm;width:.5mm;background:var(--ink)}.hb .vl b{color:var(--ink)}table.cp td:first-child{white-space:nowrap}@media screen and (max-width:700px){.hb{grid-template-columns:1fr;gap:1.5mm}table.cp{min-width:560px}}</style>`;
}
