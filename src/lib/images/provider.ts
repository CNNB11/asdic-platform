import "server-only";

/**
 * Визуалы концепций. По умолчанию их делает Claude кодом: SVG-мудборд или макет с настоящим текстом
 * в цветах и шрифте бренда. Внешние генераторы картинок подключаются только явно через IMAGE_PROVIDER:
 * yandexart (Россия, Yandex AI Studio), openai (международный контур) или mock (тестовая заглушка).
 */

export type Aspect = "1:1" | "4:5" | "9:16" | "16:9";
export const ASPECTS: Aspect[] = ["1:1", "4:5", "9:16", "16:9"];

export interface ImageRequest {
  prompt: string;
  /** Чего не должно быть на картинке */
  avoid?: string;
  aspect: Aspect;
  seed?: number;
  /** Полное описание концепции и контекст плана: для провайдеров, которые сами верстают (Claude) */
  brief?: string;
  /** Тип визуала: moodboard, concept, ad, social, site */
  kind?: string;
  /** Номер варианта и сколько их всего, чтобы варианты отличались */
  variant?: { n: number; of: number };
}

export interface ImageResult {
  bytes: Buffer;
  mime: string;
  ext: string;
  model: string;
  /** Оценка стоимости одной картинки, $ */
  costUsd: number;
  /** Пояснение автора макета: идея и на что опирался */
  notes?: string;
}

export interface ImageProvider {
  id: string;
  /** Подпись для интерфейса */
  label: string;
  /** Заглушка: картинка не настоящая, это видно пользователю */
  mock?: boolean;
  /** Сколько символов промпта принимает модель */
  maxPrompt: number;
  /** Провайдер сам пишет вызовы в журнал ИИ (текстовый слой), отдельная запись не нужна */
  selfLogged?: boolean;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export class ImageError extends Error {}

/** Цена картинки из переменной IMAGE_PRICE_USD или ориентир провайдера */
export function priceUsd(fallback: number) {
  const v = Number(process.env.IMAGE_PRICE_USD);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Собирает текст промпта: сам промпт, запреты и формат, с учётом лимита модели */
export function composePrompt(req: ImageRequest, max: number) {
  const avoid = req.avoid?.trim() ? ` Без: ${req.avoid.trim().replace(/\s+/g, " ")}.` : "";
  const tail = " Без надписей и логотипов.";
  const base = req.prompt.trim().replace(/\s+/g, " ");
  const full = `${base}${avoid}${tail}`;
  return full.length <= max ? full : `${base.slice(0, Math.max(0, max - avoid.length - tail.length))}${avoid}${tail}`.slice(0, max);
}

let _p: ImageProvider | null = null;

export async function imageProvider(): Promise<ImageProvider> {
  if (_p) return _p;
  const id = (process.env.IMAGE_PROVIDER || "claude").toLowerCase();
  switch (id) {
    case "claude": {
      const { claudeSvgProvider } = await import("./providers/claude");
      _p = claudeSvgProvider();
      break;
    }
    case "yandexart": {
      const { yandexArtProvider } = await import("./providers/yandexart");
      _p = yandexArtProvider();
      break;
    }
    case "openai": {
      const { openAiProvider } = await import("./providers/openai");
      _p = openAiProvider();
      break;
    }
    case "mock": {
      const { mockProvider } = await import("./providers/mock");
      _p = mockProvider();
      break;
    }
    default:
      throw new ImageError(`Провайдер изображений «${id}» не подключён`);
  }
  return _p;
}
