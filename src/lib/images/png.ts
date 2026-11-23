import "server-only";
import { chromium } from "playwright-core";

/** Растеризация визуала в PNG тем же Chromium, что печатает PDF. Скрипты на странице выключены. */
export async function visualToPng(bytes: Buffer, mime: string): Promise<Buffer> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    args: ["--no-sandbox"],
  });
  try {
    if (mime === "image/svg+xml") {
      const svg = bytes.toString("utf8");
      const m = svg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/) ?? svg.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/);
      const w = Math.round(Number(m?.[1] ?? 1080));
      const h = Math.round(Number(m?.[2] ?? 1080));
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, javaScriptEnabled: false });
      await page.setContent(
        `<html><body style="margin:0"><img src="data:image/svg+xml;base64,${bytes.toString("base64")}" width="${w}" height="${h}" style="display:block"></body></html>`,
        { waitUntil: "load" },
      );
      return Buffer.from(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } }));
    }
    // Бренд-борд: страница шириной 1440, снимок целиком
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, javaScriptEnabled: false, reducedMotion: "reduce" });
    await page.setContent(bytes.toString("utf8"), { waitUntil: "networkidle", timeout: 30_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    // Ширину режем по окну: элемент, вылезший за край, не должен расширять снимок
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 4000);
    return Buffer.from(await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: 1440, height } }));
  } finally {
    await browser.close();
  }
}
