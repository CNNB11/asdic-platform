import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import path from "node:path";
import { newId } from "./ids";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
};

export function allowedExtensions() {
  return Object.keys(ALLOWED);
}

function uploadDir() {
  return process.env.UPLOAD_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "uploads");
}

/** Проверка файла: расширение, размер и сигнатура (PDF и DOCX проверяем по первым байтам) */
export function validateFile(name: string, bytes: Buffer): { ext: string; mime: string } {
  const ext = path.extname(name).toLowerCase();
  const mime = ALLOWED[ext];
  if (!mime) throw new Error(`Формат ${ext || "без расширения"} пока не поддерживается. Можно: ${allowedExtensions().join(", ")}`);
  if (bytes.length === 0) throw new Error("Файл пустой");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("Файл больше 20 МБ");
  if (ext === ".pdf" && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Файл не похож на PDF");
  if (ext === ".docx" && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("Файл не похож на DOCX");
  if ([".md", ".txt", ".csv"].includes(ext) && bytes.includes(0)) throw new Error("Текстовый файл содержит двоичные данные");
  return { ext, mime };
}

/** Сохраняет файл в базе: диск на хостинге (Render) стирается при каждом перезапуске и засыпании */
export async function storeFile(bytes: Buffer, ext: string) {
  const key = `${newId()}${ext}`;
  await db.insert(schema.files).values({ key, data: bytes });
  return key;
}

/** Читает файл из базы, а старые файлы, сохранённые до переноса, с диска */
export async function readStored(key: string) {
  if (key.includes("/") || key.includes("..")) throw new Error("bad key");
  const [f] = await db.select({ data: schema.files.data }).from(schema.files).where(eq(schema.files.key, key));
  if (f) return Buffer.from(f.data);
  try {
    return await readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), key));
  } catch {
    throw new StoredFileMissing(key);
  }
}

/** Какие из файлов ещё на месте: в базе или (старые) на диске сервера */
export async function storedKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.select({ key: schema.files.key }).from(schema.files).where(inArray(schema.files.key, keys));
  const found = new Set(rows.map((r) => r.key));
  for (const k of keys) if (!found.has(k) && !k.includes("/") && existsSync(path.join(/*turbopackIgnore: true*/ uploadDir(), k))) found.add(k);
  return found;
}

export class StoredFileMissing extends Error {
  constructor(key: string) {
    super(`Файл ${key} не найден: он хранился на диске сервера и стёрся при перезапуске`);
  }
}

/** Извлекает текст. У PDF страницы размечены как [стр. N], чтобы находить цитаты по страницам. */
export async function extractText(ext: string, bytes: Buffer): Promise<string> {
  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map((t, i) => `[стр. ${i + 1}]\n${t.trim()}`).join("\n\n");
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: bytes });
    return r.value.trim();
  }
  return bytes.toString("utf8").trim();
}

/** Нормализация для поиска цитат: регистр, пробелы, кавычки и тире */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[«»„“”"']/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ищет цитату в тексте источника; возвращает номер страницы для PDF */
export function locateQuote(text: string, quote: string): { found: boolean; page?: number } {
  const q = normalize(quote).replace(/^\.\.\.|\.\.\.$/g, "").trim();
  if (q.length < 8) return { found: false };
  const n = normalize(text);
  const idx = n.indexOf(q);
  if (idx < 0) return { found: false };
  const before = n.slice(0, idx);
  const m = [...before.matchAll(/\[стр\. (\d+)\]/g)].pop();
  return { found: true, page: m ? Number(m[1]) : undefined };
}
