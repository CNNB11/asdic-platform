import "server-only";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML → PDF. Колонтитулы на всех страницах, кроме обложки (у неё нулевые поля через @page :first). */
export async function htmlToPdf(html: string, chrome?: { left: string; right: string; footer: string; confidential: boolean }): Promise<Buffer> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const box = "font-family:sans-serif;font-size:7.5px;color:#8a8a87;width:100%;padding:0 18mm;display:flex;justify-content:space-between;letter-spacing:.04em";
    const right = chrome?.confidential ? `<span style="color:#e4343f;text-transform:uppercase;letter-spacing:.14em">${esc(chrome.right)}</span>` : `<span>${esc(chrome?.right ?? "")}</span>`;
    const opts = { preferCSSPageSize: true, printBackground: true } as const;
    // Обложка без колонтитулов, остальное с ними; потом склеиваем
    const cover = await page.pdf({ ...opts, pageRanges: "1" });
    let body: Uint8Array | null = null;
    try {
      body = await page.pdf({
        ...opts,
        pageRanges: "2-",
        displayHeaderFooter: true,
        headerTemplate: `<div style="${box};padding-top:9mm"><span>${esc(chrome?.left ?? "")}</span>${right}</div>`,
        footerTemplate: `<div style="${box};padding-bottom:7mm"><span>${esc(chrome?.footer ?? "")}</span><span><span class="pageNumber"></span></span></div>`,
      });
    } catch {
      return Buffer.from(cover); // документ из одной страницы
    }
    const out = await PDFDocument.create();
    for (const src of [cover, body]) {
      const doc = await PDFDocument.load(src);
      (await out.copyPages(doc, doc.getPageIndices())).forEach((pg) => out.addPage(pg));
    }
    return Buffer.from(await out.save());
  } finally {
    await browser.close();
  }
}
