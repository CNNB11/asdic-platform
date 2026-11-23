import { ImageError } from "./provider";

/**
 * Очистка визуалов, которые сверстал ИИ. Это второй рубеж: файлы и так открываются в песочнице
 * (iframe sandbox без скриптов и CSP sandbox на ответе), но в файле не должно оставаться исполняемого
 * и внешнего, кроме шрифтов Google Fonts.
 */

const ALLOWED_LINK = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

function common(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|form|base|meta\s+http-equiv)[\s\S]*?(\/>|>)/gi, "")
    .replace(/<\/(iframe|object|embed|frame|frameset|form)\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

/** Ссылки href/src: оставляем якоря и шрифты Google, остальное вырезаем */
function links(s: string) {
  return s.replace(/\s(?:xlink:)?(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _a, _q, d1, d2) => {
    const v = (d1 ?? d2 ?? "").trim();
    return v.startsWith("#") || ALLOWED_LINK.test(v) ? m : "";
  });
}

/** url(...) в CSS: только якоря, data-шрифты и Google Fonts */
function cssUrls(s: string) {
  return s
    .replace(/@import\s+url\(\s*['"]?(?!https:\/\/fonts\.googleapis\.com\/)[^)]*\)\s*;?/gi, "")
    .replace(/@import\s+['"](?!https:\/\/fonts\.googleapis\.com\/)[^'"]*['"]\s*;?/gi, "")
    .replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, _q, v: string) =>
      v.startsWith("#") || v.startsWith("data:font/") || v.startsWith("data:application/font") || ALLOWED_LINK.test(v) ? m : "none",
    );
}

export function sanitizeSvg(raw: string, fontCss: string) {
  let s = raw.trim();
  const start = s.indexOf("<svg");
  const end = s.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new ImageError("Claude вернул не SVG. Попробуйте ещё раз.");
  s = s.slice(start, end + 6);
  s = cssUrls(links(common(s.replace(/<image[\s\S]*?(\/>|<\/image\s*>)/gi, ""))));
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/Space Grotesk/i.test(s)) s = s.replace(/<svg[^>]*>/, (m) => `${m}<style>${fontCss}</style>`);
  return s;
}

export function sanitizeHtml(raw: string, fontCss: string) {
  let s = raw.trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start < 0) throw new ImageError("Claude вернул не HTML. Попробуйте ещё раз.");
  s = s.slice(start);
  s = cssUrls(links(common(s.replace(/<img\b[^>]*>/gi, ""))));
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fontCss}html,body{overflow-x:hidden}</style>`;
  s = /<head[^>]*>/i.test(s) ? s.replace(/<head[^>]*>/i, (m) => `${m}${head}`) : s.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return s;
}

/** CSP для отдачи визуала: без скриптов, шрифты только встроенные или Google Fonts */
export const VISUAL_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data:; sandbox";
