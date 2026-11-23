import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { structured } from "@/lib/ai/provider";
import { costUsd } from "@/lib/ai/telemetry";
import { ImageError, type Aspect, type ImageProvider, type ImageRequest } from "../provider";
import { sanitizeHtml, sanitizeSvg } from "../sanitize";

/**
 * Визуал кодом. Claude не рисует фотографии, зато верстает:
 * - бренд-борд (мудборд, концепт): HTML-страница со знаком в SVG, семейством версий знака, палитрой с HEX,
 *   типографикой, примерами применения и принципами — уровень презентации дизайн-студии;
 * - макет креатива (реклама, пост, первый экран): SVG точного размера с настоящим текстом.
 * Скрипты запрещены: страницы показываются в песочнице, движение только на CSS.
 */

export const DIM: Record<Aspect, [number, number]> = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "16:9": [1920, 1080] };

/** Шрифты с кириллицей, которые можно подключать с Google Fonts */
const FONTS = "Onest, Golos Text, Manrope, Geologica, Inter, Unbounded, Montserrat, IBM Plex Sans, IBM Plex Mono, JetBrains Mono, Rubik, Raleway, Playfair Display, Lora, PT Serif";

export const isBoard = (kind?: string) => kind === "moodboard" || kind === "concept";

const BOARD_SYSTEM = `Ты арт-директор сильной дизайн-студии. Ты делаешь бренд-борд кодом: один самодостаточный HTML-документ, который показывает визуальный язык целиком, как в презентации студии для клиента.

Состав борда (сверху вниз, каждый раздел с крупным заголовком и коротким пояснением справа):
1. Первый экран: крупное имя или главная фраза и живой знак (inline SVG), выразительная композиция на всю ширину, подпись с названием направления моноширинным шрифтом.
2. Знак и логотип: идея знака одной фразой; основной логотип (знак + имя); знак отдельно на акцентном фоне; ряд размеров 96/48/32/20 px и вкладка браузера 16 px — знак должен читаться в 16 px.
3. Семейство: 3–4 карточки, где один принцип знака меняется под продукты, сегменты или направления компании из плана (если их нет — под точки пути клиента).
4. Цвет и шрифт: 4–6 плашек палитры с HEX и ролью цвета; типографика — огромный образец заголовка, образец абзаца с реальной фразой из плана, название и начертания шрифта.
5. В деле: одно применение, которое важно для сегмента (экран сайта или приложения, КП, стенд, пост) — свёрстанное в HTML/CSS мокапом.
6. Принципы: три принципа визуального языка (заголовок + 1–2 предложения) и абзац «почему это работает», со ссылкой на позиционирование и большую идею.

Техника:
- <!doctype html>, <meta charset="utf-8">, весь CSS в одном <style>; CSS-переменные для палитры; сетка на CSS grid, max-width около 1240px, щедрые поля (секции по 96px), скругления, карточки.
- Шрифты: можно подключить один <link> на https://fonts.googleapis.com/css2 с 1–2 семействами из списка: ${FONTS}; плюс моноширинный для подписей. Space Grotesk встроен локально, его подключать не нужно. В font-family всегда указывай запасные шрифты.
- Знаки и графика только inline SVG и CSS (градиенты, формы, линии). Без <img>, без фотографий, без внешних картинок.
- Никаких <script>, обработчиков событий, iframe и форм. Движение допустимо только CSS-анимацией (@keyframes), спокойное, с @media (prefers-reduced-motion: reduce).
- Выразительные средства уровня студии: «жидкий» фон из крупных размытых градиентных пятен (filter: blur, медленная CSS-анимация), матовое стекло (backdrop-filter), SVG-фильтры feTurbulence/feDisplacementMap для фактуры и отражений, крупная типографика с отрицательным трекингом (-0.03…-0.055em), моноширинные подписи капсом с разрядкой. Используй их по смыслу идеи, а не всё сразу.
- У направления есть имя (например, «A · Точка») и одна сильная метафора знака, которая следует из большой идеи; знак строится из простых форм и узнаётся в 16 px.
- Ширина страницы должна работать от 1280px до 360px; ничего не выходит за край карточки или экрана: огромные образцы шрифта задавай через clamp() и проверяй длину слов, у блоков min-width:0.
- Тексты на русском, конкретные, взятые из плана: позиционирование, большая идея, сегмент, продукт. Не выдумывай цифры, отзывы и клиентов; если нужен пример цифры, бери из плана или пиши нейтрально.
- Цвета бренда бери из записей «Бренд»; если их нет, предложи палитру, отличную от цветов конкурентов из анализа.`;

const KIND_TASK: Record<string, string> = {
  ad: `Рекламный креатив. Заголовок крупно (до 7 слов), подзаголовок с пользой, кнопка или призыв, имя компании. Графика поддерживает мысль заголовка. Поля безопасности 64 px.`,
  social: `Пост или обложка для соцсети. Короткий заголовок крупно, одна строка пояснения, имя компании мелко. Читается на экране телефона.`,
  site: `Первый экран сайта: шапка с именем и 3–4 пунктами меню, заголовок, подзаголовок, кнопка, векторный образ справа или фоном.`,
};

const SVG_SYSTEM = `Ты арт-директор и верстальщик сильной дизайн-студии. Ты делаешь макет креатива кодом: один самодостаточный SVG-документ, готовый к публикации.

Правила SVG:
- корневой <svg xmlns="http://www.w3.org/2000/svg"> с заданными width, height и viewBox;
- только векторные элементы: rect, circle, ellipse, line, polyline, polygon, path, g, text, tspan, defs, linearGradient, radialGradient, pattern, clipPath, mask, filter, style;
- без <script>, <foreignObject>, <image>, внешних ссылок и обработчиков событий;
- текст только <text>/<tspan>; переносы делай сам через tspan; строки не выходят за поля и не налезают друг на друга (ширина символа примерно 0,55 × кегль для гротеска);
- шрифт: font-family="Space Grotesk, Arial, sans-serif", если бренд не задаёт другой; заголовки крупно с отрицательным трекингом (letter-spacing около -0.03em);
- цвета только из палитры бренда; акцент точечно; композиция с ясной иерархией, воздухом и одним сильным графическим образом (знак, форма, ритм линий), а не набором случайных фигур;
- текст на русском, конкретный, из плана; никаких выдуманных цифр, отзывов и чужих логотипов.`;

let fontB64: string | null = null;
async function localFontCss() {
  fontB64 ??= (await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "src/fonts/SpaceGrotesk-Regular.woff2"))).toString("base64");
  return `@font-face{font-family:"Space Grotesk";src:url(data:font/woff2;base64,${fontB64}) format("woff2");font-weight:300 700}`;
}

function context(req: ImageRequest) {
  return `${req.brief ?? ""}

<visual_brief>
${req.prompt}
</visual_brief>
${req.avoid?.trim() ? `<avoid>${req.avoid.trim()}</avoid>\n` : ""}`;
}

const variantNote = (req: ImageRequest) =>
  req.variant && req.variant.of > 1 ? `\nЭто направление ${req.variant.n} из ${req.variant.of}: сделай его заметно отличным от других по идее знака, палитре и композиции.` : "";

const schema = (key: string) => ({
  type: "object",
  properties: { [key]: { type: "string" }, notes: { type: "string" } },
  required: [key, "notes"],
  additionalProperties: false,
});

export function claudeSvgProvider(): ImageProvider {
  return {
    id: "claude",
    label: "Claude (вёрстка кодом)",
    maxPrompt: 8000,
    selfLogged: true,
    async generate(req) {
      const board = isBoard(req.kind);
      const { data, usage } = board
        ? await structured<{ html: string; notes: string }>({
            system: BOARD_SYSTEM,
            effort: "medium",
            maxTokens: 32000,
            parts: [{ text: `${context(req)}<task>Сделай бренд-борд по этой концепции.${variantNote(req)}\nВерни HTML в поле html и в notes одной-двумя фразами идею знака и на какие записи плана опирался.</task>` }],
            schema: schema("html"),
          }).then((r) => ({ data: { code: r.data.html, notes: r.data.notes }, usage: r.usage }))
        : await structured<{ svg: string; notes: string }>({
            system: SVG_SYSTEM,
            effort: "medium",
            maxTokens: 24000,
            parts: [
              {
                text: `${context(req)}<task>${KIND_TASK[req.kind ?? ""] ?? KIND_TASK.ad}\nРазмер холста: ${DIM[req.aspect][0]}×${DIM[req.aspect][1]} px (формат ${req.aspect}).${variantNote(req)}\nВерни SVG в поле svg и в notes одной-двумя фразами, какие решения принял и на какие записи плана опирался.</task>`,
              },
            ],
            schema: schema("svg"),
          }).then((r) => ({ data: { code: r.data.svg, notes: r.data.notes }, usage: r.usage }));

      const font = await localFontCss();
      const out = board ? sanitizeHtml(data.code, font) : sanitizeSvg(data.code, font);
      if (out.length > 3_000_000) throw new ImageError("Макет получился слишком большим. Попробуйте ещё раз.");
      return {
        bytes: Buffer.from(out),
        mime: board ? "text/html" : "image/svg+xml",
        ext: board ? ".html" : ".svg",
        model: usage.model,
        costUsd: costUsd(usage.model, { input: usage.inputTokens, output: usage.outputTokens, cacheRead: 0, cacheWrite: 0, searches: 0 }),
        notes: data.notes,
      };
    },
  };
}
