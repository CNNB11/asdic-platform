import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { structured } from "@/lib/ai/provider";
import { costUsd } from "@/lib/ai/telemetry";
import { ImageError, type Aspect, type ImageProvider, type ImageRequest } from "../provider";
import { sanitizeHtml, sanitizeSvg, stripInjected } from "../sanitize";
import { catalogBlock, embeddedFontCss } from "../fonts";

/**
 * Визуал кодом. Claude не рисует фотографии, зато верстает:
 * - бренд-борд (мудборд, концепт): HTML-страница со знаком в SVG, семейством версий знака, палитрой с HEX,
 *   типографикой, примерами применения и принципами — уровень презентации дизайн-студии;
 * - макет креатива (реклама, пост, первый экран): SVG точного размера с настоящим текстом.
 * Скрипты запрещены: страницы показываются в песочнице, движение только на CSS.
 */

export const DIM: Record<Aspect, [number, number]> = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "16:9": [1920, 1080] };

/** Шрифты с кириллицей, которые можно подключать с Google Fonts */

export const isBoard = (kind?: string) => kind === "moodboard" || kind === "concept";

const BOARD_SYSTEM = `Ты арт-директор сильной дизайн-студии. Ты делаешь бренд-борд кодом: один самодостаточный HTML-документ, который показывает визуальный язык целиком, как в презентации студии для клиента.

Состав борда (сверху вниз, каждый раздел с крупным заголовком и коротким пояснением справа):
1. Первый экран: крупное имя или главная фраза и живой знак (inline SVG), выразительная композиция на всю ширину, подпись с названием направления моноширинным шрифтом.
2. Знак и логотип: идея знака одной фразой; основной логотип (знак + имя); знак отдельно на акцентном фоне; ряд размеров 96/48/32/20 px и вкладка браузера 16 px — знак должен читаться в 16 px.
3. Семейство: 3–4 карточки, где один принцип знака меняется под продукты, сегменты или направления компании из плана (если их нет — под точки пути клиента).
4. Конкуренты и мы: для каждого конкурента из анализа — его цвета и символы плашками (если цвета не указаны, напиши «цвета не указаны в анализе», не выдумывай). Рядом — по какой оси мы от него уходим (тёплое против холодного, светлое против тёмного, приглушённое против яркого, монохром против многоцветья) и зачем: чтобы клиент не спутал нас в ленте, на стенде и в выдаче.
5. Палитры: ровно три набора по 4–6 цветов, у каждого цвета HEX и роль (фон, текст, карточки, акцент, сигнал), у набора название и мини-пример (карточка или кнопка в этих цветах):
   — «Бренд»: утверждённые цвета из записей «Бренд»; если их нет, лучший из твоих вариантов под стратегию и ЦА;
   — «По тренду»: опирается на тренды из <design_trends>; назови тренд и источник одной строкой и объясни, почему он подходит этой стратегии и ЦА, а не просто модный;
   — «Контр-палитра»: собрана от обратного к цветам конкурентов; объясни ось контраста к каждому основному конкуренту.
   Сам борд свёрстан в первом наборе. Отметь, какой набор ты рекомендуешь и почему, но выбор за человеком.
   Затем шрифт: огромный образец заголовка, образец абзаца с реальной фразой из плана, название, начертания и строка «Google Fonts · свободная лицензия, коммерческое использование бесплатно»; одной фразой, почему этот шрифт подходит ЦА и отличается от шрифтов конкурентов.
6. Движение: как знак и интерфейс двигаются и почему. Движение следует из метафоры большой идеи, темп — из целевой аудитории (спокойный и точный для инженеров и B2B, живее для массового рынка). Покажи 2–3 живых примера CSS-анимацией и подпиши длительность и кривую.
7. В деле: одно применение там, где этот сегмент принимает решение (по пути клиента и тому, где и как он покупает): экран сайта или приложения, КП, стенд, пост — свёрстанное в HTML/CSS мокапом.
8. Принципы: три принципа визуального языка (заголовок + 1–2 предложения) и абзац «почему это работает», со ссылками на позиционирование, большую идею и сегмент.

Техника:
- <!doctype html>, <meta charset="utf-8">, весь CSS в одном <style>. В самом начале стиля блок :root с переменными, через которые сделано всё остальное, чтобы облик настраивался точечно: --c-bg, --c-fg, --c-muted, --c-card, --c-accent (и другие цвета палитры), --font-head, --font-body, --font-mono, --motion-speed (множитель длительностей, 1 по умолчанию), --radius. Все длительности анимаций пиши как calc(Ns * var(--motion-speed)); сетка на CSS grid, max-width около 1240px, щедрые поля (секции по 96px), скругления, карточки.
- Шрифты: если в записях «Бренд» указан шрифт, используй его. Иначе выбери 1–2 шрифта из <font_catalog> (бесплатные, с кириллицей) под характер стратегии и ЦА и не те, что у конкурентов, плюс моноширинный из каталога для подписей. Пиши их имена в font-family точно как в каталоге, с запасными шрифтами. Ничего не подключай через <link> и @import: платформа сама встроит выбранные шрифты в файл.
- Знаки и графика только inline SVG и CSS (градиенты, формы, линии). Без <img>, без фотографий, без внешних картинок.
- Никаких <script>, обработчиков событий, iframe и форм. Движение допустимо только CSS-анимацией (@keyframes), спокойное, с @media (prefers-reduced-motion: reduce).
- Выразительные средства уровня студии: «жидкий» фон из крупных размытых градиентных пятен (filter: blur, медленная CSS-анимация), матовое стекло (backdrop-filter), SVG-фильтры feTurbulence/feDisplacementMap для фактуры и отражений, крупная типографика с отрицательным трекингом (-0.03…-0.055em), моноширинные подписи капсом с разрядкой. Используй их по смыслу идеи, а не всё сразу.
- У направления есть имя (например, «A · Точка») и одна сильная метафора знака, которая следует из большой идеи; знак строится из простых форм и узнаётся в 16 px.
- Ширина страницы должна работать от 1280px до 360px; ничего не выходит за край карточки или экрана: огромные образцы шрифта задавай через clamp() и проверяй длину слов, у блоков min-width:0.
- Тон текстов под сегмент: как говорит и что ценит эта аудитория (инженеру — точность и цифры, собственнику — деньги и риски, массовому покупателю — простота и выгода). Тексты на русском, конкретные, взятые из плана: позиционирование, большая идея, сегмент, продукт. Не выдумывай цифры, отзывы и клиентов; если нужен пример цифры, бери из плана или пиши нейтрально.
- Цвета бренда бери из записей «Бренд»; если их нет, построй палитру на контрасте к цветам конкурентов из анализа. В любом случае ни один основной цвет не должен совпадать по тону с основным цветом конкурента.`;

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
- шрифт: из записей «Бренд», а если его нет — из <font_catalog> (бесплатные, с кириллицей) под стратегию и ЦА; имя точно как в каталоге, с запасными (например font-family="Onest, Arial, sans-serif"); ничего не подключай, платформа встроит шрифт сама; заголовки крупно с отрицательным трекингом (letter-spacing около -0.03em);
- цвета задай классами в <style> в начале SVG (.bg, .fg, .muted, .acc и т. п.), чтобы их можно было поменять в одном месте; цвета только из палитры бренда и контрастные к цветам конкурентов из анализа; акцент точечно;
- тон текста под сегмент: как говорит и что ценит эта аудитория; композиция с ясной иерархией, воздухом и одним сильным графическим образом (знак, форма, ритм линий), а не набором случайных фигур;
- текст на русском, конкретный, из плана; никаких выдуманных цифр, отзывов и чужих логотипов.`;

let fontB64: string | null = null;
/** Шрифты для встраивания: выбранные из каталога Google Fonts и, если бренд на нём, локальный Space Grotesk */
async function fontCssFor(code: string) {
  let css = (await embeddedFontCss(code)).css;
  if (/Space Grotesk/i.test(code)) {
    fontB64 ??= (await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "src/fonts/SpaceGrotesk-Regular.woff2"))).toString("base64");
    css += `@font-face{font-family:"Space Grotesk";src:url(data:font/woff2;base64,${fontB64}) format("woff2");font-weight:300 700}`;
  }
  return css;
}

/** Шрифты встроены, поэтому внешние подключения Google Fonts убираем: файл работает без сети */
const dropFontLinks = (code: string) =>
  code.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/gi, "").replace(/@import\s+url\(\s*['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/gi, "");

async function context(req: ImageRequest) {
  return `${req.brief ?? ""}

${await catalogBlock()}

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
            parts: [{ text: `${await context(req)}<task>Сделай бренд-борд по этой концепции.${variantNote(req)}\nВерни HTML в поле html и в notes одной-двумя фразами идею знака и на какие записи плана опирался.</task>` }],
            schema: schema("html"),
          }).then((r) => ({ data: { code: r.data.html, notes: r.data.notes }, usage: r.usage }))
        : await structured<{ svg: string; notes: string }>({
            system: SVG_SYSTEM,
            effort: "medium",
            maxTokens: 24000,
            parts: [
              {
                text: `${await context(req)}<task>${KIND_TASK[req.kind ?? ""] ?? KIND_TASK.ad}\nРазмер холста: ${DIM[req.aspect][0]}×${DIM[req.aspect][1]} px (формат ${req.aspect}).${variantNote(req)}\nВерни SVG в поле svg и в notes одной-двумя фразами, какие решения принял и на какие записи плана опирался.</task>`,
              },
            ],
            schema: schema("svg"),
          }).then((r) => ({ data: { code: r.data.svg, notes: r.data.notes }, usage: r.usage }));

      const code = dropFontLinks(data.code);
      const font = await fontCssFor(code);
      const out = board ? sanitizeHtml(code, font) : sanitizeSvg(code, font);
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

/**
 * Точечная правка: Claude возвращает только замены «найти → заменить» в существующем коде,
 * остальное не трогается. Каждая замена должна находиться в коде ровно один раз.
 */
export async function editVisualCode(a: { code: string; mime: string; instruction: string; brief?: string }) {
  const board = a.mime === "text/html";
  const clean = stripInjected(a.code);
  const { data, usage } = await structured<{ edits: { find: string; replace: string }[]; notes: string }>({
    system: `${board ? BOARD_SYSTEM : SVG_SYSTEM}

Сейчас ты не делаешь визуал заново, а точечно правишь готовый. Меняй только то, о чём просят; всё остальное должно остаться символ в символ. Если правка касается цвета, шрифта или скорости движения, по возможности меняй переменные или классы в начале стиля, а не каждое место по отдельности.`,
    effort: "medium",
    maxTokens: 16000,
    parts: [
      { text: `${a.brief ?? ""}\n\n<current_code>\n${clean}\n</current_code>` },
      {
        text: `<change_request>${a.instruction.replace(/</g, "‹")}</change_request>
<task>Верни список замен edits: find — точный фрагмент текущего кода (скопируй символ в символ, достаточно длинный, чтобы встречаться в коде ровно один раз), replace — чем его заменить. Делай минимальные замены. В notes одной фразой опиши, что изменил. Если просьба противоречит стратегии или делает цвета похожими на конкурентов, всё равно выполни её, но скажи об этом в notes.</task>`,
      },
    ],
    schema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"], additionalProperties: false },
        },
        notes: { type: "string" },
      },
      required: ["edits", "notes"],
      additionalProperties: false,
    },
  });
  if (data.edits.length === 0) throw new ImageError(`Claude не предложил правок. ${data.notes}`);
  let out = clean;
  for (const e of data.edits) {
    const first = out.indexOf(e.find);
    if (!e.find || first < 0) throw new ImageError("Claude сослался на фрагмент, которого нет в макете. Попробуйте сформулировать правку иначе.");
    if (out.indexOf(e.find, first + 1) >= 0) throw new ImageError("Правка оказалась неоднозначной. Попробуйте уточнить, какое место поменять.");
    out = out.slice(0, first) + e.replace + out.slice(first + e.find.length);
  }
  const font = await fontCssFor(out);
  const code = board ? sanitizeHtml(out, font) : sanitizeSvg(out, font);
  return {
    bytes: Buffer.from(code),
    notes: data.notes,
    model: usage.model,
    costUsd: costUsd(usage.model, { input: usage.inputTokens, output: usage.outputTokens, cacheRead: 0, cacheWrite: 0, searches: 0 }),
  };
}
