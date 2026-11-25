import { planForRoute } from "@/lib/route-auth";
import { readStored } from "@/lib/sources";

export const runtime = "nodejs";

/** Логотип клиента для предпросмотра на странице «Документы» */
export async function GET(_: Request, ctx: RouteContext<"/api/plans/[planId]/logo">) {
  const { planId } = await ctx.params;
  const plan = await planForRoute(planId);
  const key = plan?.brand?.logoKey;
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": plan.brand?.logoMime ?? "image/png", "cache-control": "private, max-age=60", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}
