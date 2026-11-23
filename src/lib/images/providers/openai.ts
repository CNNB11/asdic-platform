import "server-only";
import { ImageError, composePrompt, priceUsd, type Aspect, type ImageProvider } from "../provider";

/** Международный контур: OpenAI Images API. Нужен OPENAI_API_KEY; модель задаёт OPENAI_IMAGE_MODEL. */
const SIZE: Record<Aspect, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536", "16:9": "1536x1024" };

export function openAiProvider(): ImageProvider {
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  return {
    id: "openai",
    label: "OpenAI",
    maxPrompt: 4000,
    async generate(req) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new ImageError("Для OpenAI нужна переменная OPENAI_API_KEY");
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: composePrompt(req, 4000), size: SIZE[req.aspect], quality: "medium", n: 1 }),
      });
      if (!res.ok) throw new ImageError(`OpenAI отказал: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new ImageError("OpenAI вернул пустой ответ");
      return { bytes: Buffer.from(b64, "base64"), mime: "image/png", ext: ".png", model, costUsd: priceUsd(0.05) };
    },
  };
}
