import "server-only";

/**
 * Бесплатные шрифты для визуалов. Каталог берём из Google Fonts (все шрифты там под свободными
 * лицензиями OFL или Apache и разрешены для коммерческого использования), оставляем только с кириллицей.
 * Выбранные Claude шрифты платформа скачивает и встраивает в файл, чтобы SVG, PNG и HTML выглядели
 * одинаково везде и не зависели от доступа к Google.
 */

export interface CatalogFont {
  family: string;
  category: string;
  weights: number[];
  popularity: number;
}

const META_URL = "https://fonts.google.com/metadata/fonts";
const CSS_URL = "https://fonts.googleapis.com/css2";
// Google отдаёт woff2 только «современному браузеру»
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Запасной список, если каталог Google недоступен */
const FALLBACK: CatalogFont[] = [
  ["Inter", "Sans Serif"], ["Manrope", "Sans Serif"], ["Onest", "Sans Serif"], ["Golos Text", "Sans Serif"], ["Geologica", "Sans Serif"],
  ["Montserrat", "Sans Serif"], ["Rubik", "Sans Serif"], ["IBM Plex Sans", "Sans Serif"], ["Jost", "Sans Serif"], ["Unbounded", "Display"],
  ["Raleway", "Sans Serif"], ["PT Sans", "Sans Serif"], ["Playfair Display", "Serif"], ["Lora", "Serif"], ["PT Serif", "Serif"],
  ["Literata", "Serif"], ["Cormorant", "Serif"], ["JetBrains Mono", "Monospace"], ["IBM Plex Mono", "Monospace"], ["Roboto Mono", "Monospace"],
].map(([family, category], i) => ({ family, category, weights: [300, 400, 500, 600, 700], popularity: i + 1 }));

let cache: { at: number; list: CatalogFont[] } | null = null;

export async function fontCatalog(limit = 160): Promise<CatalogFont[]> {
  if (cache && Date.now() - cache.at < 24 * 3600_000) return cache.list.slice(0, limit);
  try {
    const res = await fetch(META_URL, { signal: AbortSignal.timeout(10_000) });
    const text = (await res.text()).replace(/^\)\]\}'/, "");
    const data = JSON.parse(text) as {
      familyMetadataList: { family: string; category: string; subsets: string[]; fonts: Record<string, unknown>; popularity: number; isNoto?: boolean; isBrandFont?: boolean; isOpenSource?: boolean }[];
    };
    const list = data.familyMetadataList
      .filter((f) => f.subsets.includes("cyrillic") && !f.isNoto && !f.isBrandFont && f.isOpenSource !== false)
      .map((f) => ({
        family: f.family,
        category: f.category,
        weights: [...new Set(Object.keys(f.fonts).filter((k) => !k.endsWith("i")).map(Number))].filter(Boolean).sort((a, b) => a - b),
        popularity: f.popularity,
      }))
      .sort((a, b) => a.popularity - b.popularity);
    cache = { at: Date.now(), list };
  } catch {
    cache = { at: Date.now() - 23 * 3600_000, list: FALLBACK };
  }
  return cache.list.slice(0, limit);
}

/** Каталог для промпта: компактно, по одному шрифту в строке */
export async function catalogBlock() {
  const list = await fontCatalog();
  const byCat = new Map<string, string[]>();
  for (const f of list) byCat.set(f.category, [...(byCat.get(f.category) ?? []), `${f.family} (${f.weights.join("/")})`]);
  return `<font_catalog note="Бесплатные шрифты Google Fonts с кириллицей, свободные лицензии OFL/Apache, коммерческое использование разрешено. Отсортированы по популярности.">
${[...byCat].map(([c, fs]) => `${c}: ${fs.join(", ")}`).join("\n")}
</font_catalog>`;
}

/** Имена шрифтов, которые упомянуты в коде и есть в каталоге */
async function usedFamilies(code: string) {
  const all = await fontCatalog(400);
  const names = new Set<string>();
  for (const m of code.matchAll(/font-family\s*[:=]\s*["']?([^;"'>}]+)/gi)) m[1].split(",").forEach((n) => names.add(n.trim().replace(/^["']|["']$/g, "")));
  for (const m of code.matchAll(/--font[\w-]*\s*:\s*([^;}]+)/gi)) m[1].split(",").forEach((n) => names.add(n.trim().replace(/^["']|["']$/g, "")));
  for (const m of code.matchAll(/family=([^&"':]+)/g)) names.add(decodeURIComponent(m[1].replace(/\+/g, " ")));
  const lower = new Map(all.map((f) => [f.family.toLowerCase(), f]));
  return [...names].map((n) => lower.get(n.toLowerCase())).filter((f): f is CatalogFont => !!f).slice(0, 3);
}

/** Скачивает выбранные шрифты (кириллица и латиница) и возвращает @font-face с данными внутри */
export async function embeddedFontCss(code: string, maxBytes = 1_500_000): Promise<{ css: string; families: string[] }> {
  const fams = await usedFamilies(code);
  let css = "";
  let total = 0;
  const families: string[] = [];
  for (const f of fams) {
    const weights = f.weights.filter((w) => w >= 300 && w <= 800);
    const q = `family=${encodeURIComponent(f.family).replace(/%20/g, "+")}${weights.length > 1 ? `:wght@${weights.join(";")}` : ""}`;
    try {
      const sheet = await (await fetch(`${CSS_URL}?${q}&display=swap`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) })).text();
      const blocks = sheet.split(/(?=\/\* )/).filter((b) => /^\/\* (cyrillic|latin) \*\//.test(b));
      for (const b of blocks) {
        const url = b.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
        if (!url) continue;
        const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).arrayBuffer());
        total += bytes.length;
        if (total > maxBytes) break;
        css += b.replace(url, `data:font/woff2;base64,${bytes.toString("base64")}`).replace(/\/\*[^*]*\*\//, "").trim();
      }
      families.push(f.family);
    } catch {
      // шрифт не скачался: останутся запасные из font-family
    }
    if (total > maxBytes) break;
  }
  return { css, families };
}
