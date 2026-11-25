/** Число из поля записи: «48 млн ₽» → 48, «1 200,5» → 1200.5. Нет числа → null */
export function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v ?? "")
    .replace(/[\s  ]/g, "")
    .replace(",", ".")
    .match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Нормализует ввод числа: пробелы и запятая. Пусто → "", не число → null */
export function normalizeNumInput(raw: string): string | null {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return "";
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

export const fmtNum = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/** Дата записи (YYYY-MM-DD или ДД.ММ.ГГГГ) → Date. Нет даты → null */
export function parseDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

/** Все даты вида ДД.ММ.ГГГГ или ГГГГ-ММ-ДД в тексте («01.01.2027 – 31.12.2027») */
export function datesIn(text: string): Date[] {
  const out: Date[] = [];
  for (const m of text.matchAll(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\.\d{1,2}\.\d{4})/g)) {
    const d = parseDate(m[0]);
    if (d) out.push(d);
  }
  return out;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const ruDay = (d: Date | string) => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
