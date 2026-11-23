import "server-only";
import { createHash } from "node:crypto";
import { composePrompt, type Aspect, type ImageProvider } from "../provider";

/**
 * Тестовая заглушка без ключей: рисует абстрактную SVG-композицию, цвета зависят от промпта.
 * Нужна, чтобы проверить весь путь (промпт → картинка → решение) до подключения провайдера.
 */
const DIM: Record<Aspect, [number, number]> = { "1:1": [1024, 1024], "4:5": [1024, 1280], "9:16": [900, 1600], "16:9": [1600, 900] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mockProvider(): ImageProvider {
  return {
    id: "mock",
    label: "Тестовая заглушка",
    mock: true,
    maxPrompt: 500,
    async generate(req) {
      const text = composePrompt(req, 500);
      const h = createHash("sha256").update(text + (req.seed ?? Math.random())).digest();
      const [w, ht] = DIM[req.aspect];
      const hue = (i: number) => Math.round((h[i] / 255) * 360);
      const circles = Array.from({ length: 6 }, (_, i) => {
        const cx = Math.round((h[i + 3] / 255) * w);
        const cy = Math.round((h[i + 9] / 255) * ht);
        const r = Math.round(((h[i + 15] / 255) * 0.35 + 0.1) * Math.min(w, ht));
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue(i)} 60% 55%)" opacity="0.55"/>`;
      }).join("");
      const lines = text.match(/.{1,60}(\s|$)/g)?.slice(0, 4) ?? [];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue(0)} 35% 18%)"/><stop offset="1" stop-color="hsl(${hue(1)} 45% 8%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>${circles}
<text x="40" y="${ht - 40 - lines.length * 30}" fill="#fff" font-family="sans-serif" font-size="22" opacity="0.85">ТЕСТОВАЯ КАРТИНКА · провайдер не подключён</text>
${lines.map((l, i) => `<text x="40" y="${ht - 40 - (lines.length - 1 - i) * 30}" fill="#fff" font-family="sans-serif" font-size="20" opacity="0.6">${esc(l.trim())}</text>`).join("")}
</svg>`;
      return { bytes: Buffer.from(svg), mime: "image/svg+xml", ext: ".svg", model: "mock", costUsd: 0 };
    },
  };
}
