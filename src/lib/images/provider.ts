import "server-only";

/**
 * Генерация изображений, не зависящая от провайдера. У Claude своей генерации картинок нет,
 * поэтому это отдельный слой рядом с текстовым ИИ. Провайдер выбирается переменной IMAGE_PROVIDER:
 * yandexart (Россия, Yandex AI Studio), openai (международный контур) или mock (тестовая заглушка).
 * Если переменная не задана, берётся тот, для кого есть ключ, иначе заглушка.
 */

export type Aspect = "1:1" | "4:5" | "9:16" | "16:9";
export const ASPECTS: Aspect[] = ["1:1", "4:5", "9:16", "16:9"];

export interface ImageRequest {
  prompt: string;
  /** Чего не должно быть на картинке */
  avoid?: string;
  aspect: Aspect;
  seed?: number;
}

export interface ImageResult {
  bytes: Buffer;
  mime: string;
  ext: string;
  model: string;
  /** Оценка стоимости одной картинки, $ */
  costUsd: number;
}

export interface ImageProvider {
  id: string;
  /** Подпись для интерфейса */
  label: string;
  /** Заглушка: картинка не настоящая, это видно пользователю */
  mock?: boolean;
  /** Сколько символов промпта принимает модель */
  maxPrompt: number;
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
  const id = (process.env.IMAGE_PROVIDER ?? (process.env.YANDEX_API_KEY ? "yandexart" : process.env.OPENAI_API_KEY ? "openai" : "mock")).toLowerCase();
  switch (id) {
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
