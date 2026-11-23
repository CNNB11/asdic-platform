import "server-only";
import { ImageError, composePrompt, priceUsd, type Aspect, type ImageProvider } from "../provider";

/**
 * YandexART в Yandex AI Studio. Тот же облачный кабинет, что и для текстовой модели в российском контуре.
 * Нужны YANDEX_API_KEY (API-ключ сервисного аккаунта с ролью ai.imageGeneration.user) и YANDEX_FOLDER_ID.
 * Генерация асинхронная: запускаем операцию и опрашиваем её, пока картинка не готова.
 */
const BASE = "https://llm.api.cloud.yandex.net";

const RATIO: Record<Aspect, [number, number]> = { "1:1": [1, 1], "4:5": [4, 5], "9:16": [9, 16], "16:9": [16, 9] };

export function yandexArtProvider(): ImageProvider {
  const key = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  const model = process.env.YANDEX_ART_MODEL ?? "yandex-art/latest";
  const auth = () => {
    if (!key || !folder) throw new ImageError("Для YandexART нужны переменные YANDEX_API_KEY и YANDEX_FOLDER_ID");
    return { Authorization: `Api-Key ${key}`, "x-folder-id": folder, "content-type": "application/json" };
  };
  return {
    id: "yandexart",
    label: "YandexART",
    maxPrompt: 500,
    async generate(req) {
      const headers = auth();
      const [w, h] = RATIO[req.aspect];
      const start = await fetch(`${BASE}/foundationModels/v1/imageGenerationAsync`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          modelUri: `art://${folder}/${model}`,
          generationOptions: {
            mimeType: "image/jpeg",
            seed: String(req.seed ?? Math.floor(Math.random() * 1e9)),
            aspectRatio: { widthRatio: String(w), heightRatio: String(h) },
          },
          messages: [{ weight: "1", text: composePrompt(req, 500) }],
        }),
      });
      if (!start.ok) throw new ImageError(`YandexART отказал: ${start.status} ${(await start.text()).slice(0, 300)}`);
      const { id } = (await start.json()) as { id: string };
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch(`${BASE}/operations/${id}`, { headers });
        if (!res.ok) throw new ImageError(`YandexART: не удалось получить результат (${res.status})`);
        const op = (await res.json()) as { done?: boolean; error?: { message?: string }; response?: { image?: string; modelVersion?: string } };
        if (!op.done) continue;
        if (op.error || !op.response?.image) throw new ImageError(`YandexART не сгенерировал изображение: ${op.error?.message ?? "пустой ответ"}`);
        return {
          bytes: Buffer.from(op.response.image, "base64"),
          mime: "image/jpeg",
          ext: ".jpg",
          model: `yandex-art ${op.response.modelVersion ?? model}`,
          costUsd: priceUsd(0.03),
        };
      }
      throw new ImageError("YandexART не ответил за 2 минуты. Попробуйте ещё раз.");
    },
  };
}
