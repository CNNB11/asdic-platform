import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { planForRoute } from "@/lib/route-auth";
import { readStored } from "@/lib/sources";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: RouteContext<"/api/plans/[planId]/visuals/[visualId]">) {
  const { planId, visualId } = await ctx.params;
  const plan = await planForRoute(planId);
  if (!plan) return new Response("Not found", { status: 404 });
  const [v] = await db.select().from(schema.visuals).where(and(eq(schema.visuals.id, visualId), eq(schema.visuals.planId, planId)));
  if (!v) return new Response("Not found", { status: 404 });
  const bytes = await readStored(v.storageKey);
  const download = new URL(req.url).searchParams.has("download");
  const ext = v.storageKey.slice(v.storageKey.lastIndexOf("."));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": v.mime,
      "content-disposition": `${download ? "attachment" : "inline"}; filename="visual-${v.id}${ext}"`,
      "x-content-type-options": "nosniff",
      // SVG заглушки открывается как картинка без скриптов
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
