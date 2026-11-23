import { handleEvent, verifySignature, webhookSecret } from "@/lib/billing/paddle";

/** Вебхук Paddle: оплаты, продления, смены и отмены подписок, покупки пакетов кредитов */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = await webhookSecret();
  if (!secret) return new Response("webhook secret not configured", { status: 503 });
  if (!verifySignature(raw, req.headers.get("paddle-signature"), secret)) return new Response("bad signature", { status: 401 });
  try {
    const result = await handleEvent(JSON.parse(raw));
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error("paddle webhook failed", e);
    // 500: Paddle повторит доставку позже
    return new Response("error", { status: 500 });
  }
}
